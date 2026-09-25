#!/bin/bash
# Build and package the CloudSlash CLI release artifacts into dist/.
#
# The CLI is pure Go, so it cross-compiles for every target from any host.
# The Fyne desktop app uses CGO and cannot be cross-compiled; CI builds it on
# native runners. See .github/workflows/release.yml.
set -e

VERSION="$(cat VERSION)"
LDFLAGS="-s -w -X github.com/DrSkyle/cloudslash/v2/pkg/version.Current=${VERSION}"
INSTALLERS="scripts/install.sh scripts/install.ps1"

mkdir -p dist
rm -f dist/cloudslash_* dist/version.txt dist/SHA256SUMS

echo "Building CloudSlash ${VERSION}..."

# CGO stays off: the CLI does not use it, and leaving it on would make Go pick
# up the host toolchain when target and host share an OS but not an architecture.
for target in linux/amd64 linux/arm64 darwin/amd64 darwin/arm64; do
    os="${target%/*}"
    arch="${target#*/}"
    echo "  ${os}/${arch}"
    GOOS="${os}" GOARCH="${arch}" CGO_ENABLED=0 \
        go build -trimpath -ldflags "${LDFLAGS}" \
        -o "dist/cloudslash_${os}_${arch}" ./cmd/cloudslash-cli
done

echo "  windows/amd64"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
    go build -trimpath -ldflags "${LDFLAGS}" \
    -o dist/cloudslash_windows_amd64.exe ./cmd/cloudslash-cli

echo "Packaging artifacts..."
printf '%s\n' "${VERSION}" > dist/version.txt
for installer in ${INSTALLERS}; do
    cp "${installer}" dist/
done
cp LICENSE dist/LICENSE

if [ -f "docs/${VERSION}_RELEASE_NOTES.md" ]; then
    cp "docs/${VERSION}_RELEASE_NOTES.md" dist/RELEASE_NOTES.md
else
    cp docs/v2.2_RELEASE_NOTES.md dist/RELEASE_NOTES.md
fi

echo "Generating checksums..."
(cd dist && sha256sum cloudslash_* > SHA256SUMS)

echo "Build complete. Artifacts in dist/:"
ls -lh dist/
