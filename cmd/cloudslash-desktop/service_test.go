package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// newTestDesktop builds a service pointed at a throwaway directory, so the test
// never touches the operator's real preferences or artifacts.
func newTestDesktop(t *testing.T) *Desktop {
	t.Helper()

	dir := t.TempDir()
	prefs := defaultPrefs()
	prefs.Region = "us-east-1"
	prefs.Demo = true
	prefs.OutputDir = filepath.Join(dir, "out")

	d := &Desktop{
		prefs:     prefs,
		prefsPath: filepath.Join(dir, "desktop.json"),
		userID:    "cs_test",
		status:    statusReady,
	}
	t.Cleanup(func() {
		d.mu.Lock()
		d.session = nil
		d.mu.Unlock()
	})
	return d
}

// TestSnapshotIsAlwaysWellFormed guards the contract the interface relies on:
// findings must be an empty array rather than null, so the UI never has to
// handle a missing list.
func TestSnapshotIsAlwaysWellFormed(t *testing.T) {
	d := newTestDesktop(t)

	snap := d.Snapshot()
	if snap.Status != statusReady {
		t.Fatalf("status = %q, want %q", snap.Status, statusReady)
	}
	if snap.Findings == nil {
		t.Fatal("Findings is nil, want an empty slice")
	}
	if snap.TotalNodes != 0 || snap.MonthlyWaste != 0 {
		t.Fatalf("expected zeroed totals before a scan, got %d nodes / %f", snap.TotalNodes, snap.MonthlyWaste)
	}
}

// TestDemoScanProducesFindingsAndArtifacts runs the whole path the interface
// drives: configure, scan, read totals, export an artifact, and confirm the file
// actually landed on disk.
func TestDemoScanProducesFindingsAndArtifacts(t *testing.T) {
	d := newTestDesktop(t)

	if err := d.StartScan("us-east-1", true); err != nil {
		t.Fatalf("StartScan: %v", err)
	}

	deadline := time.Now().Add(90 * time.Second)
	var snap SnapshotDTO
	for time.Now().Before(deadline) {
		snap = d.Snapshot()
		if snap.Status == statusComplete || snap.Status == statusFailed {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}

	if snap.Status != statusComplete {
		t.Fatalf("scan ended as %q: %s", snap.Status, snap.Error)
	}
	if snap.TotalNodes == 0 {
		t.Fatal("scan completed with no resources")
	}
	if snap.WasteCount != len(snap.Findings) {
		t.Fatalf("WasteCount %d disagrees with %d findings", snap.WasteCount, len(snap.Findings))
	}
	if snap.FinishedAt == "" {
		t.Fatal("FinishedAt was not recorded")
	}

	// Every exporter must be offered, ready, and described. None of them is
	// gated: the remediation plan is the reason the tool exists.
	specs := d.ExportSpecs()
	if len(specs) == 0 {
		t.Fatal("no export specs")
	}
	for _, spec := range specs {
		if !spec.Ready {
			t.Fatalf("spec %q should be ready after a completed scan", spec.Kind)
		}
		if spec.Label == "" || spec.Description == "" {
			t.Errorf("spec %q is missing copy the interface needs", spec.Kind)
		}
	}

	path, err := d.Export("json")
	if err != nil {
		t.Fatalf("Export: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("exported file missing: %v", err)
	}
	if info.Size() == 0 {
		t.Fatal("exported file is empty")
	}

	listed := d.Artifacts()
	if len(listed) == 0 {
		t.Fatal("Artifacts did not list the file we just wrote")
	}
	found := false
	for _, artifact := range listed {
		if filepath.Base(path) == artifact.Name {
			found = true
		}
	}
	if !found {
		t.Fatalf("Artifacts did not include %s", filepath.Base(path))
	}
}

// TestStartScanRejectsConcurrentRuns keeps the UI honest: a second press of Run
// scan must be refused rather than silently ignored.
func TestStartScanRejectsConcurrentRuns(t *testing.T) {
	d := newTestDesktop(t)

	if err := d.StartScan("us-east-1", true); err != nil {
		t.Fatalf("first StartScan: %v", err)
	}
	if err := d.StartScan("us-east-1", true); err == nil {
		t.Fatal("second StartScan succeeded, want a refusal while one is running")
	}
}

// TestExportRejectsUnknownKind keeps a bad bridge call from reaching the engine.
func TestExportRejectsUnknownKind(t *testing.T) {
	d := newTestDesktop(t)

	if _, err := d.Export("../../etc/passwd"); err == nil {
		t.Fatal("Export accepted a path instead of a known kind")
	}
}

// TestOpenExternalEnforcesAllowlist is the security-relevant one: findings carry
// attacker-influenced strings, so a link must never be able to send the operator
// somewhere the product did not choose.
func TestOpenExternalEnforcesAllowlist(t *testing.T) {
	d := newTestDesktop(t)

	rejected := []string{
		"https://evil.example.com/steal",
		"http://cloudslash.dev/insecure",
		"file:///etc/passwd",
		"javascript:alert(1)",
		"https://cloudslash.dev.evil.example.com/",
		"not a url at all",
		"",
	}
	for _, target := range rejected {
		if err := d.OpenExternal(target); err == nil {
			t.Errorf("OpenExternal(%q) was allowed, want a rejection", target)
		}
	}
}

// TestOpenArtifactRejectsTraversal confirms a crafted artifact name cannot walk
// out of the output directory.
func TestOpenArtifactRejectsTraversal(t *testing.T) {
	d := newTestDesktop(t)

	for _, name := range []string{"../../../etc/passwd", "/etc/passwd", ""} {
		if err := d.OpenArtifact(name); err == nil {
			t.Errorf("OpenArtifact(%q) was allowed, want a rejection", name)
		}
	}
}

// TestSavePrefsRoundTrips covers the boolean trap: a switch the operator turned
// off must stay off, which is why this replaces the whole struct rather than
// merging field by field.
func TestSavePrefsRoundTrips(t *testing.T) {
	d := newTestDesktop(t)

	updated := defaultPrefs()
	updated.Demo = false
	updated.AllProfiles = true
	updated.MaxConcurrency = 7
	updated.RulesFile = "rules.yaml"
	updated.SlackWebhook = "https://hooks.slack.com/services/x"
	updated.OtelEndpoint = ""

	if err := d.SavePrefs(updated); err != nil {
		t.Fatalf("SavePrefs: %v", err)
	}
	if err := d.persist(); err != nil {
		t.Fatalf("persist: %v", err)
	}

	// Reload through the same path a restart would take.
	reloaded := defaultPrefs()
	userID := loadOrCreateProfile(d.prefsPath, &reloaded)

	if reloaded.Demo {
		t.Error("Demo came back true after being saved false")
	}
	if !reloaded.AllProfiles {
		t.Error("AllProfiles was lost")
	}
	if reloaded.MaxConcurrency != 7 {
		t.Errorf("MaxConcurrency = %d, want 7", reloaded.MaxConcurrency)
	}
	if reloaded.RulesFile != "rules.yaml" {
		t.Errorf("RulesFile = %q, want rules.yaml", reloaded.RulesFile)
	}
	if userID != d.userID {
		t.Errorf("user id changed across a reload: %q -> %q", d.userID, userID)
	}
	if reloaded.OtelEndpoint != "" {
		t.Errorf("OtelEndpoint = %q, want empty", reloaded.OtelEndpoint)
	}
}

// TestSavePrefsGuardsRequiredFields: clearing the output directory in the UI
// must not leave the engine without somewhere to write. An empty region is a
// valid choice, because it means the region is detected instead.
func TestSavePrefsGuardsRequiredFields(t *testing.T) {
	d := newTestDesktop(t)

	blank := PrefsDTO{Region: "  ", OutputDir: "", MaxConcurrency: 0, DiscountRate: 4}
	if err := d.SavePrefs(blank); err != nil {
		t.Fatalf("SavePrefs: %v", err)
	}

	prefs := d.Prefs()
	if prefs.OutputDir == "" {
		t.Error("output directory was left empty")
	}
	if prefs.MaxConcurrency <= 0 {
		t.Error("concurrency was left at zero")
	}
	if prefs.DiscountRate != 1 {
		t.Errorf("DiscountRate = %v, want it clamped to 1", prefs.DiscountRate)
	}
}
