package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// defaultOutputDir anchors artifacts to the home directory.
//
// A window opened from a macOS bundle starts with a working directory of "/",
// so a relative default would land beside the volume root, which is read-only.
func defaultOutputDir() string {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "cloudslash-out"
	}
	if runtime.GOOS == "linux" {
		return filepath.Join(home, "CloudSlash")
	}
	return filepath.Join(home, "Documents", "CloudSlash")
}

// resolveDir turns a stored directory into the absolute one the app acts on.
//
// Relative values resolve against the home directory rather than the working
// directory, so the result does not depend on how the window was launched.
func resolveDir(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		value = defaultOutputDir()
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return filepath.Abs(value)
	}
	return filepath.Join(home, value), nil
}

// ensureDir creates a directory the app can write to.
//
// A path directly under the volume root is refused: that is the shape a relative
// path takes when it resolves against "/", and on macOS it cannot be written.
func ensureDir(path string) error {
	cleaned := filepath.Clean(path)
	if isVolumeRootChild(cleaned) {
		return fmt.Errorf("%s is a system location. Choose a folder inside your home directory", cleaned)
	}
	if err := os.MkdirAll(cleaned, 0o755); err != nil {
		return fmt.Errorf("could not create %s: %w", cleaned, err)
	}
	return nil
}

// resolvedOutputDir is resolveDir for callers that cannot report an error.
func resolvedOutputDir(raw string) string {
	if abs, err := resolveDir(raw); err == nil {
		return abs
	}
	return raw
}

// isVolumeRootChild reports whether a path sits directly beneath a volume root.
func isVolumeRootChild(path string) bool {
	rest := strings.TrimPrefix(path, filepath.VolumeName(path))
	rest = strings.Trim(rest, string(filepath.Separator))
	if rest == "" {
		return true
	}
	return !strings.Contains(rest, string(filepath.Separator))
}
