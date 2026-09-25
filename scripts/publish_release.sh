#!/bin/bash
# Update an existing GitHub release with the artifacts produced by build_release.sh.
# Requires an authenticated gh CLI.
set -e

VERSION="$(cat VERSION 2>/dev/null || echo v2.2.6)"
NOTES="docs/${VERSION}_RELEASE_NOTES.md"
[ -f "$NOTES" ] || NOTES="docs/v2.2_RELEASE_NOTES.md"
DIST_DIR="dist"

echo "[INFO] Updating release notes for ${VERSION}..."
gh release edit "$VERSION" --title "$VERSION" --notes-file "$NOTES"

echo "[INFO] Uploading assets..."
gh release upload "$VERSION" \
    "$DIST_DIR/cloudslash_darwin_amd64" \
    "$DIST_DIR/cloudslash_darwin_arm64" \
    "$DIST_DIR/cloudslash_linux_amd64" \
    "$DIST_DIR/cloudslash_linux_arm64" \
    "$DIST_DIR/cloudslash_windows_amd64.exe" \
    "$DIST_DIR/install.sh" \
    "$DIST_DIR/install.ps1" \
    "$DIST_DIR/version.txt" \
    --clobber

echo "[SUCCESS] Release ${VERSION} updated."
