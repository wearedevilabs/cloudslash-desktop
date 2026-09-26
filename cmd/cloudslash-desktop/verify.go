package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/DrSkyle/cloudslash/v2/pkg/billing"
)

// Authoritative entitlement verification.
//
// The SDK in the interface resolves entitlement with a publishable key. That key
// is safe in a client because it can only read one customer's own entitlements.
// A REST v1 subscriber lookup is a different power: it needs the secret key
// (sk_...), which controls the whole RevenueCat project. The rules below are
// enforced here rather than left to callers.
//
//  1. The key is read from the environment at call time. Never from preferences,
//     a file, or the interface.
//  2. It is never returned to the interface and never logged.
//  3. Error text is scrubbed of anything key-shaped before it is stored, logged,
//     or shown, since an HTTP transport may echo a credential back.
//  4. A publishable key in this slot is refused by name, because it produces a
//     confusing 401 rather than a useful message.
//  5. Results are cached briefly, so re-rendering a screen cannot hammer the API.
//
// When the key is absent the capability is off, and the interface says so along
// with the variable to set. Nothing else about the app changes.

// VerificationStatus tells the interface whether the authoritative check is live.
type VerificationStatus struct {
	Available     bool   `json:"Available"`
	Reason        string `json:"Reason"`
	EnvVar        string `json:"EnvVar"`
	EntitlementID string `json:"EntitlementID"`
	AppUserID     string `json:"AppUserID"`
}

// Verification is RevenueCat's answer. It deliberately has no field that could
// carry the key, so no future edit can leak it by accident.
type Verification struct {
	Checked       bool   `json:"Checked"`
	Active        bool   `json:"Active"`
	Source        string `json:"Source"`
	EntitlementID string `json:"EntitlementID"`
	ProductID     string `json:"ProductID"`
	ExpiresAt     string `json:"ExpiresAt"`
	ManagementURL string `json:"ManagementURL"`
	AppUserID     string `json:"AppUserID"`
	CheckedAt     string `json:"CheckedAt"`
	Error         string `json:"Error"`
}

// publishablePrefixes are RevenueCat key shapes that cannot authorize a
// subscriber lookup. Naming them turns a puzzling 401 into an instruction.
var publishablePrefixes = []string{"rcb_", "pk_", "appl_", "test_", "amzn_", "goog_"}

// keyPattern catches any RevenueCat-shaped credential that appears in an error
// body, in case the transport echoes one back.
var keyPattern = regexp.MustCompile(`\b(?:sk|rcb|pk|appl|test|amzn|goog)_[A-Za-z0-9_\-]{4,}`)

// redact removes anything key-shaped from a message before it is stored, logged,
// or handed to the interface.
func redact(message, secret string) string {
	if secret != "" {
		message = strings.ReplaceAll(message, secret, "[redacted]")
	}
	return keyPattern.ReplaceAllString(message, "[redacted]")
}

type verifier struct {
	mu      sync.Mutex
	baseURL string
	ttl     time.Duration

	cachedAt time.Time
	cachedID string
	cached   Verification
}

func newVerifier(ttl time.Duration) *verifier {
	return &verifier{ttl: ttl}
}

// secretKey reads the key from the environment, and nowhere else.
func (v *verifier) secretKey() string {
	key := strings.TrimSpace(os.Getenv(billing.EnvSecretKey))
	if key == "" {
		key = strings.TrimSpace(os.Getenv(billing.EnvAPIKey))
	}
	return key
}

func entitlementIDFromEnv() string {
	id := strings.TrimSpace(os.Getenv(billing.EnvEntitlementID))
	if id == "" {
		return "cloudslash_pro"
	}
	return id
}

func hasAnyPrefix(value string, prefixes []string) bool {
	for _, prefix := range prefixes {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	return false
}

// status reports whether the authoritative check can run, and why not when it
// cannot. It never includes the key, not even a prefix of it.
func (v *verifier) status(appUserID string) VerificationStatus {
	key := v.secretKey()

	st := VerificationStatus{
		EnvVar:        billing.EnvSecretKey,
		EntitlementID: entitlementIDFromEnv(),
		AppUserID:     appUserID,
	}

	switch {
	case key == "":
		st.Reason = fmt.Sprintf(
			"No secret key is set, so this app cannot ask RevenueCat directly. Export %s to enable the authoritative check; it stays in your shell and is never written to disk or sent to the interface.",
			billing.EnvSecretKey,
		)
	case hasAnyPrefix(key, publishablePrefixes):
		st.Reason = "The configured key is a publishable key, which cannot authorize a subscriber lookup. Set the secret key (sk_...) instead: the publishable key belongs in the client build, not here."
	default:
		st.Available = true
	}

	return st
}

// verify asks RevenueCat for this customer's entitlements and reports the
// verdict. Cached for the verifier's TTL so repeated screen renders are free.
func (v *verifier) verify(ctx context.Context, appUserID string) Verification {
	key := v.secretKey()

	if key == "" {
		return Verification{
			EntitlementID: entitlementIDFromEnv(),
			AppUserID:     appUserID,
			Error:         "no secret key is configured",
		}
	}
	if hasAnyPrefix(key, publishablePrefixes) {
		return Verification{
			EntitlementID: entitlementIDFromEnv(),
			AppUserID:     appUserID,
			Error:         "the configured key is a publishable key, not a secret key",
		}
	}

	v.mu.Lock()
	if v.cachedID == appUserID && v.cached.Checked && time.Since(v.cachedAt) < v.ttl {
		out := v.cached
		v.mu.Unlock()
		return out
	}
	v.mu.Unlock()

	cfg := billing.Config{
		APIKey:        key,
		AppUserID:     appUserID,
		EntitlementID: entitlementIDFromEnv(),
		BaseURL:       v.baseURL,
	}.Normalize()

	callCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	info, err := billing.NewClient(cfg).GetCustomerInfo(callCtx)

	out := Verification{
		Source:        "RevenueCat REST API v1",
		EntitlementID: cfg.EntitlementID,
		AppUserID:     appUserID,
		CheckedAt:     time.Now().UTC().Format(time.RFC3339),
	}

	if err != nil {
		out.Error = redact(err.Error(), key)
		slog.Warn("revenuecat: authoritative check failed", "error", out.Error)
		return out
	}

	out.Checked = true
	out.ManagementURL = info.ManagementURL

	if ent, active := info.ActiveEntitlement(cfg.EntitlementID); active || ent.Identifier != "" {
		out.Active = active
		out.ProductID = ent.ProductIdentifier
		if ent.ExpiresDate != nil {
			out.ExpiresAt = ent.ExpiresDate.UTC().Format(time.RFC3339)
		}
	}

	v.mu.Lock()
	v.cached, v.cachedAt, v.cachedID = out, time.Now(), appUserID
	v.mu.Unlock()

	// The outcome is logged; the credential is not.
	slog.Info("revenuecat: authoritative check",
		"active", out.Active,
		"entitlement", out.EntitlementID,
		"checked_at", out.CheckedAt,
	)
	return out
}
