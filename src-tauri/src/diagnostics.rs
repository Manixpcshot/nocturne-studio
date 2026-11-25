use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const MAX_BYTES: u64 = 256 * 1024;
const MAX_ENTRIES: usize = 400;
static FILES: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
pub struct Entry {
    time: u64,
    area: String,
    action: String,
    phase: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    elapsed_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    operation: Option<String>,
}

pub fn area(action: &str) -> Option<&'static str> {
    Some(match action {
        "generate" | "edit_image" | "test_image_runtime" | "save_temporary_image" => "image",
        "generate_video" => "video",
        "tts_generate" | "tts_info" | "tts_search" => "voice",
        "chat_generate" | "chat_hf_info" | "chat_search" => "chat",
        "batch_generate" | "batch_queue" | "media_workflow_job" => "queue",
        "download" | "tts_download" | "chat_pull" | "download_parts_delete" => "downloads",
        "load" | "unload" | "info" | "search" | "hf_login" | "device" | "cache_mode" => "models",
        "project_reference" | "delete_image" => "gallery",
        "storage" | "set_output_folder" | "set_model_folder" => "storage",
        "web_start" | "web_stop" | "web_public_start" | "web_public_stop" | "web_create_user" |
        "web_set_password" | "web_revoke_user" | "web_settings" | "web_generate" => "website",
        "startup" | "setup_install" | "update_diffusers_engine" | "install_app_update" |
        "python_runtime" | "interface" => "system",
        _ => return None,
    })
}

// Classify incoming exceptions locally. Never save raw messages or command payloads.
pub fn error_code(message: &str, kind: Option<&str>) -> &'static str {
    let text = message.to_ascii_lowercase();
    if text.contains("no space") || text.contains("disk full") || text.contains("فضای کافی") {
        "disk"
    } else if text.contains("out of memory") || matches!(kind, Some("MemoryError" | "OutOfMemoryError")) {
        "memory"
    } else if text.contains("401") || text.contains("403") || text.contains("gated") {
        "access"
    } else if text.contains("checksum") || text.contains("sha256") || text.contains("صحت فایل") {
        "integrity"
    } else if text.contains("connection") || text.contains("timeout") ||
        matches!(kind, Some("ConnectionError" | "ConnectTimeout" | "ReadTimeout" | "TimeoutExpired")) {
        "connection"
    } else if text.contains("modulenotfounderror") || matches!(kind, Some("ModuleNotFoundError" | "ImportError")) {
        "dependency"
    } else if text.contains("موتور python بسته شد") || text.contains("broken pipe") {
        "worker_exit"
    } else if matches!(kind, Some("FileNotFoundError")) {
        "missing_file"
    } else if matches!(kind, Some("ValueError" | "TypeError")) {
        "invalid_input"
    } else {
        "failed"
    }
}

fn paths(directory: &Path) -> [PathBuf; 2] {
    [directory.join("activity.jsonl"), directory.join("activity.previous.jsonl")]
}

fn append(directory: &Path, entry: &Entry) -> io::Result<()> {
    let current = &paths(directory)[0];
    let previous = &paths(directory)[1];
    fs::create_dir_all(directory)?;
    let mut line = serde_json::to_vec(entry)?;
    line.push(b'\n');
    if current.metadata().is_ok_and(|meta| meta.len() + line.len() as u64 > MAX_BYTES) {
        match fs::remove_file(previous) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        fs::rename(current, previous)?;
    }
    OpenOptions::new().create(true).append(true).open(current)?.write_all(&line)
}

fn read(directory: &Path) -> io::Result<Vec<Entry>> {
    let mut result = Vec::new();
    for file in paths(directory) {
        let bytes = match fs::read(file) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error),
        };
        let text = String::from_utf8_lossy(&bytes);
        result.extend(text.lines().rev().filter_map(|line| serde_json::from_str(line).ok())
            .take(MAX_ENTRIES.saturating_sub(result.len())));
    }
    Ok(result)
}

pub struct Operation {
    id: String,
    action: String,
    start: Instant,
    stages: std::collections::HashSet<(&'static str, u64)>,
}

impl Operation {
    pub fn begin(app: &AppHandle, action: &str) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let id = format!("{:x}-{:x}-{:x}", now(), std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed));
        let task = Self { id, action: action.into(), start: Instant::now(), stages: Default::default() };
        write(app, action, "started", None, None, Some(&task.id));
        task
    }

    pub fn progress(&mut self, app: &AppHandle, event: &str, data: &serde_json::Value) {
        let Some((stage, attempt)) = progress_stage(event, data) else { return; };
        if self.stages.len() >= 32 || !self.stages.insert((stage, attempt)) { return; }
        write(app, &self.action, if stage == "retrying" { "retry" } else { "progress" },
            Some(stage), Some(self.start), Some(&self.id));
    }

    pub fn finish(&self, app: &AppHandle, result: &Result<serde_json::Value, String>, cancelled: bool) {
        let (phase, code) = result_status(result, cancelled);
        write(app, &self.action, phase, code, Some(self.start), Some(&self.id));
    }
}

fn progress_stage(event: &str, data: &serde_json::Value) -> Option<(&'static str, u64)> {
    let stage = match (event, data["phase"].as_str().unwrap_or("")) {
        ("download-progress", "checking") | ("work-progress", "checking") => "checking",
        ("download-progress", "starting" | "transferring") | ("chat-progress", _) => "transferring",
        ("download-progress", "resuming") => "resuming",
        ("download-progress", "retrying") => "retrying",
        ("download-progress", "verifying") => "verifying",
        ("download-progress", "installing") => "installing",
        ("queue-progress", "loading") | ("work-progress", "loading") => "loading",
        ("queue-progress", "generating") | ("batch-progress" | "chat-token", _) |
        ("work-progress", "generating") => "generating",
        ("chat-agent-step", _) => "planning",
        ("work-progress", "saving") => "saving",
        _ => return None,
    };
    Some((stage, if stage == "retrying" { data["attempt"].as_u64().unwrap_or(0) } else { 0 }))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

pub fn record(app: &AppHandle, action: &str, phase: &'static str, code: Option<&'static str>, start: Option<Instant>) {
    write(app, action, phase, code, start, None);
}

fn write(app: &AppHandle, action: &str, phase: &str, code: Option<&str>, start: Option<Instant>, operation: Option<&str>) {
    let Some(area) = area(action) else { return; };
    let entry = Entry {
        time: now(),
        area: area.into(), action: action.into(), phase: phase.into(), code: code.map(String::from),
        elapsed_ms: start.map(|instant| instant.elapsed().as_millis() as u64),
        operation: operation.map(String::from),
    };
    let Ok(directory) = app.path().app_log_dir() else { return; };
    let Ok(lock) = FILES.lock() else { return; };
    let saved = append(&directory, &entry).is_ok();
    drop(lock);
    if saved {
        let _ = app.emit("activity-changed", ());
    }
}

pub fn outcome(app: &AppHandle, action: &str, result: &Result<serde_json::Value, String>, start: Instant, cancelled: bool) {
    let (phase, code) = result_status(result, cancelled);
    record(app, action, phase, code, Some(start));
}

fn result_status(result: &Result<serde_json::Value, String>, cancelled: bool) -> (&'static str, Option<&'static str>) {
    if cancelled { return ("cancelled", None); }
    let code = match result {
        Err(error) => Some(error_code(error, None)),
        Ok(value) if value["ok"] == false =>
            Some(error_code(value["error"].as_str().unwrap_or(""), value["error_kind"].as_str())),
        _ => None,
    };
    (if code.is_some() { "error" } else { "success" }, code)
}

#[tauri::command]
pub fn activity_read(app: AppHandle) -> Result<Vec<Entry>, String> {
    let directory = app.path().app_log_dir().map_err(|error| error.to_string())?;
    let _lock = FILES.lock().map_err(|error| error.to_string())?;
    read(&directory).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn activity_clear(app: AppHandle) -> Result<(), String> {
    let directory = app.path().app_log_dir().map_err(|error| error.to_string())?;
    {
        let _lock = FILES.lock().map_err(|error| error.to_string())?;
        for file in paths(&directory) {
            match fs::remove_file(file) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.to_string()),
            }
        }
    }
    let _ = app.emit("activity-changed", ());
    Ok(())
}

#[tauri::command]
pub fn activity_interface_error(app: AppHandle) {
    record(&app, "interface", "error", Some("failed"), None);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_without_returning_raw_text() {
        assert_eq!(error_code("secret: unknown token value", None), "failed");
        assert_eq!(error_code("CUDA out of memory", None), "memory");
        assert_eq!(error_code("module details", Some("ModuleNotFoundError")), "dependency");
        assert!(area("private path or prompt").is_none());
    }

    #[test]
    fn progress_ignores_raw_details_and_bounds_duplicates() {
        let event = serde_json::json!({"phase":"retrying", "attempt":3, "file":"private filename"});
        assert_eq!(progress_stage("download-progress", &event), Some(("retrying", 3)));
        assert_eq!(progress_stage("work-progress", &serde_json::json!({"phase":"arbitrary"})), None);
    }

    #[test]
    fn rotates_and_ignores_incomplete_lines() {
        let directory = std::env::temp_dir().join(format!("nocturne-activity-test-{}", std::process::id()));
        fs::create_dir_all(&directory).unwrap();
        let [current, previous] = paths(&directory);
        fs::write(&current, vec![b' '; MAX_BYTES as usize]).unwrap();
        append(&directory, &Entry {
            time: 123, area: "system".into(), action: "startup".into(), phase: "success".into(),
            code: None, elapsed_ms: None, operation: None,
        }).unwrap();
        assert!(previous.is_file());
        assert_eq!(read(&directory).unwrap().len(), 1);
        fs::remove_file(current).unwrap();
        fs::remove_file(previous).unwrap();
        fs::remove_dir(directory).unwrap();
    }
}
