package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/DrSkyle/cloudslash/v2/pkg/billing"
)

// The authoritative verification path has two jobs, and these tests hold it to
// both: it must actually work against a RevenueCat-shaped response, and it must
// never let the secret key out of the process.

const testSecret = "sk_testkey_do_not_use_0123456789abcdef"

func subscriberBody(expires string) string {
	return fmt.Sprintf(`{"subscriber":{
		"app_user_id":"cs_test",
		"management_url":"https://apps.apple.com/account/subscriptions",
		"entitlements":{"cloudslash_pro":{
			"product_identifier":"cloudslash_pro_annual",
			"purchase_date":"2026-08-01T10:00:00Z",
			"expires_date":%q
		}}}}`, expires)
}

func TestVerificationStatusWithoutAKey(t *testing.T) {
	t.Setenv(billing.EnvSecretKey, "")
	t.Setenv(billing.EnvAPIKey, "")

	v := newVerifier(time.Minute)
	status := v.status("cs_test")

	if status.Available {
		t.Fatal("verification reported available with no key set")
	}
	if !strings.Contains(status.Reason, billing.EnvSecretKey) {
		t.Errorf("reason does not name the variable to set: %q", status.Reason)
	}
	if status.EnvVar != billing.EnvSecretKey {
		t.Errorf("EnvVar = %q, want %q", status.EnvVar, billing.EnvSecretKey)
	}
}

func TestVerificationStatusRefusesAPublishableKey(t *testing.T) {
	// A publishable key cannot authorize a subscriber lookup. Catching it by name
	// turns a puzzling 401 into an instruction.
	t.Setenv(billing.EnvSecretKey, "rcb_thisIsAPublishableWebBillingKey")

	v := newVerifier(time.Minute)
	status := v.status("cs_test")

	if status.Available {
		t.Fatal("verification accepted a publishable key as a secret key")
	}
	if !strings.Contains(strings.ToLower(status.Reason), "publishable") {
		t.Errorf("reason does not explain the key kind: %q", status.Reason)
	}
}

func TestVerificationFindsAnActiveEntitlement(t *testing.T) {
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, subscriberBody("2027-08-01T10:00:00Z"))
	}))
	defer server.Close()

	t.Setenv(billing.EnvSecretKey, testSecret)
	t.Setenv(billing.EnvEntitlementID, "cloudslash_pro")

	v := newVerifier(time.Minute)
	v.baseURL = server.URL

	out := v.verify(context.Background(), "cs_test")

	if !out.Checked {
		t.Fatalf("check did not complete: %q", out.Error)
	}
	if !out.Active {
		t.Error("an entitlement expiring in 2027 was reported inactive")
	}
	if out.ProductID != "cloudslash_pro_annual" {
		t.Errorf("ProductID = %q, want cloudslash_pro_annual", out.ProductID)
	}
	if out.ManagementURL == "" {
		t.Error("management URL was not carried through")
	}
	if out.AppUserID != "cs_test" {
		t.Errorf("AppUserID = %q, want cs_test", out.AppUserID)
	}
	if out.CheckedAt == "" {
		t.Error("CheckedAt was not recorded")
	}
	// The client must present the key as a bearer token, which is what proves
	// the request was actually authorized rather than merely answered.
	if gotAuth != "Bearer "+testSecret {
		t.Errorf("Authorization header = %q, want a bearer token", gotAuth)
	}
}

func TestVerificationReportsAnExpiredEntitlement(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, subscriberBody("2025-01-01T00:00:00Z"))
	}))
	defer server.Close()

	t.Setenv(billing.EnvSecretKey, testSecret)

	v := newVerifier(time.Minute)
	v.baseURL = server.URL

	out := v.verify(context.Background(), "cs_test")
	if !out.Checked {
		t.Fatalf("check did not complete: %q", out.Error)
	}
	if out.Active {
		t.Error("an entitlement that expired in 2025 was reported active")
	}
	if out.ExpiresAt == "" {
		t.Error("expiry was dropped, so the interface cannot say when it lapsed")
	}
}

func TestVerificationSurfacesAMissingCustomer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		fmt.Fprint(w, `{"error":"not found"}`)
	}))
	defer server.Close()

	t.Setenv(billing.EnvSecretKey, testSecret)

	v := newVerifier(time.Minute)
	v.baseURL = server.URL

	out := v.verify(context.Background(), "cs_missing")
	if out.Checked {
		t.Error("a 404 was reported as a completed check")
	}
	if out.Error == "" {
		t.Error("a 404 produced no explanation")
	}
}

// TestVerificationNeverEchoesTheSecret is the security assertion. A failing
// upstream that echoes the Authorization header back is exactly the situation
// where a credential leaks into a log, a toaster, or a bug report.
func TestVerificationNeverEchoesTheSecret(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		fmt.Fprintf(w, `{"error":"upstream rejected","authorization":%q}`, r.Header.Get("Authorization"))
	}))
	defer server.Close()

	t.Setenv(billing.EnvSecretKey, testSecret)

	v := newVerifier(time.Minute)
	v.baseURL = server.URL

	out := v.verify(context.Background(), "cs_test")

	if out.Checked {
		t.Fatal("a 500 was reported as a completed check")
	}
	if out.Error == "" {
		t.Fatal("a 500 produced no explanation")
	}
	if strings.Contains(out.Error, testSecret) {
		t.Fatalf("the secret key reached the error string: %q", out.Error)
	}
	if strings.Contains(out.Error, "sk_testkey") {
		t.Fatalf("a key-shaped token survived redaction: %q", out.Error)
	}

	// And the same must hold for everything that crosses the bridge.
	encoded, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if strings.Contains(string(encoded), testSecret) {
		t.Fatalf("the secret key is present in the payload sent to the interface: %s", encoded)
	}

	// The status payload is the other thing the interface receives.
	statusEncoded, err := json.Marshal(v.status("cs_test"))
	if err != nil {
		t.Fatalf("marshal status: %v", err)
	}
	if strings.Contains(string(statusEncoded), testSecret) {
		t.Fatalf("the secret key is present in the status payload: %s", statusEncoded)
	}
}

func TestVerificationCachesWithinItsTTL(t *testing.T) {
	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		atomic.AddInt32(&calls, 1)
		fmt.Fprint(w, subscriberBody("2027-08-01T10:00:00Z"))
	}))
	defer server.Close()

	t.Setenv(billing.EnvSecretKey, testSecret)

	v := newVerifier(time.Minute)
	v.baseURL = server.URL

	for i := 0; i < 5; i++ {
		if out := v.verify(context.Background(), "cs_test"); !out.Checked {
			t.Fatalf("call %d did not complete: %q", i, out.Error)
		}
	}

	if got := atomic.LoadInt32(&calls); got != 1 {
		t.Errorf("RevenueCat was called %d times, want 1: re-rendering the interface must not hammer the API", got)
	}
}

func TestRedactScrubsKeyShapes(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"Bearer sk_live_abcdef123456 rejected", "Bearer [redacted] rejected"},
		{"key rcb_webBilling1234567 was rejected", "key [redacted] was rejected"},
		{"nothing to scrub here", "nothing to scrub here"},
	}
	for _, tc := range cases {
		if got := redact(tc.in, testSecret); got != tc.want {
			t.Errorf("redact(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestVerificationStatusNeverCarriesTheKey covers the "not even a prefix" claim.
func TestVerificationStatusNeverCarriesTheKey(t *testing.T) {
	t.Setenv(billing.EnvSecretKey, testSecret)

	v := newVerifier(time.Minute)
	status := v.status("cs_test")

	encoded, err := json.Marshal(status)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	payload := string(encoded)

	if strings.Contains(payload, testSecret) || strings.Contains(payload, "sk_testkey") {
		t.Fatalf("status leaked key material: %s", payload)
	}
	if !status.Available {
		t.Errorf("a well-formed secret key should enable verification, reason: %q", status.Reason)
	}
}
