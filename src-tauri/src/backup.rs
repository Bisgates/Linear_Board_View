// Automatic iCloud Drive backup.
//
// Every day at 12:00, 15:00, 18:00, 21:00 and 00:00 local time the entire
// `<app_data_dir>/data/` folder is copied verbatim into
// `~/Library/Mobile Documents/com~apple~CloudDocs/LinearBoardBackup/<YYYYMMDD-HHMM>/`
// and any backup folder older than 30 days is pruned. Missed slots (app not
// running) are not back-filled. If iCloud Drive is disabled — i.e. the
// `com~apple~CloudDocs` directory doesn't exist — the call is a silent no-op.
//
// Local-time math is done via libc's `localtime_r`, so no extra crate is
// pulled in. All date arithmetic uses the broken-down struct from `localtime_r`
// — no homegrown calendar logic. Wall-clock changes (DST jumps, manual reset)
// are handled gracefully because the next sleep duration is always computed
// from the current `SystemTime::now()`.

use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

/// Local-time slots (24h) at which a backup fires. Keep sorted ascending.
const SLOTS_HHMM: &[(u32, u32)] = &[(0, 0), (12, 0), (15, 0), (18, 0), (21, 0)];
/// Backups older than this are pruned on each successful run.
const RETENTION_DAYS: i64 = 30;

#[derive(Clone, Copy, Debug)]
struct LocalTm {
    year: i32,   // full year, e.g. 2026
    month: u32,  // 1..=12
    day: u32,    // 1..=31
    hour: u32,   // 0..=23
    minute: u32, // 0..=59
    second: u32, // 0..=59
}

/// Resolve the iCloud Drive root directory for this app's backups.
/// Returns `None` if iCloud Drive isn't enabled on this machine (i.e. the
/// `com~apple~CloudDocs` folder doesn't exist) — callers treat that as a
/// silent no-op.
pub fn icloud_backup_root() -> Option<PathBuf> {
    let home = home_dir()?;
    let icloud = home
        .join("Library")
        .join("Mobile Documents")
        .join("com~apple~CloudDocs");
    if !icloud.is_dir() {
        return None;
    }
    Some(icloud.join("LinearBoardBackup"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn local_now() -> Option<LocalTm> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?;
    let secs = now.as_secs() as i64;
    localtime(secs)
}

/// Wrap libc's `localtime_r` to convert a Unix timestamp into a local-time
/// broken-down `LocalTm`. `localtime_r` handles DST and the system TZ.
fn localtime(epoch_secs: i64) -> Option<LocalTm> {
    unsafe {
        let t: libc::time_t = epoch_secs as libc::time_t;
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&t, &mut tm).is_null() {
            return None;
        }
        Some(LocalTm {
            year: tm.tm_year + 1900,
            month: (tm.tm_mon + 1) as u32,
            day: tm.tm_mday as u32,
            hour: tm.tm_hour as u32,
            minute: tm.tm_min as u32,
            second: tm.tm_sec as u32,
        })
    }
}

/// Inverse of `localtime`: convert a broken-down local time back into a Unix
/// timestamp via libc's `mktime` (which interprets the input as local time
/// including DST). Mutates the input copy because `mktime` may normalize
/// out-of-range fields.
fn mktime(tm: LocalTm) -> Option<i64> {
    unsafe {
        let mut t: libc::tm = std::mem::zeroed();
        t.tm_year = tm.year - 1900;
        t.tm_mon = (tm.month as i32) - 1;
        t.tm_mday = tm.day as i32;
        t.tm_hour = tm.hour as i32;
        t.tm_min = tm.minute as i32;
        t.tm_sec = tm.second as i32;
        t.tm_isdst = -1; // let libc decide
        let secs = libc::mktime(&mut t);
        if secs == -1 {
            None
        } else {
            Some(secs as i64)
        }
    }
}

/// Compute how many seconds to sleep until the next backup slot.
fn next_slot_delay() -> Duration {
    let Some(now_tm) = local_now() else {
        // Couldn't read local time at all — retry in a minute rather than
        // busy-looping or panicking.
        return Duration::from_secs(60);
    };
    let Some(now_epoch) = mktime(now_tm) else {
        return Duration::from_secs(60);
    };

    // Build candidate slot timestamps for today and tomorrow; pick the
    // smallest one strictly greater than now_epoch.
    let mut candidates: Vec<i64> = Vec::with_capacity(SLOTS_HHMM.len() * 2);
    for (h, m) in SLOTS_HHMM.iter().copied() {
        for day_offset in 0..=1i64 {
            let mut t = now_tm;
            t.hour = h;
            t.minute = m;
            t.second = 0;
            // Advance the day if requested; mktime normalizes overflow
            // (e.g. day=32 → next month) so we don't need a calendar table.
            t.day = t.day.saturating_add(day_offset as u32);
            if let Some(epoch) = mktime(t) {
                if epoch > now_epoch {
                    candidates.push(epoch);
                }
            }
        }
    }
    candidates.sort_unstable();
    let Some(next) = candidates.first().copied() else {
        return Duration::from_secs(60 * 60);
    };
    let secs = (next - now_epoch).max(1) as u64;
    Duration::from_secs(secs)
}

fn format_stamp(tm: &LocalTm) -> String {
    format!(
        "{:04}{:02}{:02}-{:02}{:02}",
        tm.year, tm.month, tm.day, tm.hour, tm.minute
    )
}

/// Parse a `YYYYMMDD-HHMM` directory name back into a `LocalTm` (seconds=0).
/// Returns `None` on any malformed name so unrelated folders are left alone
/// during pruning.
fn parse_stamp(name: &str) -> Option<LocalTm> {
    let bytes = name.as_bytes();
    if bytes.len() != 13 || bytes[8] != b'-' {
        return None;
    }
    let year: i32 = name.get(0..4)?.parse().ok()?;
    let month: u32 = name.get(4..6)?.parse().ok()?;
    let day: u32 = name.get(6..8)?.parse().ok()?;
    let hour: u32 = name.get(9..11)?.parse().ok()?;
    let minute: u32 = name.get(11..13)?.parse().ok()?;
    if month == 0 || month > 12 || day == 0 || day > 31 || hour > 23 || minute > 59 {
        return None;
    }
    Some(LocalTm {
        year,
        month,
        day,
        hour,
        minute,
        second: 0,
    })
}

/// Recursive `cp -R` from `src` to `dst`. Both paths must already exist.
fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_file() {
            fs::copy(&from, &to)?;
        } else {
            // Symlinks etc. — ignore so we don't accidentally follow links
            // out of the data tree. None of our data files are symlinks.
        }
    }
    Ok(())
}

/// Days-between-two-dates ignoring time-of-day, computed via mktime at
/// midnight local time so DST boundaries don't skew the count.
fn days_between(a: &LocalTm, b: &LocalTm) -> Option<i64> {
    let mut a0 = *a;
    a0.hour = 0;
    a0.minute = 0;
    a0.second = 0;
    let mut b0 = *b;
    b0.hour = 0;
    b0.minute = 0;
    b0.second = 0;
    let aa = mktime(a0)?;
    let bb = mktime(b0)?;
    Some((bb - aa) / 86_400)
}

fn prune_old_backups(root: &Path, today: &LocalTm) -> io::Result<u32> {
    let mut pruned = 0u32;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = match name.to_str() {
            Some(s) => s,
            None => continue,
        };
        let Some(tm) = parse_stamp(name_str) else {
            continue;
        };
        let Some(age_days) = days_between(&tm, today) else {
            continue;
        };
        if age_days > RETENTION_DAYS {
            let p = entry.path();
            match fs::remove_dir_all(&p) {
                Ok(()) => {
                    pruned += 1;
                    eprintln!("[backup] pruned {} (age {}d)", name_str, age_days);
                }
                Err(e) => eprintln!("[backup] prune failed for {}: {}", name_str, e),
            }
        }
    }
    Ok(pruned)
}

/// Run one backup pass synchronously. Returns Ok(true) if a snapshot was
/// written, Ok(false) if iCloud is unavailable (treated as a clean no-op).
pub fn run_backup_sync(app: &AppHandle) -> Result<bool, String> {
    let data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?
        .join("data");
    if !data_root.is_dir() {
        eprintln!(
            "[backup] data dir missing ({}), nothing to back up",
            data_root.display()
        );
        return Ok(false);
    }

    let Some(root) = icloud_backup_root() else {
        eprintln!("[backup] iCloud Drive unavailable, skipping backup");
        return Ok(false);
    };
    fs::create_dir_all(&root).map_err(|e| format!("create iCloud root: {e}"))?;

    let now_tm = local_now().ok_or_else(|| "localtime failed".to_string())?;
    let stamp = format_stamp(&now_tm);
    let target = root.join(&stamp);
    // If a backup with the exact same stamp already exists (e.g. two
    // back-to-back manual invocations within the same minute), suffix with
    // seconds to avoid overwriting. Auto-scheduled runs will never collide
    // since slots are >=3h apart.
    let target = if target.exists() {
        let mut t = OsString::from(stamp);
        t.push(format!("-{:02}", now_tm.second));
        root.join(&t)
    } else {
        target
    };
    eprintln!(
        "[backup] copying {} → {}",
        data_root.display(),
        target.display()
    );
    fs::create_dir_all(&target).map_err(|e| format!("create target: {e}"))?;
    copy_dir_recursive(&data_root, &target).map_err(|e| format!("copy: {e}"))?;
    eprintln!("[backup] done");

    if let Err(e) = prune_old_backups(&root, &now_tm) {
        eprintln!("[backup] prune error: {}", e);
    }
    Ok(true)
}

/// Spawn the background scheduler. Sleeps until the next slot then runs
/// `run_backup_sync`, loops forever. Errors are logged and swallowed.
pub fn spawn_scheduler(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let dur = next_slot_delay();
            eprintln!(
                "[backup] next run in {}s ({}m)",
                dur.as_secs(),
                dur.as_secs() / 60
            );
            tokio::time::sleep(dur).await;
            let handle = app.clone();
            // Heavy fs work — push it off the async runtime so we don't stall
            // other tokio tasks while the recursive copy is going.
            let _ = tauri::async_runtime::spawn_blocking(move || {
                if let Err(e) = run_backup_sync(&handle) {
                    eprintln!("[backup] run failed: {}", e);
                }
            })
            .await;
        }
    });
}
