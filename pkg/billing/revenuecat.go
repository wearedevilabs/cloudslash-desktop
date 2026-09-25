// Package billing integrates CloudSlash with RevenueCat so the desktop app can
// gate Pro features on a real subscription/entitlement.
//
// It talks to the RevenueCat REST API v1 (https://api.revenuecat.com/v1) and
// normalises the subscriber payload into a small, UI-friendly model. When no
// API key is configured the client reports an unconfigured status rather than
// failing, so the app keeps working fully offline (demo mode).
package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	// DefaultBaseURL is the RevenueCat REST API v1 base URL.
	DefaultBaseURL = "https://api.revenuecat.com/v1"
	// DefaultEntitlementID is the entitlement CloudSlash treats as "Pro".
	// Must match the entitlement identifier configured in RevenueCat.
	DefaultEntitlementID = "cloudslash_pro"

	// maxResponseBytes caps how much of a response we are willing to read.
	maxResponseBytes = 1 << 20 // 1 MiB
)

// ErrNotConfigured is returned when the client has no API key or app user ID.
var ErrNotConfigured = fmt.Errorf("revenuecat is not configured")

// Config holds the RevenueCat settings the client needs.
type Config struct {
	// APIKey is the RevenueCat secret API key (sk_...).
	//
	// The REST API v1 subscriber lookup requires a secret key; the public SDK
	// keys used by mobile clients (appl_..., test_...) are not sufficient.
	// A secret key grants full account access, so it must never be committed or
	// shipped inside a distributed binary - supply it via ConfigFromEnv.
	APIKey string
	// AppUserID identifies the customer, matching the id used by the mobile SDK.
	AppUserID string
	// EntitlementID is the entitlement identifier that unlocks Pro features.
	EntitlementID string
	// BaseURL overrides the API base URL (used in tests).
	BaseURL string
}

// Normalize fills empty fields with sensible defaults.
func (c Config) Normalize() Config {
	if strings.TrimSpace(c.EntitlementID) == "" {
		c.EntitlementID = DefaultEntitlementID
	}
	if strings.TrimSpace(c.BaseURL) == "" {
		c.BaseURL = DefaultBaseURL
	}
	c.APIKey = strings.TrimSpace(c.APIKey)
	c.AppUserID = strings.TrimSpace(c.AppUserID)
	c.EntitlementID = strings.TrimSpace(c.EntitlementID)
	c.BaseURL = strings.TrimRight(strings.TrimSpace(c.BaseURL), "/")
	return c
}

// Configured reports whether the config has the minimum fields to call the API.
func (c Config) Configured() bool {
	return c.APIKey != "" && c.AppUserID != ""
}

// Environment variables read by ConfigFromEnv.
const (
	EnvSecretKey     = "REVENUECAT_SECRET_KEY"
	EnvAPIKey        = "REVENUECAT_API_KEY"
	EnvAppUserID     = "REVENUECAT_APP_USER_ID"
	EnvEntitlementID = "REVENUECAT_ENTITLEMENT_ID"
)

// ConfigFromEnv builds a Config from environment variables, so a secret key can
// be supplied without writing it to disk or source control.
//
// REVENUECAT_SECRET_KEY wins over REVENUECAT_API_KEY. Missing values fall back
// to the standard defaults (entitlement "cloudslash_pro").
func ConfigFromEnv() Config {
	key := strings.TrimSpace(os.Getenv(EnvSecretKey))
	if key == "" {
		key = strings.TrimSpace(os.Getenv(EnvAPIKey))
	}
	return Config{
		APIKey:        key,
		AppUserID:     strings.TrimSpace(os.Getenv(EnvAppUserID)),
		EntitlementID: strings.TrimSpace(os.Getenv(EnvEntitlementID)),
	}.Normalize()
}

// Entitlement is a single entitlement as returned by RevenueCat.
type Entitlement struct {
	Identifier        string
	ProductIdentifier string
	PurchaseDate      time.Time
	ExpiresDate       *time.Time
}

// Active reports whether the entitlement is currently valid. Entitlements with
// no expiry (e.g. lifetime or non-renewing) are considered active.
func (e Entitlement) Active(now time.Time) bool {
	if e.ExpiresDate == nil {
		return true
	}
	return e.ExpiresDate.After(now)
}

// CustomerInfo is a normalised view of the RevenueCat subscriber payload.
type CustomerInfo struct {
	AppUserID         string
	Entitlements      map[string]Entitlement
	ManagementURL     string
	FirstSeen         time.Time
	OriginalAppUserID string
	FetchedAt         time.Time
}

// ActiveEntitlement returns the named entitlement and whether it is active now.
func (c CustomerInfo) ActiveEntitlement(id string) (Entitlement, bool) {
	e, ok := c.Entitlements[id]
	if !ok {
		return Entitlement{}, false
	}
	return e, e.Active(time.Now())
}

// Client calls the RevenueCat REST API v1.
type Client struct {
	cfg  Config
	http *http.Client
}

// NewClient builds a client. The config is normalised, so callers may pass it
// straight from user settings.
func NewClient(cfg Config) *Client {
	return &Client{
		cfg: cfg.Normalize(),
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// Config returns the normalised configuration in use.
func (c *Client) Config() Config { return c.cfg }

// GetCustomerInfo fetches the latest customer info for the configured app user.
func (c *Client) GetCustomerInfo(ctx context.Context) (*CustomerInfo, error) {
	if !c.cfg.Configured() {
		return nil, ErrNotConfigured
	}

	endpoint := fmt.Sprintf("%s/subscribers/%s", c.cfg.BaseURL, url.PathEscape(c.cfg.AppUserID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "CloudSlash-Desktop")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}

	switch {
	case resp.StatusCode == http.StatusUnauthorized:
		return nil, fmt.Errorf("revenuecat rejected the API key (401 Unauthorized)")
	case resp.StatusCode == http.StatusNotFound:
		return nil, fmt.Errorf("revenuecat has no customer %q (404)", c.cfg.AppUserID)
	case resp.StatusCode < 200 || resp.StatusCode >= 300:
		return nil, fmt.Errorf("revenuecat returned %s: %s", resp.Status, truncate(string(body), 200))
	}

	info, err := decodeCustomerInfo(body)
	if err != nil {
		return nil, err
	}
	info.FetchedAt = time.Now()
	return info, nil
}

// subscriberResponse mirrors the parts of the RevenueCat payload we consume.
// Some endpoints wrap the payload in a "value" object, so both shapes are handled.
type subscriberResponse struct {
	Subscriber *subscriberPayload `json:"subscriber"`
	Value      *subscriberValue   `json:"value"`
}

type subscriberValue struct {
	Subscriber *subscriberPayload `json:"subscriber"`
}

type subscriberPayload struct {
	AppUserID         string                    `json:"app_user_id"`
	OriginalAppUserID string                    `json:"original_app_user_id"`
	FirstSeen         string                    `json:"first_seen"`
	ManagementURL     string                    `json:"management_url"`
	Entitlements      map[string]entitlementDTO `json:"entitlements"`
}

type entitlementDTO struct {
	ProductIdentifier string `json:"product_identifier"`
	PurchaseDate      string `json:"purchase_date"`
	ExpiresDate       string `json:"expires_date"`
}

func decodeCustomerInfo(body []byte) (*CustomerInfo, error) {
	var raw subscriberResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("failed to decode revenuecat response: %w", err)
	}

	payload := raw.Subscriber
	if payload == nil && raw.Value != nil {
		payload = raw.Value.Subscriber
	}
	if payload == nil {
		return nil, fmt.Errorf("revenuecat response did not contain subscriber data")
	}

	info := &CustomerInfo{
		AppUserID:         payload.AppUserID,
		OriginalAppUserID: payload.OriginalAppUserID,
		ManagementURL:     payload.ManagementURL,
		Entitlements:      make(map[string]Entitlement, len(payload.Entitlements)),
	}
	if t, ok := parseDate(payload.FirstSeen); ok {
		info.FirstSeen = t
	}

	for id, dto := range payload.Entitlements {
		e := Entitlement{
			Identifier:        id,
			ProductIdentifier: dto.ProductIdentifier,
		}
		if t, ok := parseDate(dto.PurchaseDate); ok {
			e.PurchaseDate = t
		}
		if t, ok := parseDate(dto.ExpiresDate); ok {
			e.ExpiresDate = &t
		}
		info.Entitlements[id] = e
	}

	return info, nil
}

// parseDate accepts the ISO-8601 timestamps RevenueCat returns. An empty or
// unparseable value yields ok=false; callers treat that as "not set".
func parseDate(value string) (time.Time, bool) {
	if strings.TrimSpace(value) == "" || value == "null" {
		return time.Time{}, false
	}
	layouts := []string{time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02 15:04:05"}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, value); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
