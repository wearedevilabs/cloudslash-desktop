package billing

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

func TestGetCustomerInfoParsesActiveEntitlement(t *testing.T) {
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer appl_test" {
			t.Errorf("Authorization header = %q", got)
		}
		if want := "/subscribers/user-1"; r.URL.Path != want {
			t.Errorf("path = %q, want %q", r.URL.Path, want)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"request_date": "2026-01-01T00:00:00Z",
			"subscriber": {
				"app_user_id": "user-1",
				"first_seen": "2025-12-01T00:00:00Z",
				"management_url": "https://apps.apple.com/account/subscriptions",
				"entitlements": {
					"pro": {"product_identifier": "cloudslash_pro_monthly", "expires_date": "` + future + `"}
				}
			}
		}`))
	}))
	defer server.Close()

	client := NewClient(Config{APIKey: "appl_test", AppUserID: "user-1", BaseURL: server.URL})
	info, err := client.GetCustomerInfo(context.Background())
	if err != nil {
		t.Fatalf("GetCustomerInfo: %v", err)
	}
	if info.AppUserID != "user-1" {
		t.Errorf("AppUserID = %q", info.AppUserID)
	}
	if info.ManagementURL == "" {
		t.Error("expected management URL")
	}
	ent, active := info.ActiveEntitlement("pro")
	if !active {
		t.Fatalf("expected pro entitlement to be active, got %+v", ent)
	}
	if ent.ProductIdentifier != "cloudslash_pro_monthly" {
		t.Errorf("ProductIdentifier = %q", ent.ProductIdentifier)
	}
}

func TestGetCustomerInfoExpiredEntitlementIsInactive(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour).UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"subscriber":{"entitlements":{"pro":{"expires_date":"` + past + `"}}}}`))
	}))
	defer server.Close()

	client := NewClient(Config{APIKey: "appl_test", AppUserID: "user-1", BaseURL: server.URL})
	info, err := client.GetCustomerInfo(context.Background())
	if err != nil {
		t.Fatalf("GetCustomerInfo: %v", err)
	}
	if _, active := info.ActiveEntitlement("pro"); active {
		t.Error("expired entitlement should not be active")
	}
}

func TestGetCustomerInfoHandlesValueWrapper(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"value":{"subscriber":{"app_user_id":"wrapped","entitlements":{"pro":{}}}}}`))
	}))
	defer server.Close()

	client := NewClient(Config{APIKey: "appl_test", AppUserID: "user-1", BaseURL: server.URL})
	info, err := client.GetCustomerInfo(context.Background())
	if err != nil {
		t.Fatalf("GetCustomerInfo: %v", err)
	}
	if info.AppUserID != "wrapped" {
		t.Errorf("AppUserID = %q, want wrapped", info.AppUserID)
	}
	// No expiry means lifetime -> active.
	if _, active := info.ActiveEntitlement("pro"); !active {
		t.Error("lifetime entitlement should be active")
	}
}

func TestGetCustomerInfoUnauthorized(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()

	client := NewClient(Config{APIKey: "bad", AppUserID: "user-1", BaseURL: server.URL})
	if _, err := client.GetCustomerInfo(context.Background()); err == nil {
		t.Fatal("expected an error for 401")
	}
}

func TestConfigFromEnv(t *testing.T) {
	t.Setenv(EnvSecretKey, "sk_from_env")
	t.Setenv(EnvAppUserID, "user-env")
	t.Setenv(EnvEntitlementID, "")

	cfg := ConfigFromEnv()
	if cfg.APIKey != "sk_from_env" {
		t.Errorf("APIKey = %q", cfg.APIKey)
	}
	if cfg.AppUserID != "user-env" {
		t.Errorf("AppUserID = %q", cfg.AppUserID)
	}
	if cfg.EntitlementID != DefaultEntitlementID {
		t.Errorf("EntitlementID = %q, want %q", cfg.EntitlementID, DefaultEntitlementID)
	}
	if !cfg.Configured() {
		t.Error("expected config to be usable")
	}
}

func TestConfigFromEnvPrefersSecretKey(t *testing.T) {
	t.Setenv(EnvSecretKey, "sk_wins")
	t.Setenv(EnvAPIKey, "sk_loses")

	if got := ConfigFromEnv().APIKey; got != "sk_wins" {
		t.Errorf("APIKey = %q, want sk_wins", got)
	}

	t.Setenv(EnvSecretKey, "")
	if got := ConfigFromEnv().APIKey; got != "sk_loses" {
		t.Errorf("APIKey = %q, want sk_loses", got)
	}
}

func TestGetCustomerInfoNotConfigured(t *testing.T) {
	client := NewClient(Config{})
	if _, err := client.GetCustomerInfo(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestServiceTrialUnlocksPro(t *testing.T) {
	svc := NewService(Config{}, &Store{Path: filepath.Join(t.TempDir(), "billing.json")})
	if svc.Status().Pro {
		t.Fatal("expected Pro to be locked by default")
	}

	status := svc.StartTrial(48 * time.Hour)
	if !status.Pro || status.Source != SourceTrial {
		t.Fatalf("trial status = %+v", status)
	}
	if status.TrialExpires == nil {
		t.Error("expected trial expiry to be set")
	}

	if cleared := svc.ClearTrial(); cleared.Pro {
		t.Error("expected Pro to be locked after clearing trial")
	}
}

func TestServicePersistsAndReloads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "billing.json")
	cfg := Config{APIKey: "appl_persist", AppUserID: "user-9"}

	svc := NewService(cfg, &Store{Path: path})
	svc.StartTrial(time.Hour)

	reloaded := NewService(Config{}, &Store{Path: path})
	if got := reloaded.Config(); got.APIKey != cfg.APIKey || got.AppUserID != cfg.AppUserID {
		t.Errorf("reloaded config = %+v", got)
	}
	if !reloaded.Status().Pro {
		t.Error("expected persisted trial to keep Pro unlocked")
	}
}

func TestServiceRefreshKeepsLastKnownStatusOnError(t *testing.T) {
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"subscriber":{"entitlements":{"` + DefaultEntitlementID + `":{"expires_date":"` + future + `"}}}}`))
	}))
	defer server.Close()

	svc := NewService(Config{APIKey: "sk_test", AppUserID: "u", BaseURL: server.URL}, nil)
	if s := svc.Refresh(context.Background()); !s.Pro || s.Source != SourceRevenueCat {
		t.Fatalf("first refresh = %+v", s)
	}

	// Point the service at a dead server; the cached entitlement should remain.
	svc.SetConfig(Config{APIKey: "appl_test", AppUserID: "u", BaseURL: "http://127.0.0.1:1"})
	s := svc.Refresh(context.Background())
	if s.Error == "" {
		t.Error("expected an error to be surfaced")
	}
	if !s.Pro {
		t.Error("expected last known entitlement to keep Pro unlocked offline")
	}
}
