package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestResolveDirIgnoresWorkingDirectory reproduces the launch conditions of a
// bundled window: a working directory of "/" must not turn a relative default
// into a path beside the volume root.
func TestResolveDirIgnoresWorkingDirectory(t *testing.T) {
	original, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	if err := os.Chdir("/"); err != nil {
		t.Fatalf("chdir to root: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(original) })

	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("home dir: %v", err)
	}

	got, err := resolveDir("cloudslash-out")
	if err != nil {
		t.Fatalf("resolveDir: %v", err)
	}
	if !filepath.IsAbs(got) {
		t.Fatalf("expected an absolute path, got %q", got)
	}
	if !strings.HasPrefix(got, home) {
		t.Fatalf("expected a path under %q, got %q", home, got)
	}
	if got == "/cloudslash-out" {
		t.Fatalf("resolved against the working directory: %q", got)
	}
}

func TestDefaultOutputDirIsAbsolute(t *testing.T) {
	got := defaultPrefs().OutputDir
	if !filepath.IsAbs(got) {
		t.Fatalf("default output dir must be absolute, got %q", got)
	}
	if isVolumeRootChild(got) {
		t.Fatalf("default output dir sits beside the volume root: %q", got)
	}
}

func TestEnsureDirRefusesVolumeRootChildren(t *testing.T) {
	if err := ensureDir("/cloudslash-out"); err == nil {
		t.Fatal("expected a refusal for a path directly under the volume root")
	}
	if _, err := os.Stat("/cloudslash-out"); err == nil {
		_ = os.RemoveAll("/cloudslash-out")
		t.Fatal("ensureDir created a directory it should have refused")
	}
}

func TestEnsureDirCreatesUnderHome(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "nested", "out")
	if err := ensureDir(dir); err != nil {
		t.Fatalf("ensureDir: %v", err)
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		t.Fatalf("directory was not created: %v", err)
	}
}

func TestIsVolumeRootChild(t *testing.T) {
	cases := map[string]bool{
		"/":               true,
		"/cloudslash-out": true,
		"/tmp":            true,
		"/tmp/out":        false,
		"/Users/x/out":    false,
		"":                true,
	}
	for path, want := range cases {
		if got := isVolumeRootChild(path); got != want {
			t.Errorf("isVolumeRootChild(%q) = %v, want %v", path, got, want)
		}
	}
}
