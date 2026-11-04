#!/usr/bin/env bash
# Installs one released version of a widget plugin into a Workspace plugins directory.
#
#   PLUGINS_DIR=/srv/workspace-plugins GITHUB_REPO=<owner>/<repo> \
#     ./install-release.sh <plugin-id> <version>
#
# It downloads <plugin-id>-<version>.tgz, its .sha256 and its .digest from the GitHub Release
# <plugin-id>-v<version> (with the gh CLI; set GH_TOKEN for a private repository), checks the archive's
# SHA-256 and the package's version digest, and places the package at
# $PLUGINS_DIR/<plugin-id>/<version>/, next to the versions already there.
#
# A version already installed with the same digest is left alone; one with a different digest is
# refused, since Workspace blocks a version whose files change. Nothing is approved: a superuser
# rescans and approves the version in Workspace afterwards.
#
# Optional: RELEASE_TAG (default <plugin-id>-v<version>, the tag of one plugin's release in the
# plugins repository); RELEASE_DIR=<folder> reads the three files from a
# local folder instead of GitHub (for a mirror, or to test).

set -euo pipefail

usage() { echo "usage: PLUGINS_DIR=<dir> GITHUB_REPO=<owner>/<repo> $0 <plugin-id> <version>" >&2; exit 2; }
fail() { echo "error: $*" >&2; exit 1; }

[ $# -eq 2 ] || usage
plugin="$1"
version="$2"
: "${PLUGINS_DIR:?set PLUGINS_DIR to the folder Workspace mounts as WIDGET_PLUGINS_DIR}"
tag="${RELEASE_TAG:-${plugin}-v${version}}"

# The names Workspace accepts (manifest.py PLUGIN_ID_PATTERN and VERSION_PATTERN)
[[ "$plugin" =~ ^[a-z][a-z0-9-]{1,47}$ ]] || fail "\"$plugin\" is not a plugin id"
[[ "$version" =~ ^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$ ]] || fail "\"$version\" is not X.Y.Z"
[ -d "$PLUGINS_DIR" ] || fail "$PLUGINS_DIR does not exist"

sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

# The version digest, as Workspace computes it (discovery.py listing_digest): SHA-256, unpadded
# base64url, of the sorted lines "<relative path>\0<sha256 hex>\n" of every file in the folder.
digest_of() {
  local dir="$1"
  (cd "$dir" && find . -type f | sed 's#^\./##' | LC_ALL=C sort | while IFS= read -r path; do
    printf '%s\0%s\n' "$path" "$(sha256 "$path")"
  done) | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=' | sed 's/^/sha256-/'
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="${plugin}-${version}.tgz"

if [ -n "${RELEASE_DIR:-}" ]; then
  for f in "$archive" "$archive.sha256" "${plugin}-${version}.digest"; do
    cp "$RELEASE_DIR/$f" "$work/" || fail "$RELEASE_DIR/$f is missing"
  done
else
  : "${GITHUB_REPO:?set GITHUB_REPO to <owner>/<repo> of the plugins repository}"
  command -v gh >/dev/null || fail "the gh CLI is needed to download releases (or set RELEASE_DIR)"
  gh release download "$tag" --repo "$GITHUB_REPO" --dir "$work" \
    --pattern "$archive" --pattern "$archive.sha256" --pattern "${plugin}-${version}.digest"
fi

expected_sha="$(cut -d' ' -f1 < "$work/$archive.sha256")"
[ "$(sha256 "$work/$archive")" = "$expected_sha" ] || fail "$archive does not match its .sha256"
expected_digest="$(tr -d '[:space:]' < "$work/${plugin}-${version}.digest")"

mkdir "$work/x"
tar -xzf "$work/$archive" -C "$work/x"
package="$work/x/$plugin/$version"
[ -f "$package/plugin.json" ] || fail "$archive does not hold $plugin/$version/plugin.json"
[ "$(ls -A "$work/x")" = "$plugin" ] && [ "$(ls -A "$work/x/$plugin")" = "$version" ] || fail "$archive holds more than $plugin/$version"
[ -z "$(find "$package" -type l -o -name '.*' -print)" ] || fail "$archive holds a symbolic link or a dotfile"
actual_digest="$(digest_of "$package")"
[ "$actual_digest" = "$expected_digest" ] || fail "version digest $actual_digest is not the released $expected_digest"

target="$PLUGINS_DIR/$plugin/$version"
if [ -e "$target" ]; then
  [ "$(digest_of "$target")" = "$expected_digest" ] || fail "$target exists with other files; publish a new version instead"
  echo "$plugin@$version is already installed in $target"
else
  # Copy under a dot name, which Workspace's discovery skips, then rename into place in one step
  mkdir -p "$PLUGINS_DIR/$plugin"
  staging="$PLUGINS_DIR/$plugin/.$version.incoming"
  rm -rf "$staging"
  cp -R "$package" "$staging"
  chmod -R a+rX "$staging"
  mv "$staging" "$target"
  echo "installed $plugin@$version in $target"
fi

echo "version digest $expected_digest"
echo "pin (optional): WIDGET_PLUGINS_PINS={\"$plugin@$version\": \"$expected_digest\"}"
echo "next: in Workspace, Admin > Widgets > Deployment: Rescan, review and approve $plugin $version"
