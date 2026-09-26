package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// RemediationResult is what the interface shows after running a generated script.
type RemediationResult struct {
	Ran        bool   `json:"Ran"`
	Script     string `json:"Script"`
	Output     string `json:"Output"`
	Error      string `json:"Error"`
	ExitCode   int    `json:"ExitCode"`
	DurationMS int64  `json:"DurationMS"`
}

// remediationScripts are the only files this app will execute.
//
// The generated scripts are the destructive end of this product, so the surface
// here is deliberately small: two known filenames, no arguments of any kind, the
// output captured, and a hard deadline. Anything else is left to be run by hand,
// which is the right place for it.
var remediationScripts = map[string]bool{
	"safe_cleanup.sh": true, // freeze: snapshot, stop, detach
	"undo_cleanup.sh": true, // restore from the tombstones
}

const (
	remediationTimeout = 10 * time.Minute
	// maxRemediationOutput bounds what crosses the bridge, so a script stuck in a
	// loop cannot push an unbounded amount of text into the window.
	maxRemediationOutput = 32 * 1024
)

// RunRemediation runs one of the generated remediation scripts.
//
// It exists so the workflow the scripts describe does not have to be carried out
// by hand in a terminal: the interface offers the action, states what it will do
// to the account, and then shows exactly what the script said.
//
// Requires a POSIX shell, which matches how the CLI already works: this project
// does not support native Windows.
func (d *Desktop) RunRemediation(script string) RemediationResult {
	name := filepath.Base(strings.TrimSpace(script))
	if !remediationScripts[name] {
		return RemediationResult{Script: name, Error: "that script cannot be run from here"}
	}

	d.mu.RLock()
	outputDir := d.prefs.OutputDir
	d.mu.RUnlock()

	path := filepath.Join(outputDir, name)
	if _, err := os.Stat(path); err != nil {
		return RemediationResult{Script: name, Error: fmt.Sprintf("%s has not been generated yet", name)}
	}

	ctx, cancel := context.WithTimeout(context.Background(), remediationTimeout)
	defer cancel()

	// Run from the output directory, because the scripts address their sibling
	// files by relative path.
	cmd := exec.CommandContext(ctx, "sh", name)
	cmd.Dir = outputDir

	started := time.Now()
	combined, err := cmd.CombinedOutput()

	result := RemediationResult{
		Ran:        true,
		Script:     name,
		Output:     truncateOutput(string(combined)),
		DurationMS: time.Since(started).Milliseconds(),
	}

	if err != nil {
		result.Error = err.Error()
		if exitErr, ok := err.(*exec.ExitError); ok {
			result.ExitCode = exitErr.ExitCode()
		} else {
			result.ExitCode = -1
		}
	}

	return result
}

func truncateOutput(s string) string {
	if len(s) <= maxRemediationOutput {
		return s
	}
	return s[:maxRemediationOutput] + "\n… output truncated"
}
