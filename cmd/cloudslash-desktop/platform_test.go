package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestFileURLForDriveLetters: a Windows path starts with a drive letter rather
// than a slash. Without the added slash the URL reads "C:" as a host and the
// operating system handler refuses it.
func TestFileURLForDriveLetters(t *testing.T) {
	cases := map[string]string{
		"C:/Users/x/Documents/CloudSlash": "file:///C:/Users/x/Documents/CloudSlash",
		"/Users/x/Documents/CloudSlash":   "file:///Users/x/Documents/CloudSlash",
		"/home/x/CloudSlash":              "file:///home/x/CloudSlash",
	}
	for in, want := range cases {
		if got := fileURLFor(in); got != want {
			t.Errorf("fileURLFor(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFileURLForIsAlwaysATripleSlashURL(t *testing.T) {
	for _, in := range []string{"/home/x/CloudSlash", "C:/Users/x/CloudSlash"} {
		got := fileURLFor(in)
		if !strings.HasPrefix(got, "file:///") {
			t.Errorf("fileURLFor(%q) = %q, want a file:/// URL", in, got)
		}
	}
}

func TestFileURLEscapesSpaces(t *testing.T) {
	got := fileURLFor("/Users/x/My Documents/CloudSlash")
	if strings.Contains(got, " ") {
		t.Errorf("a space must be escaped in a file URL, got %q", got)
	}
}

// TestRemediationExplainsAMissingShell: the generated scripts are POSIX shell,
// so a host without one has to say so rather than fail obscurely. This is the
// path a Windows machine takes.
func TestRemediationExplainsAMissingShell(t *testing.T) {
	d := newTestDesktop(t)

	dir := d.Prefs().OutputDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "safe_cleanup.sh"), []byte("#!/bin/sh\ntrue\n"), 0o644); err != nil {
		t.Fatalf("write script: %v", err)
	}

	// Empty PATH, so there is no sh to find.
	t.Setenv("PATH", t.TempDir())

	result := d.RunRemediation("safe_cleanup.sh")
	if result.Ran {
		t.Error("nothing should have been run without a shell")
	}
	if !strings.Contains(result.Error, "POSIX") {
		t.Errorf("the reason should name the problem, got %q", result.Error)
	}
}

// TestOutputDirIsAbsoluteOnAnyPlatform: the default must never be a relative
// path, since a relative one resolves against the working directory and a
// bundled window starts at the volume root.
func TestOutputDirIsAbsoluteOnAnyPlatform(t *testing.T) {
	dir := defaultPrefs().OutputDir
	if !filepath.IsAbs(dir) {
		t.Fatalf("default output dir is relative: %q", dir)
	}
	if strings.Contains(dir, "..") {
		t.Errorf("default output dir should be clean, got %q", dir)
	}
}
