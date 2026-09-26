package main

import "testing"

// TestAwsAccessIsWithheldUntilGranted: the profiles on a machine name the people
// and environments its owner works with, so nothing may be read before consent.
func TestAwsAccessIsWithheldUntilGranted(t *testing.T) {
	d := newTestDesktop(t)

	if d.Prefs().AllowAwsAccess {
		t.Fatal("access must not be granted by default")
	}

	env := d.DetectAws()
	if !env.NeedsPermission {
		t.Error("DetectAws should ask for consent rather than reading")
	}
	if len(env.Profiles) != 0 {
		t.Errorf("no profiles should be read before consent, got %v", env.Profiles)
	}
	if env.Region != "" {
		t.Errorf("no region should be resolved before consent, got %q", env.Region)
	}

	if got := d.AwsProfiles(); got.Error == "" {
		t.Error("AwsProfiles should refuse before consent")
	} else if len(got.Profiles) != 0 {
		t.Errorf("AwsProfiles returned profiles before consent: %v", got.Profiles)
	}

	if err := d.StartScan("", false); err == nil {
		t.Error("a live scan should be refused before consent")
	}
}

func TestGrantingAwsAccessIsRemembered(t *testing.T) {
	d := newTestDesktop(t)

	if err := d.GrantAwsAccess(true); err != nil {
		t.Fatalf("GrantAwsAccess(true): %v", err)
	}
	if !d.Prefs().AllowAwsAccess {
		t.Error("consent was not recorded")
	}
	if env := d.DetectAws(); env.NeedsPermission {
		t.Error("DetectAws should not keep asking once consent is given")
	}

	// Withdrawing consent also forgets the chosen profile, so nothing lingers.
	if err := d.SavePrefs(PrefsDTO{Profile: "staging", AllowAwsAccess: true, OutputDir: d.Prefs().OutputDir}); err != nil {
		t.Fatalf("SavePrefs: %v", err)
	}
	if err := d.GrantAwsAccess(false); err != nil {
		t.Fatalf("GrantAwsAccess(false): %v", err)
	}
	if d.Prefs().AllowAwsAccess {
		t.Error("consent was not withdrawn")
	}
	if profile := d.Prefs().Profile; profile != "" {
		t.Errorf("withdrawing consent should forget the profile, got %q", profile)
	}
}

// TestDemoModeNeedsNoConsent: demo mode reads nothing, so it stays available
// even with access refused. It is the way out of a machine with no account.
func TestDemoModeNeedsNoConsent(t *testing.T) {
	d := newTestDesktop(t)

	if err := d.StartScan("", true); err != nil {
		t.Fatalf("a demo scan should not require consent: %v", err)
	}
}
