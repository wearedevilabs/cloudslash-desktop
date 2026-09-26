package aws

import (
	"os"
	"path/filepath"
	"testing"
)

const sampleConfig = `
[default]
region = us-east-1

[profile staging]
region = eu-west-1

[profile legacy]
output = json
`

// isolate points the shared-config reader at a throwaway file and clears the
// environment, so the test does not depend on the machine it runs on.
func isolate(t *testing.T, body string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	t.Setenv("AWS_CONFIG_FILE", path)
	t.Setenv("AWS_REGION", "")
	t.Setenv("AWS_DEFAULT_REGION", "")
}

func TestResolveRegionReadsTheProfileRegion(t *testing.T) {
	isolate(t, sampleConfig)

	cases := map[string]string{
		"":          "us-east-1", // the default profile
		"default":   "us-east-1",
		"staging":   "eu-west-1",
		"legacy":    DefaultRegion, // no region declared
		"absent":    DefaultRegion, // profile not in the file
		"  staging": "eu-west-1",   // whitespace tolerated
	}
	for profile, want := range cases {
		if got := ResolveRegion(profile); got != want {
			t.Errorf("ResolveRegion(%q) = %q, want %q", profile, got, want)
		}
	}
}

func TestResolveRegionPrefersTheEnvironment(t *testing.T) {
	isolate(t, sampleConfig)

	t.Setenv("AWS_DEFAULT_REGION", "ap-south-1")
	if got := ResolveRegion("staging"); got != "ap-south-1" {
		t.Errorf("AWS_DEFAULT_REGION should win over the profile, got %q", got)
	}

	// AWS_REGION is the more specific of the two.
	t.Setenv("AWS_REGION", "us-west-2")
	if got := ResolveRegion("staging"); got != "us-west-2" {
		t.Errorf("AWS_REGION should win over AWS_DEFAULT_REGION, got %q", got)
	}
}

func TestResolveRegionIgnoresBlankEnvironment(t *testing.T) {
	isolate(t, sampleConfig)

	t.Setenv("AWS_REGION", "   ")
	t.Setenv("AWS_DEFAULT_REGION", "")
	if got := ResolveRegion("staging"); got != "eu-west-1" {
		t.Errorf("a blank environment value must not win, got %q", got)
	}
}

func TestResolveRegionWithoutAConfigFile(t *testing.T) {
	t.Setenv("AWS_CONFIG_FILE", filepath.Join(t.TempDir(), "does-not-exist"))
	t.Setenv("AWS_REGION", "")
	t.Setenv("AWS_DEFAULT_REGION", "")

	if got := ResolveRegion("staging"); got != DefaultRegion {
		t.Errorf("a missing config file should fall back to %q, got %q", DefaultRegion, got)
	}
}

func TestSectionName(t *testing.T) {
	cases := map[string]string{
		"[profile staging]":   "staging",
		"[staging]":           "staging",
		"[ profile  spaced ]": "spaced",
		"[default]":           "default",
	}
	for header, want := range cases {
		if got := SectionName(header); got != want {
			t.Errorf("SectionName(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestDescribeRegionNamesItsSource(t *testing.T) {
	isolate(t, sampleConfig)

	if got := DescribeRegion("staging"); got != "eu-west-1 (from the staging profile)" {
		t.Errorf("DescribeRegion(staging) = %q", got)
	}

	t.Setenv("AWS_REGION", "us-west-2")
	if got := DescribeRegion("staging"); got != "us-west-2 (from AWS_REGION)" {
		t.Errorf("DescribeRegion with env = %q", got)
	}

	t.Setenv("AWS_REGION", "")
	t.Setenv("AWS_DEFAULT_REGION", "")
	if got := DescribeRegion("legacy"); got != DefaultRegion+" (default)" {
		t.Errorf("DescribeRegion(legacy) = %q", got)
	}
}

func TestResolvedRegionIgnoresCommentsAndOtherKeys(t *testing.T) {
	isolate(t, `
[profile prod]
# region = us-east-1 is commented out
output = json
region = eu-central-1
`)

	if got := ResolveRegion("prod"); got != "eu-central-1" {
		t.Errorf("a commented region must be skipped, got %q", got)
	}
}
