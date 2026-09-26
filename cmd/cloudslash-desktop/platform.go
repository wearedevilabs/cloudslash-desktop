package main

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
)

// isWSL reports whether this is a Linux userspace running under Windows.
//
// It matters because the Linux build then sits on a Windows host: everything
// works, and the operator is thinking in Windows paths while the app writes
// Linux ones.
func isWSL() bool {
	if runtime.GOOS != "linux" {
		return false
	}
	if os.Getenv("WSL_DISTRO_NAME") != "" || os.Getenv("WSL_INTEROP") != "" {
		return true
	}
	// Older setups only say so in the kernel version string.
	version, err := os.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return strings.Contains(strings.ToLower(string(version)), "microsoft")
}

// platformLabel names the platform the way the operator thinks of it.
func platformLabel() string {
	switch {
	case isWSL():
		return "windows (wsl)"
	case runtime.GOOS == "darwin":
		return "macos"
	default:
		return runtime.GOOS
	}
}

// scriptsRunnable reports whether the generated shell scripts can run here. The
// remediation scripts are POSIX shell, so this is false on native Windows and
// true under WSL.
func scriptsRunnable() bool {
	_, err := exec.LookPath("sh")
	return err == nil
}

// scriptGuidance explains how to run a script when this machine cannot.
func scriptGuidance() string {
	if runtime.GOOS == "windows" && !isWSL() {
		return "The remediation scripts are POSIX shell scripts. Native Windows cannot run them, but they work unchanged inside WSL: open a WSL shell in the artifact folder and run the file there."
	}
	return "These scripts are POSIX shell scripts and this machine has no sh to run them with. Run the file by hand on a host that does."
}
