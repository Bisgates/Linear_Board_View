// Linear Board — Tauri 2.x backend.
//
// Bridges the frontend's `fetch("/api/...")` and `fetch("/data/...")` calls to
// local-filesystem reads/writes under the app's data dir. The frontend ships an
// adapter (`src/lib/tauriBridge.ts`) that intercepts those fetches when the
// runtime is Tauri and forwards them to the commands defined below.
//
// Layout under `app_data_dir`:
//   data/
//     issues.json                         <- snapshot from /api/refetch
//     all_issues_board.json               <- /api/all-issues-board
//     working_on/                         <- day-style views
//       views.json                        <- manifest
//       wov_xxxx.json                     <- per-view board
//     custom/                             <- custom views
//       views.json
//       cv_xxxx.json
//     pinned_tabs.json                    <- top-bar pinned chip order
//     ui_prefs.json                       <- UI preferences (theme, …)
//
// All read paths return an empty value (rather than 404) when the file is
// missing — that matches the Vite dev plugin's behaviour and keeps the
// frontend's load logic happy.

mod backup;
mod linear;

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tokio::fs;

#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("invalid viewId: {0:?}")]
    InvalidViewId(String),
    #[error("invalid manifest payload")]
    InvalidManifest,
    #[error("manifest must contain at least one view")]
    EmptyManifest,
    #[error("other: {0}")]
    Other(String),
}

// Errors cross the Tauri IPC boundary as strings — front-end code only ever
// surfaces them to toasts, so a flat `String` is good enough.
impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

// ---------- Paths ----------

fn data_root(app: &AppHandle) -> AppResult<PathBuf> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Other(format!("app_data_dir: {e}")))?;
    Ok(base.join("data"))
}

fn working_on_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_root(app)?.join("working_on"))
}

fn custom_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(data_root(app)?.join("custom"))
}

// Directory holding pasted-image files. Each file is named `<sha256[..16]>.<ext>`
// — content-addressed, so the same image pasted twice dedupes to one file.
async fn images_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let p = data_root(app)?.join("images");
    ensure_dir(&p).await?;
    Ok(p)
}

// Same allowlist as `src/server/boardStore.ts::ID_RE` — viewIds come from the
// frontend via URL path segments, so this guard is load-bearing on the Vite
// side. We keep it identical here even though Tauri commands take typed args
// and don't have a URL-injection surface — the frontend can still pass
// arbitrary ids and we don't want a `../` slipping through.
fn assert_safe_view_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.len() < 3 || id.len() > 64 {
        return Err(AppError::InvalidViewId(id.to_string()));
    }
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(AppError::InvalidViewId(id.to_string()));
    }
    Ok(())
}

async fn ensure_dir(p: &Path) -> AppResult<()> {
    if !p.exists() {
        fs::create_dir_all(p).await?;
    }
    Ok(())
}

async fn read_json_or<T: for<'de> Deserialize<'de>>(path: &Path, fallback: T) -> AppResult<T> {
    match fs::read(path).await {
        Ok(bytes) => Ok(serde_json::from_slice::<T>(&bytes)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(fallback),
        Err(e) => Err(e.into()),
    }
}

async fn read_json_value_or_empty(path: &Path) -> AppResult<Value> {
    match fs::read(path).await {
        Ok(bytes) => Ok(serde_json::from_slice::<Value>(&bytes)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Default::default())),
        Err(e) => Err(e.into()),
    }
}

async fn atomic_write_json(path: &Path, value: &Value) -> AppResult<()> {
    if let Some(dir) = path.parent() {
        ensure_dir(dir).await?;
    }
    let mut tmp = path.to_path_buf();
    let mut name = tmp
        .file_name()
        .map(|n| n.to_os_string())
        .unwrap_or_default();
    name.push(".tmp");
    tmp.set_file_name(name);
    let bytes = serde_json::to_vec_pretty(value)?;
    fs::write(&tmp, &bytes).await?;
    fs::rename(&tmp, path).await?;
    Ok(())
}

// ---------- Board data (validation) ----------

// Minimum-viable validation: ensure required top-level keys exist with the
// right outer types. Field-level validation is delegated to the frontend (and
// also already enforced by the Vite plugin), so we don't need to re-implement
// the full `validate()` from `boardStore.ts` here.
fn normalize_board(raw: Value) -> Value {
    let obj = if raw.is_object() {
        raw
    } else {
        Value::Object(Default::default())
    };
    let mut map = match obj {
        Value::Object(m) => m,
        _ => unreachable!(),
    };
    if !map.get("issueMembers").map(|v| v.is_object()).unwrap_or(false) {
        map.insert("issueMembers".into(), Value::Object(Default::default()));
    }
    if !map.get("noteNodes").map(|v| v.is_array()).unwrap_or(false) {
        map.insert("noteNodes".into(), Value::Array(vec![]));
    }
    if !map.get("edges").map(|v| v.is_array()).unwrap_or(false) {
        map.insert("edges".into(), Value::Array(vec![]));
    }
    if !map.get("groups").map(|v| v.is_array()).unwrap_or(false) {
        map.insert("groups".into(), Value::Array(vec![]));
    }
    Value::Object(map)
}

fn empty_board() -> Value {
    let mut m = serde_json::Map::new();
    m.insert("issueMembers".into(), Value::Object(Default::default()));
    m.insert("noteNodes".into(), Value::Array(vec![]));
    m.insert("edges".into(), Value::Array(vec![]));
    m.insert("groups".into(), Value::Array(vec![]));
    Value::Object(m)
}

// ---------- Manifest ----------

#[derive(Serialize, Deserialize, Clone)]
struct ViewMeta {
    id: String,
    name: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ViewsManifest {
    views: Vec<ViewMeta>,
    #[serde(rename = "activeId")]
    active_id: String,
}

fn now_iso() -> String {
    // Minimalist ISO 8601 timestamp without bringing in `chrono` just for this:
    // SystemTime → epoch ms → naive UTC string. Good enough for createdAt
    // labels that the user can rename anyway.
    use std::time::{SystemTime, UNIX_EPOCH};
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let ms = dur.as_millis();
    // Best-effort YYYY-MM-DDTHH:MM:SSZ from ms. We compute via integer math.
    let secs = (ms / 1000) as i64;
    let (y, mo, d, h, mi, se) = epoch_to_civil(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{se:02}.000Z")
}

// Howard Hinnant's days-from-civil algorithm, slimmed down.
fn epoch_to_civil(secs: i64) -> (i32, u32, u32, u32, u32, u32) {
    let z = secs.div_euclid(86400) + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y } as i32;

    let secs_in_day = secs.rem_euclid(86400) as u32;
    let h = secs_in_day / 3600;
    let mi = (secs_in_day % 3600) / 60;
    let se = secs_in_day % 60;
    (y, m, d, h, mi, se)
}

fn rand_id(prefix: &str) -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let ms = now.as_millis() as u64;
    let nanos = now.subsec_nanos() as u64;
    // Two short base36 chunks; not crypto, just unique enough per-session.
    let a = base36(ms & 0xfff);
    let b = base36(nanos ^ (ms.rotate_left(13)));
    format!("{prefix}_{a}{b}")
}

fn base36(mut n: u64) -> String {
    if n == 0 {
        return "0".into();
    }
    let alphabet = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut out = Vec::new();
    while n > 0 {
        out.push(alphabet[(n % 36) as usize]);
        n /= 36;
    }
    out.reverse();
    String::from_utf8(out).unwrap()
}

fn default_day_name() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let (y, mo, d, _, _, _) = epoch_to_civil((now.as_secs()) as i64);
    // Approximate the JS Sunday-based formatter — for an empty boot view the
    // exact week-of-year doesn't matter for correctness.
    let weekday = day_of_week(y, mo, d);
    let doy = day_of_year(y, mo, d);
    let jan1_dow = day_of_week(y, 1, 1);
    let w = (doy + jan1_dow - 1) / 7 + 1;
    format!("{y:04}-{mo:02}-{d:02} {w}.{weekday}")
}

fn day_of_week(y: i32, m: u32, d: u32) -> u32 {
    // Zeller's congruence, returning Sunday=0..Saturday=6 to match `Date.getDay()`.
    let (y, m) = if m < 3 { (y - 1, m + 12) } else { (y, m) };
    let k = y % 100;
    let j = y / 100;
    let h = (d as i32
        + (13 * (m as i32 + 1)) / 5
        + k
        + k / 4
        + j / 4
        + 5 * j)
        .rem_euclid(7);
    // Zeller's h: 0 = Saturday. Shift so Sunday=0.
    ((h + 6) % 7) as u32
}

fn day_of_year(y: i32, m: u32, d: u32) -> u32 {
    let mdays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let is_leap = (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0);
    let mut total = d;
    for i in 0..(m as usize - 1) {
        total += mdays[i];
        if i == 1 && is_leap {
            total += 1;
        }
    }
    total
}

fn validate_manifest(raw: &Value) -> Option<ViewsManifest> {
    let obj = raw.as_object()?;
    let views_arr = obj.get("views")?.as_array()?;
    let mut views: Vec<ViewMeta> = Vec::with_capacity(views_arr.len());
    for v in views_arr {
        let o = v.as_object()?;
        let id = o.get("id")?.as_str()?.to_string();
        let name = o.get("name")?.as_str()?.to_string();
        let created_at = o.get("createdAt")?.as_str()?.to_string();
        if assert_safe_view_id(&id).is_err() {
            continue;
        }
        views.push(ViewMeta { id, name, created_at });
    }
    if views.is_empty() {
        return None;
    }
    let active_in = obj.get("activeId")?.as_str()?.to_string();
    let active_id = if views.iter().any(|v| v.id == active_in) {
        active_in
    } else {
        views[0].id.clone()
    };
    Some(ViewsManifest { views, active_id })
}

async fn read_or_init_manifest(
    dir: &Path,
    id_prefix: &str,
    default_name: impl FnOnce() -> String,
) -> AppResult<ViewsManifest> {
    let manifest_path = dir.join("views.json");
    if let Ok(bytes) = fs::read(&manifest_path).await {
        if let Ok(parsed) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(m) = validate_manifest(&parsed) {
                return Ok(m);
            }
        }
    }
    // Fresh init: create directory, write one empty board, write manifest.
    ensure_dir(dir).await?;
    let id = rand_id(id_prefix);
    let board_path = dir.join(format!("{id}.json"));
    atomic_write_json(&board_path, &empty_board()).await?;
    let manifest = ViewsManifest {
        views: vec![ViewMeta {
            id: id.clone(),
            name: default_name(),
            created_at: now_iso(),
        }],
        active_id: id,
    };
    let v = serde_json::to_value(&manifest)?;
    atomic_write_json(&manifest_path, &v).await?;
    Ok(manifest)
}

async fn write_manifest_at(dir: &Path, raw: Value) -> AppResult<ViewsManifest> {
    let m = validate_manifest(&raw).ok_or(AppError::InvalidManifest)?;
    if m.views.is_empty() {
        return Err(AppError::EmptyManifest);
    }
    ensure_dir(dir).await?;
    let v = serde_json::to_value(&m)?;
    atomic_write_json(&dir.join("views.json"), &v).await?;
    Ok(m)
}

// ---------- Commands ----------

#[tauri::command]
async fn read_issues_snapshot(app: AppHandle) -> AppResult<Value> {
    let p = data_root(&app)?.join("issues.json");
    // Empty placeholder when the user hasn't synced yet — keeps the frontend
    // happy (it expects `{ issues: [], ... }` shape).
    let fallback = serde_json::json!({
        "fetchedAt": null,
        "count": 0,
        "pages": 0,
        "elapsedMs": 0,
        "issues": [],
        "meta": { "workflowStates": [] }
    });
    read_json_or::<Value>(&p, fallback).await
}

#[tauri::command]
async fn write_issues_snapshot(app: AppHandle, snapshot: Value) -> AppResult<()> {
    let p = data_root(&app)?.join("issues.json");
    atomic_write_json(&p, &snapshot).await
}

#[tauri::command]
async fn read_all_issues_board(app: AppHandle) -> AppResult<Value> {
    let p = data_root(&app)?.join("all_issues_board.json");
    let raw = read_json_value_or_empty(&p).await?;
    Ok(normalize_board(raw))
}

#[tauri::command]
async fn write_all_issues_board(app: AppHandle, data: Value) -> AppResult<Value> {
    let normalized = normalize_board(data);
    let p = data_root(&app)?.join("all_issues_board.json");
    atomic_write_json(&p, &normalized).await?;
    Ok(normalized)
}

#[tauri::command]
async fn read_day_manifest(app: AppHandle) -> AppResult<Value> {
    let dir = working_on_dir(&app)?;
    let m = read_or_init_manifest(&dir, "wov", default_day_name).await?;
    Ok(serde_json::to_value(m)?)
}

#[tauri::command]
async fn write_day_manifest(app: AppHandle, manifest: Value) -> AppResult<Value> {
    let dir = working_on_dir(&app)?;
    let m = write_manifest_at(&dir, manifest).await?;
    Ok(serde_json::to_value(m)?)
}

#[tauri::command]
async fn read_day_view_board(app: AppHandle, view_id: String) -> AppResult<Value> {
    assert_safe_view_id(&view_id)?;
    let p = working_on_dir(&app)?.join(format!("{view_id}.json"));
    let raw = read_json_value_or_empty(&p).await?;
    Ok(normalize_board(raw))
}

#[tauri::command]
async fn write_day_view_board(
    app: AppHandle,
    view_id: String,
    data: Value,
) -> AppResult<Value> {
    assert_safe_view_id(&view_id)?;
    let normalized = normalize_board(data);
    let p = working_on_dir(&app)?.join(format!("{view_id}.json"));
    atomic_write_json(&p, &normalized).await?;
    Ok(normalized)
}

#[tauri::command]
async fn delete_day_view_board(app: AppHandle, view_id: String) -> AppResult<()> {
    assert_safe_view_id(&view_id)?;
    let p = working_on_dir(&app)?.join(format!("{view_id}.json"));
    if p.exists() {
        fs::remove_file(&p).await?;
    }
    Ok(())
}

#[tauri::command]
async fn read_custom_manifest(app: AppHandle) -> AppResult<Value> {
    let dir = custom_dir(&app)?;
    let m = read_or_init_manifest(&dir, "cv", || "Custom 1".to_string()).await?;
    Ok(serde_json::to_value(m)?)
}

#[tauri::command]
async fn write_custom_manifest(app: AppHandle, manifest: Value) -> AppResult<Value> {
    let dir = custom_dir(&app)?;
    let m = write_manifest_at(&dir, manifest).await?;
    Ok(serde_json::to_value(m)?)
}

#[tauri::command]
async fn read_custom_view_board(app: AppHandle, view_id: String) -> AppResult<Value> {
    assert_safe_view_id(&view_id)?;
    let p = custom_dir(&app)?.join(format!("{view_id}.json"));
    let raw = read_json_value_or_empty(&p).await?;
    Ok(normalize_board(raw))
}

#[tauri::command]
async fn write_custom_view_board(
    app: AppHandle,
    view_id: String,
    data: Value,
) -> AppResult<Value> {
    assert_safe_view_id(&view_id)?;
    let normalized = normalize_board(data);
    let p = custom_dir(&app)?.join(format!("{view_id}.json"));
    atomic_write_json(&p, &normalized).await?;
    Ok(normalized)
}

#[tauri::command]
async fn delete_custom_view_board(app: AppHandle, view_id: String) -> AppResult<()> {
    assert_safe_view_id(&view_id)?;
    let p = custom_dir(&app)?.join(format!("{view_id}.json"));
    if p.exists() {
        fs::remove_file(&p).await?;
    }
    Ok(())
}

// ---------- Images (markdown-referenced, content-addressed) ----------
//
// Pasted images are written to `<data>/images/<hash>.jpg` (filename derived
// from the first 16 hex chars of sha256(bytes), so identical pastes dedupe).
// Notes reference them in their body via `![](<hash>.jpg)` markdown tokens,
// served back to the WebView through the custom `imgref://` URI scheme
// registered in `run()`.

#[tauri::command]
async fn save_image_bytes(app: AppHandle, bytes: Vec<u8>) -> AppResult<String> {
    if bytes.is_empty() {
        return Err(AppError::Other("save_image_bytes: empty payload".into()));
    }
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let digest = hasher.finalize();
    // 16 hex chars = 64 bits of entropy — plenty for per-user dedup across a
    // lifetime of pastes, while keeping the markdown token compact.
    let hex = digest
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let filename = format!("{hex}.jpg");
    let dir = images_dir(&app).await?;
    let path = dir.join(&filename);
    if !path.exists() {
        fs::write(&path, &bytes).await?;
    }
    Ok(filename)
}

// Scan every board JSON under `<data>/` (all_issues_board, working_on/wov_*,
// custom/cv_*), collect every `![](<filename>)` reference, then delete files
// in `<data>/images/` that are unreferenced AND older than 7 days. The age
// guard protects images that were just pasted but whose owning board hasn't
// finished its 200ms-debounced save yet.
#[tauri::command]
async fn cleanup_orphan_images(app: AppHandle) -> AppResult<u32> {
    let root = data_root(&app)?;
    let mut referenced: HashSet<String> = HashSet::new();
    let mut json_paths: Vec<PathBuf> = Vec::new();
    let all_issues = root.join("all_issues_board.json");
    if all_issues.exists() {
        json_paths.push(all_issues);
    }
    for sub in ["working_on", "custom"] {
        let dir = root.join(sub);
        if !dir.exists() {
            continue;
        }
        let mut rd = fs::read_dir(&dir).await?;
        while let Some(entry) = rd.next_entry().await? {
            let p = entry.path();
            if p.extension().and_then(|s| s.to_str()) != Some("json") {
                continue;
            }
            if let Some(stem) = p.file_stem().and_then(|s| s.to_str()) {
                if stem == "views" {
                    continue;
                }
            }
            json_paths.push(p);
        }
    }
    // Regex would be cleaner but pulls a crate; the markdown shape is fixed
    // (`![](<hex>.<ext>)`), so a hand-rolled scanner is fine and avoids a dep.
    for jp in &json_paths {
        let Ok(bytes) = fs::read(jp).await else { continue };
        let Ok(text) = std::str::from_utf8(&bytes) else { continue };
        collect_image_refs(text, &mut referenced);
    }
    let imgs_dir = images_dir(&app).await?;
    let mut deleted: u32 = 0;
    let now_secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let seven_days_secs: u64 = 7 * 24 * 60 * 60;
    let mut rd = fs::read_dir(&imgs_dir).await?;
    while let Some(entry) = rd.next_entry().await? {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if referenced.contains(name) {
            continue;
        }
        // mtime guard — skip anything modified within the last 7 days even if
        // it isn't referenced yet (newly pasted, board still flushing).
        let meta = match entry.metadata().await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime_secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(now_secs);
        if now_secs.saturating_sub(mtime_secs) < seven_days_secs {
            continue;
        }
        if fs::remove_file(&path).await.is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

// Walk `text` looking for `![](filename)` tokens where filename is
// `[A-Za-z0-9]+.(jpg|jpeg|png|webp)`. Matches in-place — no allocations per
// hit beyond the inserted String.
fn collect_image_refs(text: &str, out: &mut HashSet<String>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i + 4 <= bytes.len() {
        if &bytes[i..i + 4] == b"![](" {
            let start = i + 4;
            let mut end = start;
            while end < bytes.len() && bytes[end] != b')' {
                end += 1;
            }
            if end < bytes.len() && end > start {
                let inner = &text[start..end];
                if is_valid_image_ref(inner) {
                    out.insert(inner.to_string());
                }
            }
            i = end + 1;
        } else {
            i += 1;
        }
    }
}

fn is_valid_image_ref(s: &str) -> bool {
    let (stem, ext) = match s.rsplit_once('.') {
        Some(parts) => parts,
        None => return false,
    };
    if stem.is_empty() || !stem.chars().all(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    matches!(ext, "jpg" | "jpeg" | "png" | "webp")
}

fn content_type_for(filename: &str) -> &'static str {
    match filename.rsplit_once('.').map(|(_, e)| e) {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => "image/jpeg",
    }
}

// ---------- Pinned tabs ----------
//
// Pinned tabs (the strip of fixed chips in the top bar) used to live in
// localStorage, but WebKit's per-bundle storage can be wiped when the .app is
// replaced by `npm run release`, so we lift the ordered id list into the data
// dir. File shape: `{ "order": ["cv_xxx", "cv_yyy"] }`. The frontend handles
// reconciliation against the live custom-view list — we just store/recall.

#[tauri::command]
async fn read_pinned_tabs(app: AppHandle) -> AppResult<Value> {
    let p = data_root(&app)?.join("pinned_tabs.json");
    let fallback = serde_json::json!({ "order": [] });
    read_json_or::<Value>(&p, fallback).await
}

#[tauri::command]
async fn write_pinned_tabs(app: AppHandle, order: Vec<String>) -> AppResult<()> {
    let p = data_root(&app)?.join("pinned_tabs.json");
    let payload = serde_json::json!({ "order": order });
    atomic_write_json(&p, &payload).await
}

// ---------- UI preferences ----------
//
// Small durable prefs blob (`ui_prefs.json`). Same rationale as pinned tabs:
// WebKit's per-bundle localStorage can be wiped when `npm run release` swaps
// the .app, so prefs that must survive an upgrade live in the data dir. The
// payload is a free-form JSON object — today it only carries the selected
// theme (`{ "theme": "figma" }`), but the shape is deliberately generic so
// future prefs slot in without a new command pair.

#[tauri::command]
async fn read_ui_prefs(app: AppHandle) -> AppResult<Value> {
    let p = data_root(&app)?.join("ui_prefs.json");
    let fallback = serde_json::json!({ "theme": "figma" });
    read_json_or::<Value>(&p, fallback).await
}

#[tauri::command]
async fn write_ui_prefs(app: AppHandle, prefs: Value) -> AppResult<()> {
    let p = data_root(&app)?.join("ui_prefs.json");
    atomic_write_json(&p, &prefs).await
}

// Open a local path / URL via macOS `open`. Mirrors the dev-only
// `POST /api/open` route — Tauri-bundled apps run with the user's privileges,
// so the surface is intentionally identical: anything the user could double-
// click in Finder.
#[tauri::command]
async fn open_path(path: String) -> AppResult<()> {
    if path.is_empty() {
        return Err(AppError::Other("missing path".into()));
    }
    let status = std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| AppError::Other(format!("open: {e}")))?;
    if !status.success() {
        return Err(AppError::Other(format!(
            "open exited with status {status}"
        )));
    }
    Ok(())
}

// Linear API key — read from `LINEAR_API_KEY` env var, then from
// `<app_data_dir>/linear_api_key.txt` as a fallback. Kept as a Tauri command
// for any frontend code that still wants to know whether a key is configured
// (e.g. for a "not connected" UI state). Never logged. Resolution logic lives
// in `linear::resolve_api_key` so the GraphQL commands share the same path.
#[tauri::command]
async fn read_linear_api_key(app: AppHandle) -> AppResult<Option<String>> {
    match linear::resolve_api_key(&app).await {
        Ok(k) => Ok(Some(k)),
        // `resolve_api_key` raises `Other("LINEAR_API_KEY not set …")` when the
        // token is genuinely missing. Treat that as "no key configured" rather
        // than an error so the existing UI flow keeps working.
        Err(AppError::Other(msg)) if msg.starts_with("LINEAR_API_KEY not set") => Ok(None),
        Err(e) => Err(e),
    }
}

// Manual one-shot backup, useful for tester-driven verification (no UI yet —
// backups are scheduled automatically). Returns true if a snapshot was
// written, false if iCloud Drive is unavailable on this machine.
#[tauri::command]
async fn backup_now(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || backup::run_backup_sync(&app))
        .await
        .map_err(|e| format!("join: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // In-app updater (manual trigger from DetailPanel). Plugin is registered
        // unconditionally — the frontend gates the UI surface via `isTauri()`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Companion `relaunch()` after a successful install.
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_issues_snapshot,
            write_issues_snapshot,
            read_all_issues_board,
            write_all_issues_board,
            read_day_manifest,
            write_day_manifest,
            read_day_view_board,
            write_day_view_board,
            delete_day_view_board,
            read_custom_manifest,
            write_custom_manifest,
            read_custom_view_board,
            write_custom_view_board,
            delete_custom_view_board,
            read_pinned_tabs,
            write_pinned_tabs,
            read_ui_prefs,
            write_ui_prefs,
            open_path,
            read_linear_api_key,
            backup_now,
            save_image_bytes,
            cleanup_orphan_images,
            linear::linear_fetch_all_issues,
            linear::linear_fetch_workflow_states,
            linear::linear_update_issue,
            linear::linear_create_issue_comment,
        ])
        // Custom URI scheme that serves pasted images straight from
        // `<data>/images/`. The frontend uses `imgref://localhost/<filename>`
        // as `<img src>` — no fs plugin / asset capability needed because
        // the scheme is wired here in Rust. Sync handler is fine: images
        // are small (≤800px JPEGs, see `pasteImageBlob`).
        .register_uri_scheme_protocol("imgref", |ctx, request| {
            let app = ctx.app_handle();
            let path = request.uri().path();
            let filename = path.trim_start_matches('/');
            if !is_valid_image_ref(filename) {
                return tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::BAD_REQUEST)
                    .body(Vec::new())
                    .unwrap();
            }
            let dir = match data_root(app) {
                Ok(d) => d.join("images"),
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Vec::new())
                        .unwrap();
                }
            };
            let file_path = dir.join(filename);
            match std::fs::read(&file_path) {
                Ok(bytes) => tauri::http::Response::builder()
                    .header("Content-Type", content_type_for(filename))
                    .header("Cache-Control", "private, max-age=31536000, immutable")
                    .body(bytes)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(tauri::http::StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(|app| {
            // Pre-create app_data_dir/data so first-run writes don't race.
            let dir = data_root(&app.handle())?;
            std::fs::create_dir_all(&dir)?;
            // Kick off the iCloud backup scheduler. No-op at runtime if
            // iCloud Drive is disabled; harmless if backup target permission
            // is denied (errors are logged + swallowed).
            backup::spawn_scheduler(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
