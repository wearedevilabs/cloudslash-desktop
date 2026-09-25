package version

// Current is the application version, injected at build time via
// -ldflags "-X github.com/DrSkyle/cloudslash/v2/pkg/version.Current=…".
var Current = "2.2.6"

// BuildMetadata constants.
const AppName = "CloudSlash"
const License = "AGPLv3 (Enterprise)"
const VersionURL = "https://raw.githubusercontent.com/DrSkyle/CloudSlash/main/VERSION"
