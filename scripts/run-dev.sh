#!/usr/bin/env bash
# run-dev.sh — start `tauri dev` against the SHARED dev identifier so the
# user's real ~/Library/Application Support/com.han.linearboard/data is never
# touched.
#
# This is the tester agent's runtime. Implementer agents do NOT invoke this —
# they only write code + signal "ready" by enqueueing into
# ~/.linear_board_test_queue/pending/ (see CLAUDE.md "Development Mode").
#
# Single shared identifier:  com.han.linearboard.dev
# Single shared data dir:    ~/Library/Application Support/com.han.linearboard.dev/data
#
# Usage:
#   scripts/run-dev.sh                # launch tauri dev; seed data dir if missing
#   scripts/run-dev.sh --reset-data   # wipe + reseed data dir from prod first

set -euo pipefail

if [ -d "$HOME/.cargo/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.cargo/bin:"*) ;;
    *) export PATH="$HOME/.cargo/bin:$PATH" ;;
  esac
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CONF="$REPO_ROOT/src-tauri/tauri.dev-shared.conf.json"
[ -f "$CONF" ] || { echo "run-dev.sh: missing $CONF" >&2; exit 1; }

PROD_DATA_SRC="$HOME/Library/Application Support/com.han.linearboard/data"
DEV_DATA_DIR="$HOME/Library/Application Support/com.han.linearboard.dev/data"

reset_data=0
while [ $# -gt 0 ]; do
  case "$1" in
    --reset-data) reset_data=1; shift ;;
    *) echo "run-dev.sh: unknown flag '$1'" >&2; exit 1 ;;
  esac
done

if [ "$reset_data" -eq 1 ] && [ -e "$DEV_DATA_DIR" ]; then
  echo ">> --reset-data: removing $DEV_DATA_DIR"
  rm -rf "$DEV_DATA_DIR"
fi

if [ ! -d "$DEV_DATA_DIR" ]; then
  if [ -d "$PROD_DATA_SRC" ]; then
    echo ">> seeding shared dev data from prod"
    echo "   $PROD_DATA_SRC -> $DEV_DATA_DIR"
    mkdir -p "$(dirname "$DEV_DATA_DIR")"
    cp -RL "$PROD_DATA_SRC" "$DEV_DATA_DIR"
  else
    echo ">> prod data not found at $PROD_DATA_SRC — dev app will start with an empty data dir"
  fi
else
  echo ">> reusing existing dev data dir: $DEV_DATA_DIR"
fi

echo ">> launching: npx tauri dev --config $CONF"
exec npx tauri dev --config "$CONF"
