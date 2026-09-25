package billing

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Source describes where the current Pro status came from.
type Source string

const (
	// SourceNone means no active entitlement and no trial.
	SourceNone Source = "none"
	// SourceRevenueCat means an active RevenueCat entitlement unlocked Pro.
	SourceRevenueCat Source = "revenuecat"
	// SourceTrial means the local demo trial unlocked Pro.
	SourceTrial Source = "trial"
)

// Status is the resolved entitlement state a UI can render directly.
type Status struct {
	// Configured reports whether an API key and app user id are present.
	Configured bool
	// Pro reports whether Pro features should be unlocked.
	Pro bool
	// Source explains why Pro is (or is not) unlocked.
	Source Source
	// EntitlementID is the entitlement being checked.
	EntitlementID string
	// Customer is the last known RevenueCat customer info, if any.
	Customer *CustomerInfo
	// Error carries the most recent lookup failure, if any.
	Error string
	// CheckedAt is when the entitlement was last successfully resolved.
	CheckedAt time.Time
	// TrialExpires is set while a local demo trial is active.
	TrialExpires *time.Time
}

// persisted is the on-disk state for the billing service.
type persisted struct {
	Config       Config        `json:"config"`
	LastStatus   *CustomerInfo `json:"last_status,omitempty"`
	TrialExpires *time.Time    `json:"trial_expires,omitempty"`
}

// Store persists billing configuration and the last known status so the app can
// start offline and still remember entitlements.
type Store struct {
	Path string
}

// DefaultStorePath returns the per-user location for desktop billing state.
func DefaultStorePath() string {
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return filepath.Join(dir, "cloudslash", "billing.json")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "billing.json"
	}
	return filepath.Join(home, ".cloudslash", "billing.json")
}

// Load reads persisted state. A missing file is not an error.
func (s *Store) Load() (persisted, error) {
	var p persisted
	if s == nil || s.Path == "" {
		return p, nil
	}
	data, err := os.ReadFile(s.Path)
	if err != nil {
		if os.IsNotExist(err) {
			return p, nil
		}
		return p, err
	}
	if err := json.Unmarshal(data, &p); err != nil {
		return persisted{}, err
	}
	return p, nil
}

// Save writes persisted state, creating the parent directory if needed.
func (s *Store) Save(p persisted) error {
	if s == nil || s.Path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.Path, data, 0o600)
}

// Service resolves Pro entitlements from RevenueCat, with a local demo trial as
// a fallback so the app can be evaluated without a configured store.
type Service struct {
	mu           sync.RWMutex
	cfg          Config
	client       *Client
	store        *Store
	lastStatus   *CustomerInfo
	trialExpires *time.Time
}

// NewService builds a service and restores any persisted state.
func NewService(cfg Config, store *Store) *Service {
	s := &Service{store: store}
	if store != nil {
		if p, err := store.Load(); err == nil {
			// Explicit config wins over persisted config.
			if !cfg.Configured() && p.Config.Configured() {
				cfg = p.Config
			}
			s.lastStatus = p.LastStatus
			s.trialExpires = p.TrialExpires
		}
	}
	s.SetConfig(cfg)
	return s
}

// Config returns the current configuration.
func (s *Service) Config() Config {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// SetConfig updates the RevenueCat configuration and rebuilds the client.
func (s *Service) SetConfig(cfg Config) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cfg = cfg.Normalize()
	s.client = NewClient(s.cfg)
}

// Status returns the currently resolved status without touching the network.
func (s *Service) Status() Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.resolveLocked()
}

// Refresh fetches entitlements from RevenueCat and updates the cached status.
// On a network failure the last known status is retained and surfaced via
// Status.Error, so a previously unlocked user is not locked out offline.
func (s *Service) Refresh(ctx context.Context) Status {
	s.mu.RLock()
	client := s.client
	cfg := s.cfg
	s.mu.RUnlock()

	if !cfg.Configured() {
		s.mu.Lock()
		defer s.mu.Unlock()
		status := s.resolveLocked()
		status.Error = ErrNotConfigured.Error()
		return status
	}

	info, err := client.GetCustomerInfo(ctx)

	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		status := s.resolveLocked()
		status.Error = err.Error()
		return status
	}

	s.lastStatus = info
	s.persistLocked()
	return s.resolveLocked()
}

// StartTrial unlocks Pro locally for the given duration (used for demos).
func (s *Service) StartTrial(d time.Duration) Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	expiry := time.Now().Add(d)
	s.trialExpires = &expiry
	s.persistLocked()
	return s.resolveLocked()
}

// ClearTrial removes any active local demo trial.
func (s *Service) ClearTrial() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.trialExpires = nil
	s.persistLocked()
	return s.resolveLocked()
}

// resolveLocked computes the effective status. Callers must hold at least a read lock.
func (s *Service) resolveLocked() Status {
	now := time.Now()
	status := Status{
		Configured:    s.cfg.Configured(),
		EntitlementID: s.cfg.EntitlementID,
		Customer:      s.lastStatus,
	}

	// A live RevenueCat entitlement always wins.
	if s.lastStatus != nil {
		if ent, active := s.lastStatus.ActiveEntitlement(s.cfg.EntitlementID); active {
			status.Pro = true
			status.Source = SourceRevenueCat
			status.CheckedAt = s.lastStatus.FetchedAt
			_ = ent
		}
	}

	// Local demo trial.
	if s.trialExpires != nil && s.trialExpires.After(now) {
		status.TrialExpires = s.trialExpires
		if !status.Pro {
			status.Pro = true
			status.Source = SourceTrial
		}
	}

	if status.Source == "" {
		status.Source = SourceNone
	}
	return status
}

func (s *Service) persistLocked() {
	if s.store == nil {
		return
	}
	_ = s.store.Save(persisted{
		Config:       s.cfg,
		LastStatus:   s.lastStatus,
		TrialExpires: s.trialExpires,
	})
}
