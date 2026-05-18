#!/usr/bin/env python3
"""Migrate Linear Board web-era data → Tauri .app data dir.

Web mode (v0.25.x and earlier) stored snapshots and view boards under
`<repo>/public/data/`. The Tauri runtime (v0.26.0+) reads from
`~/Library/Application Support/com.han.linearboard/data/` instead. Run this
script once on each mac that has unmigrated `public/data/` to copy everything
across — the .app then loads it as if it were native.

Usage:
    python3 scripts/migrate_web_to_app.py             # default source = <repo>/public/data
    python3 scripts/migrate_web_to_app.py --dry-run   # preview, write nothing
    python3 scripts/migrate_web_to_app.py --force     # back up + overwrite a non-empty dest
    python3 scripts/migrate_web_to_app.py --source /path/to/other/repo/public/data

Defaults:
    --source: this script's repo `public/data/` (script-dir/..)
    --dest:   ~/Library/Application Support/com.han.linearboard/data

The script:
  1. Validates the source looks like a web-era data dir (has at least one of
     `issues.json`, `working_on/`, `custom/`).
  2. Prints a summary (snapshot date, view counts).
  3. Refuses to overwrite a non-empty dest unless `--force` is passed.
     With `--force`, the existing dest is renamed to
     `data.bak-migrate-<timestamp>` and then the copy proceeds.
  4. Recursively copies the entire source tree into dest, preserving mtimes.

Stdlib only. No external deps.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_DEST = Path("~/Library/Application Support/com.han.linearboard/data").expanduser()
SOURCE_SIGNALS = ["issues.json", "working_on", "custom", "all_issues_board.json"]


def validate_source(src: Path) -> tuple[bool, str]:
    if not src.exists():
        return False, f"source does not exist: {src}"
    if not src.is_dir():
        return False, f"source is not a directory: {src}"
    if not any((src / name).exists() for name in SOURCE_SIGNALS):
        return False, (
            f"source has no expected files at all (looking for any of: "
            f"{', '.join(SOURCE_SIGNALS)}) — refusing to copy what looks "
            f"like the wrong directory: {src}"
        )
    return True, ""


def summarize(src: Path) -> None:
    print("source summary:")

    issues = src / "issues.json"
    if issues.is_file():
        try:
            data = json.loads(issues.read_text())
            print(
                f"  issues.json: fetchedAt={data.get('fetchedAt')} "
                f"count={data.get('count')}"
            )
        except Exception as e:
            print(f"  issues.json: present but unreadable ({e})")
    else:
        print("  issues.json: (missing)")

    for dir_name, prefix in (("working_on", "wov_"), ("custom", "cv_")):
        d = src / dir_name
        if d.is_dir():
            boards = sorted(p for p in d.iterdir() if p.suffix == ".json" and p.name.startswith(prefix))
            manifest = (d / "views.json").is_file()
            print(
                f"  {dir_name}/: {len(boards)} board(s)"
                f"{' + views.json' if manifest else ' (manifest MISSING — Tauri will rebuild empty)'}"
            )
        else:
            print(f"  {dir_name}/: (missing)")

    if (src / "all_issues_board.json").is_file():
        print("  all_issues_board.json: present")


def copy_tree(src: Path, dest: Path, dry_run: bool) -> int:
    """Recursively copy src/* into dest, preserving mtimes. Returns file count."""
    files_copied = 0
    for child in sorted(src.rglob("*")):
        rel = child.relative_to(src)
        target = dest / rel
        if child.is_dir():
            if not dry_run:
                target.mkdir(parents=True, exist_ok=True)
            print(f"  mkdir {target}")
        else:
            if not dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, target)
            print(f"  copy  {child}  ->  {target}")
            files_copied += 1
    return files_copied


def main() -> int:
    here = Path(__file__).resolve().parent  # scripts/
    repo_root = here.parent
    default_source = repo_root / "public" / "data"

    p = argparse.ArgumentParser(
        description="Copy <repo>/public/data → ~/Library/Application Support/com.han.linearboard/data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--source", type=Path, default=default_source)
    p.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    p.add_argument("--dry-run", action="store_true", help="print what would happen, write nothing")
    p.add_argument(
        "--force",
        action="store_true",
        help="back up the existing dest (rename to data.bak-migrate-<ts>) and overwrite",
    )
    args = p.parse_args()

    src = args.source.expanduser().resolve()
    dest = args.dest.expanduser()

    print(f"source: {src}")
    print(f"dest:   {dest}")
    if args.dry_run:
        print("(dry-run — no changes will be written)")
    print()

    ok, msg = validate_source(src)
    if not ok:
        print(f"error: {msg}", file=sys.stderr)
        return 1

    summarize(src)
    print()

    if dest.exists() and any(dest.iterdir()):
        if not args.force:
            print(
                f"error: dest is not empty: {dest}\n"
                f"       launch the .app once first to see what's there, then either:\n"
                f"       (a) accept that state and skip migration, or\n"
                f"       (b) re-run with --force to back it up and overwrite.",
                file=sys.stderr,
            )
            return 2
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = dest.parent / f"{dest.name}.bak-migrate-{ts}"
        print(f"--force: backing up existing dest")
        print(f"  {dest}  ->  {backup}")
        if not args.dry_run:
            shutil.move(str(dest), str(backup))
        print()
    elif not dest.exists():
        print(f"dest does not exist yet — will create.")
        if not args.dry_run:
            dest.mkdir(parents=True, exist_ok=True)
        print()

    print(f"{'would copy' if args.dry_run else 'copying'}:")
    n = copy_tree(src, dest, args.dry_run)
    print()
    print(f"{'would copy' if args.dry_run else 'copied'} {n} file(s)")

    if args.dry_run:
        print("\n(dry-run — re-run without --dry-run to apply)")
    else:
        print(f"\ndone. Launch the .app and verify your views are visible:")
        print(f"  open '~/Applications/Linear Board.app'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
