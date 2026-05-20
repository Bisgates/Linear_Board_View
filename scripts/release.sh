#!/usr/bin/env bash
# release.sh — build, install, sign & ship Linear Board .app
#
# Usage:
#   scripts/release.sh prod
#     Requires env vars: TAURI_SIGNING_PRIVATE_KEY (or ~/.tauri/board_updater.key
#     present) + TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
#     -> npm run tauri:build with the canonical conf (signs .app.tar.gz at
#        build time via tauri's createUpdaterArtifacts:true), mv the existing
#        ~/Applications/Linear Board.app to a timestamped backup, cp the
#        fresh bundle in, write latest.json manifest, and `gh release create`
#        the trio (.app.tar.gz, .sig, latest.json) tagged vX.Y.Z.
#     The endpoint in tauri.conf.json points to
#     `releases/latest/download/latest.json` which always resolves to the
#     newest non-draft, non-prerelease release.
#
#   scripts/release.sh dev <suffix> [--reset-data]
#     -> partial-override the conf so productName="Linear Board <suffix>" and
#        identifier="com.han.linearboard.dev.<slug>", build a worktree-local
#        .app, and prepare a dedicated app-data dir seeded from prod data.
#        Re-running without --reset-data preserves the existing dev data dir.
#        Dev builds skip the GitHub Release / updater-manifest step.
#
# This script never modifies src-tauri/tauri.conf.json — the dev override is
# written to src-tauri/tauri.dev.conf.json and passed via `tauri build --config`.

set -euo pipefail

# Ensure cargo / rustc are on PATH (rustup installs to ~/.cargo/bin, which is
# usually only added by shell rc files — `npm run` may not inherit that).
if [ -d "$HOME/.cargo/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.cargo/bin:"*) ;;
    *) export PATH="$HOME/.cargo/bin:$PATH" ;;
  esac
fi

# ---- locate repo root ------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# ---- auto-load .env --------------------------------------------------------
# `npm run release` does not inherit env vars from .env (no dotenv wrapper in
# the npm script). Source the file here so TAURI_SIGNING_PRIVATE_KEY_PASSWORD
# and any other build-time secrets are available without the caller having to
# remember to `source .env` first. `set -a` exports everything that gets set
# while sourcing; `set +a` restores the default. Missing .env is a no-op.
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO_ROOT/.env"
  set +a
fi

BUNDLE_DIR="$REPO_ROOT/src-tauri/target/release/bundle/macos"
PROD_DATA_SRC="$HOME/Library/Application Support/com.han.linearboard/data"
USER_APPS_DIR="$HOME/Applications"
TMP_CONF="$REPO_ROOT/src-tauri/tauri.dev.conf.json"

# ---- helpers ---------------------------------------------------------------
die() { echo "release.sh: $*" >&2; exit 1; }

slugify() {
  # lowercase, non-alnum -> '-', collapse '--', trim leading/trailing '-'
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g' \
    | sed -E 's/^-+|-+$//g'
}

ensure_user_apps_dir() {
  if [ ! -d "$USER_APPS_DIR" ]; then
    echo "creating $USER_APPS_DIR"
    mkdir -p "$USER_APPS_DIR"
  fi
}

# ---- subcommands -----------------------------------------------------------

# Pull the current package.json version. `node -p` keeps the shell free of any
# JSON-parsing fragility (jq isn't a hard requirement on a fresh mac).
read_package_version() {
  node -p "require('$REPO_ROOT/package.json').version"
}

# Pull the VERSION_LOG entry's body for a given version. Best-effort: returns
# the matched heading + all nested bullets until the next top-level entry.
# Entry format (set by CLAUDE.md Pride Versioning rules):
#   - [YYYY-MM-DD HH:MM] vX.Y.Z — title
#     - nested bullet
#     - nested bullet
read_release_notes_for() {
  local version="$1"
  local log="$REPO_ROOT/VERSION_LOG.md"
  if [ ! -f "$log" ]; then
    echo "Release v$version"
    return
  fi
  awk -v v="$version" '
    # Top-level entry boundary: `- [YYYY-MM-DD HH:MM] vX.Y.Z`.
    /^- \[[-0-9 :]+\] v[0-9]+\.[0-9]+\.[0-9]+/ {
      if (in_block) exit
      # Match the wanted version, allowing either a space or em-dash after it.
      if (match($0, "v" v "( |—)")) {
        in_block = 1
        print
        next
      }
    }
    in_block { print }
  ' "$log"
}

# Refuse to ship if package.json / tauri.conf.json / Cargo.toml versions
# disagree. Historically these drifted (tauri.conf.json was stuck at 0.26.2
# for ~10 releases while package.json marched forward), so .app's
# CFBundleShortVersionString lied and the in-app updater showed "v0.26.2 →
# v<latest>" forever. Catch the drift before we build.
assert_version_triplet_aligned() {
  local pkg
  pkg="$(node -p "require('$REPO_ROOT/package.json').version")"
  local conf
  conf="$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/src-tauri/tauri.conf.json','utf8')).version")"
  local cargo
  cargo="$(awk -F\" '/^version[[:space:]]*=/ { print $2; exit }' "$REPO_ROOT/src-tauri/Cargo.toml")"
  if [ "$pkg" != "$conf" ] || [ "$pkg" != "$cargo" ]; then
    cat >&2 <<EOF
release.sh: version mismatch — refusing to build.
  package.json          $pkg
  src-tauri/tauri.conf.json  $conf
  src-tauri/Cargo.toml  $cargo
fix all three to the same vX.Y.Z (and add a VERSION_LOG.md entry) before re-running.
EOF
    exit 1
  fi
}

# Convert "Linear Board" -> the URL-safe form GitHub uses for asset filenames
# (spaces collapsed to `.`). This must EXACTLY match the asset URL we put in
# `latest.json` or the Tauri updater will refuse the download.
asset_url_basename() {
  echo "$1" | tr ' ' '.'
}

release_prod() {
  echo ">> prod release"

  assert_version_triplet_aligned

  # Validate signing env early — `tauri build` with `createUpdaterArtifacts:
  # true` will fail otherwise, but failing here gives a clearer error message.
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
    if [ -f "$HOME/.tauri/board_updater.key" ]; then
      export TAURI_SIGNING_PRIVATE_KEY="$(cat "$HOME/.tauri/board_updater.key")"
      echo ">> loaded TAURI_SIGNING_PRIVATE_KEY from ~/.tauri/board_updater.key"
    else
      die "missing TAURI_SIGNING_PRIVATE_KEY (and ~/.tauri/board_updater.key not found)"
    fi
  fi
  if [ -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]; then
    die "missing TAURI_SIGNING_PRIVATE_KEY_PASSWORD env var (see .env.example)"
  fi

  echo ">> running: npm run tauri:build"
  npm run tauri:build

  local src_app="$BUNDLE_DIR/Linear Board.app"
  [ -d "$src_app" ] || die "expected bundle not found: $src_app"

  local app_tar="$BUNDLE_DIR/Linear Board.app.tar.gz"
  local app_sig="$BUNDLE_DIR/Linear Board.app.tar.gz.sig"
  [ -f "$app_tar" ] || die "expected updater bundle not found: $app_tar (is bundle.createUpdaterArtifacts: true?)"
  [ -f "$app_sig" ] || die "expected signature not found: $app_sig"

  ensure_user_apps_dir
  local dst_app="$USER_APPS_DIR/Linear Board.app"

  if [ -e "$dst_app" ]; then
    local stamp
    stamp="$(date +%Y%m%d-%H%M%S)"
    local backup="$USER_APPS_DIR/Linear Board.app.bak-$stamp"
    echo ">> backing up existing app: $dst_app -> $backup"
    mv "$dst_app" "$backup"
  fi

  echo ">> installing: $src_app -> $dst_app"
  cp -R "$src_app" "$dst_app"

  # ---- updater manifest + GitHub Releases upload ---------------------------
  local version
  version="$(read_package_version)"
  [ -n "$version" ] || die "could not read package.json version"

  local pub_date
  pub_date="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  local signature
  signature="$(cat "$app_sig")"
  [ -n "$signature" ] || die "signature file is empty: $app_sig"

  # GitHub uploads `Linear Board.app.tar.gz` as `Linear.Board.app.tar.gz`
  # (spaces -> dots) — verify with: gh release view vX.Y.Z --json assets
  local asset_basename
  asset_basename="$(asset_url_basename 'Linear Board.app.tar.gz')"
  local asset_url="https://github.com/Bisgates/Linear_Board_View/releases/download/v${version}/${asset_basename}"

  local notes
  notes="$(read_release_notes_for "$version")"
  [ -n "$notes" ] || notes="Release v$version"

  local latest_json="$BUNDLE_DIR/latest.json"
  # Use a heredoc piped into node so we don't have to hand-escape `$signature`
  # (which contains base64 newlines, quotes, etc.).
  VERSION="$version" PUB_DATE="$pub_date" SIGNATURE="$signature" \
    ASSET_URL="$asset_url" NOTES="$notes" \
    node -e '
      const fs = require("fs");
      const out = {
        version: process.env.VERSION,
        notes: process.env.NOTES,
        pub_date: process.env.PUB_DATE,
        platforms: {
          "darwin-aarch64": {
            signature: process.env.SIGNATURE,
            url: process.env.ASSET_URL,
          },
        },
      };
      fs.writeFileSync(process.argv[1], JSON.stringify(out, null, 2));
    ' "$latest_json"
  echo ">> wrote $latest_json"

  if ! command -v gh >/dev/null 2>&1; then
    echo ""
    echo ">> WARNING: gh CLI not found — skipping GitHub Release upload."
    echo "   You can upload manually: $latest_json, $app_tar, $app_sig"
    echo "   Or install gh: brew install gh && gh auth login"
  else
    echo ">> creating GitHub Release v$version"
    # `gh release create` is idempotent only on title/notes. If the tag already
    # exists this fails — caller is expected to bump the version before
    # re-running.
    if gh release view "v$version" >/dev/null 2>&1; then
      die "GitHub release v$version already exists — bump the version before re-running"
    fi
    gh release create "v$version" \
      --title "v$version" \
      --notes "$notes" \
      "$app_tar" "$app_sig" "$latest_json"
    echo ">> uploaded release v$version"
  fi

  echo ""
  echo "============================================================"
  echo "  prod .app:    $dst_app"
  echo "  bundle src:   $src_app"
  echo "  updater bdl:  $app_tar"
  echo "  signature:    $app_sig"
  echo "  manifest:     $latest_json"
  echo "  github asset: $asset_url"
  echo "============================================================"
}

release_dev() {
  local suffix="${1:-}"; shift || true
  [ -n "$suffix" ] || die "dev release requires a <suffix> argument"

  local slug
  slug="$(slugify "$suffix")"
  [ -n "$slug" ] || die "suffix '$suffix' has no usable characters after slugification"

  local reset_data=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --reset-data) reset_data=1; shift ;;
      *) die "unknown flag: $1" ;;
    esac
  done

  local product_name="Linear Board $suffix"
  local identifier="com.han.linearboard.dev.$slug"
  local dev_data_dir="$HOME/Library/Application Support/$identifier/data"

  echo ">> dev release"
  echo "   suffix       = $suffix"
  echo "   slug         = $slug"
  echo "   productName  = $product_name"
  echo "   identifier   = $identifier"
  echo "   data dir     = $dev_data_dir"
  echo "   reset-data   = $reset_data"
  echo ""

  # --- write partial-override conf -----------------------------------------
  # Tauri 2.x `tauri build --config <file>` merges this on top of the
  # default tauri.conf.json — we only override what's different.
  cat > "$TMP_CONF" <<JSON
{
  "productName": "$product_name",
  "identifier": "$identifier",
  "app": {
    "windows": [
      {
        "title": "$product_name"
      }
    ]
  }
}
JSON
  echo ">> wrote override conf -> $TMP_CONF"

  # --- build ---------------------------------------------------------------
  echo ">> running: npx tauri build --config $TMP_CONF"
  npx tauri build --config "$TMP_CONF"

  local src_app="$BUNDLE_DIR/$product_name.app"
  [ -d "$src_app" ] || die "expected bundle not found: $src_app"

  # --- seed / preserve dev data dir ----------------------------------------
  if [ "$reset_data" -eq 1 ] && [ -e "$dev_data_dir" ]; then
    echo ">> --reset-data: removing existing $dev_data_dir"
    rm -rf "$dev_data_dir"
  fi

  if [ ! -d "$dev_data_dir" ]; then
    if [ ! -e "$PROD_DATA_SRC" ]; then
      echo ">> WARNING: prod data source not found at $PROD_DATA_SRC — skipping fixture seed"
      echo "   (the dev .app will create an empty data dir on first launch)"
    else
      echo ">> seeding dev data dir from prod fixture"
      echo "   $PROD_DATA_SRC -> $dev_data_dir"
      mkdir -p "$(dirname "$dev_data_dir")"
      # -L: follow symlinks so we copy the actual prod data files, not the
      # symlink itself. `cp -R` on macOS follows the source symlink by default
      # but we set -L explicitly so we also dereference any nested symlinks.
      cp -RL "$PROD_DATA_SRC" "$dev_data_dir"
    fi
  else
    echo ">> dev data dir already exists — preserving (pass --reset-data to overwrite)"
  fi

  echo ""
  echo "============================================================"
  echo "  dev .app:     $src_app"
  echo "  identifier:   $identifier"
  echo "  data dir:     $dev_data_dir"
  echo "============================================================"
  echo "  open it:      open \"$src_app\""
  echo "============================================================"
}

# ---- dispatch --------------------------------------------------------------
mode="${1:-}"
[ -n "$mode" ] || die "usage: scripts/release.sh prod | dev <suffix> [--reset-data]"
shift

case "$mode" in
  prod) release_prod "$@" ;;
  dev)  release_dev "$@" ;;
  *)    die "unknown mode '$mode' (expected 'prod' or 'dev')" ;;
esac
