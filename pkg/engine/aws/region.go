package aws

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// DefaultRegion is used when nothing on the machine states a preference.
const DefaultRegion = "us-east-1"

// ResolveRegion picks the region to use when the operator has not chosen one.
// It follows the same order as the AWS CLI: environment, then the profile's own
// configuration, then the historical default.
func ResolveRegion(profile string) string {
	for _, key := range []string{"AWS_REGION", "AWS_DEFAULT_REGION"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	if region := regionFromSharedConfig(profile); region != "" {
		return region
	}
	return DefaultRegion
}

// regionFromSharedConfig reads the region declared for a profile in ~/.aws/config.
func regionFromSharedConfig(profile string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	path := os.Getenv("AWS_CONFIG_FILE")
	if path == "" {
		path = filepath.Join(home, ".aws", "config")
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	wanted := strings.TrimSpace(profile)
	if wanted == "" {
		wanted = "default"
	}

	regionPattern := regexp.MustCompile(`(?i)^region\s*=\s*(\S+)`)
	section := ""

	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			section = SectionName(line)
			continue
		}
		if section != wanted {
			continue
		}
		if matches := regionPattern.FindStringSubmatch(line); len(matches) == 2 {
			return matches[1]
		}
	}
	return ""
}

// SectionName reduces an INI header to the profile name it declares, so
// "[profile staging]" and "[staging]" both read as "staging".
func SectionName(header string) string {
	name := strings.Trim(strings.TrimSpace(header), "[]")
	name = strings.TrimSpace(name)
	name = strings.TrimPrefix(name, "profile ")
	return strings.TrimSpace(name)
}

// DescribeRegion reports where a region came from, for the interface to show.
func DescribeRegion(profile string) string {
	for _, key := range []string{"AWS_REGION", "AWS_DEFAULT_REGION"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return fmt.Sprintf("%s (from %s)", value, key)
		}
	}
	if region := regionFromSharedConfig(profile); region != "" {
		name := strings.TrimSpace(profile)
		if name == "" {
			name = "default"
		}
		return fmt.Sprintf("%s (from the %s profile)", region, name)
	}
	return DefaultRegion + " (default)"
}
