mod diagnostics;

use diagnostics::{activity_read, activity_clear, activity_interface_error};
use std::time::Instant;
use std::collections::HashMap;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn child_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let command = Command::new(program);
    #[cfg(target_os = "windows")]
    let command = {
        let mut command = command;
        command.creation_flags(0x08000000);
        command
    };
    command
}
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
#[repr(C)]
struct MemoryStatus {
    length: u32, load: u32, total_phys: u64, avail_phys: u64,
    total_page: u64, avail_page: u64, total_virtual: u64, avail_virtual: u64,
    avail_extended: u64,
}

#[cfg(target_os = "windows")]
#[link(name = "kernel32")]
extern "system" { fn GlobalMemoryStatusEx(status: *mut MemoryStatus) -> i32; }

#[tauri::command]
async fn hardware_usage(device: String) -> Value {
    tauri::async_runtime::spawn_blocking(move || {
        let mut result = json!({"ram_used": null, "ram_total": null, "gpu_used": null,
            "gpu_total": null, "gpu_percent": null});
        #[cfg(target_os = "windows")]
        {
            let mut status = MemoryStatus { length: std::mem::size_of::<MemoryStatus>() as u32,
                load: 0, total_phys: 0, avail_phys: 0, total_page: 0, avail_page: 0,
                total_virtual: 0, avail_virtual: 0, avail_extended: 0 };
            if unsafe { GlobalMemoryStatusEx(&mut status) } != 0 {
                result["ram_total"] = json!(status.total_phys);
                result["ram_used"] = json!(status.total_phys - status.avail_phys);
            }
        }
        #[cfg(target_os = "linux")]
        if let Ok(contents) = std::fs::read_to_string("/proc/meminfo") {
            let value = |key: &str| contents.lines().find_map(|line| {
                line.strip_prefix(key)?.split_whitespace().next()?.parse::<u64>().ok()
            });
            if let (Some(total), Some(available)) = (value("MemTotal:"), value("MemAvailable:")) {
                result["ram_total"] = json!(total * 1024);
                result["ram_used"] = json!(total.saturating_sub(available) * 1024);
            }
        }
        if let Some(index) = device.strip_prefix("cuda:") {
            let output = child_command("nvidia-smi")
                .args(["--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits", "-i", index]).output();
            if let Ok(output) = output {
                if output.status.success() {
                    let line = String::from_utf8_lossy(&output.stdout);
                    let fields: Vec<_> = line.lines().next().unwrap_or("").split(',').map(str::trim).collect();
                    if fields.len() >= 3 {
                        if let Ok(v) = fields[0].parse::<u64>() { result["gpu_used"] = json!(v * 1024 * 1024); }
                        if let Ok(v) = fields[1].parse::<u64>() { result["gpu_total"] = json!(v * 1024 * 1024); }
                        if let Ok(v) = fields[2].parse::<u64>() { result["gpu_percent"] = json!(v); }
                    }
                }
            }
        }
        result
    }).await.unwrap_or_else(|_| json!({}))
}

#[cfg(target_os = "windows")]
const PYTHON_INSTALLER_URL: &str = "https://www.python.org/ftp/python/3.13.17/python-3.13.17-amd64.exe";
const PYTHON_PACKAGES: &[(&str, &str)] = &[
    ("torch", "torch"), ("diffusers", "diffusers"), ("transformers", "transformers"),
    ("accelerate", "accelerate"), ("safetensors", "safetensors"),
    ("sdnq", "sdnq>=0.2.2"),
    ("huggingface_hub", "huggingface-hub"), ("PIL", "Pillow"),
    ("deep_translator", "deep-translator"), ("sentencepiece", "sentencepiece"),
    ("google.protobuf", "protobuf"), ("tiktoken", "tiktoken"),
    ("requests", "requests"),
    ("psutil", "psutil"),
    ("imageio", "imageio"), ("imageio_ffmpeg", "imageio-ffmpeg"),
];

#[cfg(target_os = "windows")]
fn python_executable(_app: &AppHandle) -> Option<PathBuf> {
    if let Ok(output) = child_command("py").args(["-3.13", "-c", "import sys; print(sys.executable)"])
        .output() {
        if output.status.success() {
            let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
            if path.is_file() { return Some(path); }
        }
    }
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        let path = PathBuf::from(base).join("Programs").join("Python").join("Python313").join("python.exe");
        if path.is_file() { return Some(path); }
    }
    if let Some(base) = std::env::var_os("PROGRAMFILES") {
        let path = PathBuf::from(base).join("Python313").join("python.exe");
        if path.is_file() { return Some(path); }
    }
    None
}

#[cfg(target_os = "linux")]
fn python_executable(app: &AppHandle) -> Option<PathBuf> {
    let python = app.path().app_data_dir().ok()?.join("python/bin/python");
    if python.is_file() { Some(python) } else { None }
}

fn app_storage(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    let path = {
        let _ = app;
        std::env::current_exe().map_err(|error| error.to_string())?
            .parent().ok_or("مسیر برنامه پیدا نشد")?.to_path_buf()
    };
    #[cfg(target_os = "linux")]
    let path = app.path().app_data_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path)
}

fn missing_python_packages(python: &std::path::Path) -> Result<Vec<String>, String> {
    let modules = PYTHON_PACKAGES.iter().map(|(module, _)| *module).collect::<Vec<_>>();
    let script = format!("import importlib.util as u, json\nmissing=[]\nfor name in {}:\n try:\n  found=u.find_spec(name) is not None\n except ModuleNotFoundError:\n  found=False\n if not found: missing.append(name)\nprint(json.dumps(missing))", json!(modules));
    let script = script.replace("\nprint(json.dumps(missing))", "\nif 'sdnq' not in missing:\n try:\n  from importlib.metadata import version\n  from packaging.version import Version\n  if Version(version('sdnq')) < Version('0.2.2'): missing.append('sdnq')\n except Exception:\n  missing.append('sdnq')\nprint(json.dumps(missing))");
    let output = child_command(python).args(["-c", &script])
        .output().map_err(|e| format!("بررسی بسته‌های پایتون ناموفق بود: {e}"))?;
    if !output.status.success() {
        return Err(format!("پایتون اجرا نشد: {}", String::from_utf8_lossy(&output.stderr)));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("پاسخ پایتون نامعتبر بود: {e}"))
}

fn prerequisites_status(app: &AppHandle) -> Result<Value, String> {
    let Some(python) = python_executable(app) else {
        return Ok(json!({"ready": false, "python": false, "missing": PYTHON_PACKAGES.iter().map(|(_, package)| *package).collect::<Vec<_>>() }));
    };
    let missing_modules = missing_python_packages(&python)?;
    let missing = PYTHON_PACKAGES.iter().filter(|(module, _)| missing_modules.contains(&module.to_string()))
        .map(|(_, package)| *package).collect::<Vec<_>>();
    Ok(json!({"ready": missing.is_empty(), "python": true, "python_path": python, "missing": missing}))
}

fn emit_setup(app: &AppHandle, message: &str) {
    let _ = app.emit("setup-progress", json!({"message": message}));
}

fn install_package(app: &AppHandle, python: &std::path::Path, package: &str) -> Result<(), String> {
    let mut indexes = vec![None, Some("https://pypi.tuna.tsinghua.edu.cn/simple")];
    #[cfg(target_os = "linux")]
    if package == "torch" && !child_command("nvidia-smi").arg("-L").output()
        .is_ok_and(|output| output.status.success() && !output.stdout.is_empty()) {
        indexes = vec![Some("https://download.pytorch.org/whl/cpu")];
    }
    for mirror in indexes.drain(..) {
        let mut command = child_command(python);
        command.args(["-m", "pip", "install", "--timeout", "30", "--retries", "1"]);
        if let Some(url) = mirror { command.args(["--index-url", url]); }
        command.arg(package);
        emit_setup(app, &format!("در حال نصب {package}{}...", if mirror.is_some() { " از مسیر جایگزین" } else { "" }));
        if let Ok(status) = command.status() {
            if status.success() { return Ok(()); }
        }
    }
    Err(format!("نصب {package} ناموفق بود. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."))
}

#[tauri::command]
async fn setup_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || prerequisites_status(&app))
        .await
        .map_err(|error| format!("بررسی پیش‌نیازها متوقف شد: {error}"))?
}

#[tauri::command]
async fn update_diffusers_engine(
    app: AppHandle,
    state: State<'_, Arc<Mutex<Option<Backend>>>>,
    minimax: Option<bool>,
) -> Result<Value, String> {
    let state = Arc::clone(&state);
    let started = Instant::now();
    diagnostics::record(&app, "update_diffusers_engine", "started", None, None);
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let app = worker_app;
        {
            let mut guard = state.lock().map_err(|_| "موتور برنامه در دسترس نیست".to_string())?;
            *guard = None;
        }
        let python = python_executable(&app).ok_or("محیط Python پیدا نشد. راه‌اندازی اولیه را اجرا کنید.")?;
        emit_setup(&app, "در حال به‌روزرسانی موتور Diffusers...");
        let minimax = minimax.unwrap_or(false);
        let package = if minimax { "diffusers>=0.43.0" } else { "diffusers" };
        let output = child_command(&python)
            .args(["-m", "pip", "install", "--upgrade", "--timeout", "30", "--retries", "2", package])
            .output().map_err(|e| format!("اجرای به‌روزرسانی ناموفق بود: {e}"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("به‌روزرسانی Diffusers ناموفق بود: {}", error.chars().rev().take(900).collect::<String>().chars().rev().collect::<String>()));
        }
        let check = if minimax {
            "from diffusers import ModularPipeline, ComponentsManager, MiniMaxH3ImageTransformer2DModel; import diffusers; print(diffusers.__version__)"
        } else {
            "import diffusers; print(diffusers.__version__)"
        };
        let version = child_command(&python)
            .args(["-c", check])
            .output().map_err(|e| format!("بررسی موتور تازه ناموفق بود: {e}"))?;
        if !version.status.success() {
            let error = String::from_utf8_lossy(&version.stderr);
            return Err(format!("Diffusers نصب شد، اما اجرای آن ناموفق بود: {}", error.chars().rev().take(900).collect::<String>().chars().rev().collect::<String>()));
        }
        let version = String::from_utf8_lossy(&version.stdout).trim().to_string();
        emit_setup(&app, "موتور Diffusers به‌روز شد.");
        Ok(json!({"version": version}))
    }).await.map_err(|e| format!("به‌روزرسانی متوقف شد: {e}"))?;
    diagnostics::outcome(&app, "update_diffusers_engine", &result, started, false);
    result
}

#[tauri::command]
async fn setup_install(app: AppHandle) -> Result<Value, String> {
    let started = Instant::now();
    diagnostics::record(&app, "setup_install", "started", None, None);
    let worker_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let app = worker_app;
        #[cfg(target_os = "linux")]
        if python_executable(&app).is_none() {
            emit_setup(&app, "در حال ساخت محیط مستقل Python...");
            let runtime = app_storage(&app)?.join("python");
            let status = child_command("python3")
                .args(["-m", "venv"]).arg(&runtime).status()
                .map_err(|error| format!("Python 3 یا python3-venv در دسترس نیست: {error}"))?;
            if !status.success() { return Err("ساخت محیط Python ناموفق بود. بستهٔ python3-venv را بررسی کنید.".into()); }
        }
        #[cfg(target_os = "windows")]
        if python_executable(&app).is_none() {
            emit_setup(&app, "در حال دریافت نصب‌کنندهٔ Python 3.13 از سایت رسمی...");
            let installer = std::env::temp_dir().join("nocturne-python-3.13.17-amd64.exe");
            let download = child_command("curl.exe").args(["--fail", "--location", "--retry", "2", "--output"])
                .arg(&installer).arg(PYTHON_INSTALLER_URL)
                .status().map_err(|e| format!("دریافت Python ناموفق بود: {e}"))?;
            if !download.success() { return Err("دریافت Python از سایت رسمی ناموفق بود.".into()); }
            emit_setup(&app, "در حال نصب Python 3.13...");
            let installed = child_command(&installer)
                .args(["/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_launcher=1", "Include_pip=1", "Include_test=0"])
                .status()
                .map_err(|e| format!("اجرای نصب‌کنندهٔ Python ناموفق بود: {e}"))?;
            if !installed.success() { return Err("نصب Python کامل نشد.".into()); }
        }
        let python = python_executable(&app).ok_or("محیط Python پس از نصب پیدا نشد.")?;
        let pip = child_command(&python).args(["-m", "pip", "--version"])
            .status()
            .map_err(|e| format!("بررسی pip ناموفق بود: {e}"))?;
        if !pip.success() {
            emit_setup(&app, "در حال نصب ابزار بسته‌های Python...");
            let status = child_command(&python).args(["-m", "ensurepip", "--upgrade"])
                .status()
                .map_err(|e| format!("نصب pip ناموفق بود: {e}"))?;
            if !status.success() { return Err("نصب pip ناموفق بود.".into()); }
        }
        let missing = missing_python_packages(&python)?;
        for (module, package) in PYTHON_PACKAGES {
            if missing.contains(&module.to_string()) { install_package(&app, &python, package)?; }
        }
        emit_setup(&app, "در حال بررسی نهایی پیش‌نیازها...");
        let result = prerequisites_status(&app)?;
        if result["ready"] != true { return Err("برخی پیش‌نیازها هنوز نصب نشده‌اند. دوباره تلاش کنید.".into()); }
        Ok(result)
    }).await.map_err(|e| format!("راه‌اندازی متوقف شد: {e}"))?;
    diagnostics::outcome(&app, "setup_install", &result, started, false);
    result
}

struct Backend {
    child: Child,
    stdin: ChildStdin,
    responses: std::sync::mpsc::Receiver<Result<Value, String>>,
    operation: Arc<Mutex<Option<diagnostics::Operation>>>,
}

struct DownloadState {
    active: AtomicBool,
    cancelled: AtomicBool,
    pid: AtomicU32,
}

type DownloadWorkers = Arc<Mutex<HashMap<String, Arc<DownloadState>>>>;
struct ModelDownloadState(DownloadWorkers);

impl DownloadState {
    fn new() -> Self {
        Self { active: AtomicBool::new(false), cancelled: AtomicBool::new(false), pid: AtomicU32::new(0) }
    }

    fn finish(&self) {
        self.active.store(false, Ordering::SeqCst);
        self.pid.store(0, Ordering::SeqCst);
    }
}

impl Drop for Backend {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"action\":\"shutdown\"}\n");
        let _ = self.stdin.flush();
        for _ in 0..20 {
            if matches!(self.child.try_wait(), Ok(Some(_))) { return; }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        #[cfg(unix)]
        let _ = child_command("kill").args(["-KILL", "--", &format!("-{}", self.child.id())]).output();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_backend(app: &AppHandle) -> Result<Backend, String> {
    let script = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("backend.py");
    if !script.exists() {
        return Err(format!("فایل موتور برنامه پیدا نشد: {}", script.display()));
    }
    let exe_dir = app_storage(app)?;
    let settings = exe_dir.join("settings.json");
    let saved_settings = std::fs::read_to_string(&settings).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or_else(|| json!({}));
    let gallery_dir = saved_settings.get("output_folder").and_then(Value::as_str)
        .map(PathBuf::from)
        .or_else(|| std::env::var("NOCTURNE_IMAGES_DIR").ok().map(PathBuf::from))
        .unwrap_or_else(|| exe_dir.join("generated_images"));
    let original_home = std::env::var("HF_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::var(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default().join(".cache/huggingface"));
    let chosen_home = saved_settings.get("model_folder").and_then(Value::as_str).map(PathBuf::from)
        .unwrap_or_else(|| original_home.clone());
    let python = python_executable(&app).ok_or("محیط Python پیدا نشد. راه‌اندازی اولیه را اجرا کنید.")?;
    let mut command = child_command(python);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .arg("-u")
        .arg(script)
        .env("NOCTURNE_IMAGES_DIR", gallery_dir)
        .env("NOCTURNE_APP_DIR", &exe_dir)
        .env("NOCTURNE_ORIGINAL_HF_HOME", original_home)
        .env("HF_HOME", chosen_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("اجرای Python ناموفق بود: {e}"))?;
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        std::thread::spawn(move || {
            use std::io::Read;
            // Drain stderr while retaining only a bounded diagnostic tail in memory.
            let mut reader = BufReader::new(stderr);
            let mut chunk = [0; 8192];
            let mut tail = Vec::new();
            while let Ok(count) = reader.read(&mut chunk) {
                if count == 0 { break; }
                tail.extend_from_slice(&chunk[..count]);
                if tail.len() > 8192 { tail.drain(..tail.len() - 8192); }
            }
            let trace = String::from_utf8_lossy(&tail);
            if trace.contains("ModuleNotFoundError:") || trace.contains("ImportError:") {
                diagnostics::record(&app, "python_runtime", "error", Some("dependency"), None);
            }
        });
    }
    let stdin = child.stdin.take().ok_or("ورودی موتور پیدا نشد")?;
    let stdout = child.stdout.take().ok_or("خروجی موتور پیدا نشد")?;
    let (sender, responses) = std::sync::mpsc::channel();
    let operation = Arc::new(Mutex::new(None::<diagnostics::Operation>));
    let current_operation = Arc::clone(&operation);
    let app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let response = line.map_err(|error| error.to_string()).and_then(|line| {
                serde_json::from_str::<Value>(&line)
                    .map_err(|error| format!("پاسخ نامعتبر از موتور: {error}"))
            });
            if let Ok(value) = &response {
                if let Some(event) = value["event"].as_str() {
                    if event == "diagnostic" && value["data"]["action"] == "web_generate" {
                        let ok = value["data"]["ok"] == true;
                        diagnostics::record(&app, "web_generate", if ok { "success" } else { "error" },
                            if ok { None } else { Some("failed") }, None);
                        continue;
                    }
                    if matches!(event, "download-progress" | "batch-progress" | "queue-progress" |
                        "chat-progress" | "chat-token" | "chat-agent-step" | "work-progress") {
                        if let Ok(mut current) = current_operation.lock() {
                            if let Some(operation) = current.as_mut() {
                                operation.progress(&app, event, &value["data"]);
                            }
                        }
                        if event != "work-progress" { let _ = app.emit(event, &value["data"]); }
                        continue;
                    }
                }
            }
            let invalid = response.is_err();
            if sender.send(response).is_err() || invalid { break; }
        }
    });
    Ok(Backend { child, stdin, responses, operation })
}

fn save_folder(app: &AppHandle, state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String, key: &str, restart: bool) -> Result<(), String> {
    let folder = PathBuf::from(path);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("یک پوشهٔ معتبر انتخاب کنید.".into());
    }
    let probe = folder.join(format!(".nocturne-write-test-{}", std::process::id()));
    std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)
        .map_err(|e| format!("پوشه قابل نوشتن نیست: {e}"))?;
    let _ = std::fs::remove_file(probe);
    let exe_dir = app_storage(app)?;
    let settings = exe_dir.join("settings.json");
    let mut saved = std::fs::read_to_string(&settings).ok()
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .filter(Value::is_object).unwrap_or_else(|| json!({}));
    saved[key] = json!(folder);
    std::fs::write(&settings, saved.to_string())
        .map_err(|e| format!("ذخیرهٔ تنظیمات ناموفق بود: {e}"))?;
    if restart {
        let mut guard = state.lock().map_err(|_| "موتور برنامه در دسترس نیست".to_string())?;
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
fn set_model_folder(app: AppHandle, state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String) -> Result<(), String> {
    let started = Instant::now();
    let result = save_folder(&app, state, path, "model_folder", true);
    diagnostics::outcome(&app, "set_model_folder", &result.clone().map(|_| Value::Null), started, false);
    result
}

#[tauri::command]
fn set_output_folder(app: AppHandle, state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String) -> Result<(), String> {
    let started = Instant::now();
    let result = save_folder(&app, state, path, "output_folder", false);
    diagnostics::outcome(&app, "set_output_folder", &result.clone().map(|_| Value::Null), started, false);
    result
}

fn send_backend_request(backend: &mut Backend, action: &str, payload: Value) -> Result<Value, String> {
    let request = json!({"action": action, "payload": payload});
    writeln!(backend.stdin, "{request}").map_err(|error| error.to_string())?;
    backend.stdin.flush().map_err(|error| error.to_string())?;
    backend.responses.recv().map_err(|_| "موتور Python بسته شد.".to_string())?
}

fn run_with_progress(
    backend: &mut Backend, task: &mut Option<diagnostics::Operation>, action: &str, payload: Value,
) -> Result<Value, String> {
    {
        let mut slot = backend.operation.lock().map_err(|error| error.to_string())?;
        *slot = task.take();
    }
    let result = send_backend_request(backend, action, payload);
    {
        let mut slot = backend.operation.lock().map_err(|error| error.to_string())?;
        *task = slot.take();
    }
    result
}

#[tauri::command]
async fn model_download(
    app: AppHandle,
    state: State<'_, ModelDownloadState>,
    job_id: String,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    if !matches!(action.as_str(), "download" | "tts_download" | "chat_pull") {
        return Err("Invalid model download command.".into());
    }
    let workers = Arc::clone(&state.0);
    let worker = Arc::new(DownloadState::new());
    {
        let mut jobs = workers.lock().map_err(|error| error.to_string())?;
        if jobs.len() >= 2 || jobs.contains_key(&job_id) {
            return Err("Another process is still running a download.".into());
        }
        jobs.insert(job_id.clone(), Arc::clone(&worker));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut operation = Some(diagnostics::Operation::begin(&app, &action));
        let result = (|| {
            let mut backend = start_backend(&app)?;
            worker.pid.store(backend.child.id(), Ordering::SeqCst);
            worker.active.store(true, Ordering::SeqCst);
            run_with_progress(&mut backend, &mut operation, &action, payload)
        })();
        worker.finish();
        if let Ok(mut jobs) = workers.lock() {
            jobs.remove(&job_id);
        }
        let cancelled = worker.cancelled.swap(false, Ordering::SeqCst) && result.is_err();
        if let Some(operation) = operation { operation.finish(&app, &result, cancelled); }
        if cancelled {
            return Err("Download paused; received files were kept.".into());
        }
        result
    }).await.map_err(|error| format!("Download worker stopped: {error}"))?
}

#[tauri::command]
async fn cancel_model_download(state: State<'_, ModelDownloadState>, job_id: String) -> Result<bool, String> {
    let worker = state.0.lock().map_err(|error| error.to_string())?.get(&job_id).cloned();
    let Some(worker) = worker else { return Ok(false); };
    tauri::async_runtime::spawn_blocking(move || stop_backend(&worker))
        .await
        .map_err(|error| format!("Could not pause the download: {error}"))?
}

#[tauri::command]
async fn backend_command(
    app: AppHandle,
    state: State<'_, Arc<Mutex<Option<Backend>>>>,
    download: State<'_, Arc<DownloadState>>,
    action: String,
    payload: Value,
) -> Result<Value, String> {
    let state = Arc::clone(&state);
    let download = Arc::clone(&download);
    tauri::async_runtime::spawn_blocking(move || {
    let mut operation = Some(diagnostics::Operation::begin(&app, &action));
    let mut cancelled = false;
    let outcome = (|| {
    let mut guard = state.lock().map_err(|_| "موتور برنامه در دسترس نیست".to_string())?;
    if guard.is_none() {
        *guard = Some(start_backend(&app)?);
    }
    let backend = guard.as_mut().ok_or("موتور برنامه در دسترس نیست")?;
    let is_download = matches!(action.as_str(), "download" | "batch_generate" | "batch_queue" | "media_workflow_job" | "test_image_runtime" | "tts_download" | "tts_generate" | "chat_pull" | "chat_generate");
    if is_download {
        download.cancelled.store(false, Ordering::SeqCst);
        download.pid.store(backend.child.id(), Ordering::SeqCst);
        download.active.store(true, Ordering::SeqCst);
    }
    let outcome = run_with_progress(backend, &mut operation, &action, payload);
    if is_download {
        download.finish();
    }
    if outcome.is_err() {
        *guard = None;
        if download.cancelled.swap(false, Ordering::SeqCst) {
            cancelled = true;
            return Err("عملیات متوقف شد. فایل‌های ساخته یا دریافت‌شده حفظ شده‌اند.".into());
        }
    }
    outcome
    })();
    if let Some(operation) = operation { operation.finish(&app, &outcome, cancelled); }
    outcome
    }).await.map_err(|e| format!("فرمان برنامه متوقف شد: {e}"))?
}

#[tauri::command]
fn notify_image_ready(app: tauri::AppHandle, message: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app.notification()
        .builder()
        .title("Nocturne Studio")
        .body(message)
        .show()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn cancel_download(download: State<'_, Arc<DownloadState>>) -> Result<bool, String> {
    stop_backend(&download)
}

fn stop_backend(download: &DownloadState) -> Result<bool, String> {
    if !download.active.load(Ordering::SeqCst) {
        return Ok(false);
    }
    let pid = download.pid.load(Ordering::SeqCst);
    if pid == 0 {
        return Ok(false);
    }
    download.cancelled.store(true, Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    let status = child_command("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .output()
        .map_err(|e| format!("لغو دانلود ناموفق بود: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    let status = child_command("kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .output()
        .map_err(|e| format!("لغو دانلود ناموفق بود: {e}"))?;
    if !status.status.success() {
        download.cancelled.store(false, Ordering::SeqCst);
        return Err("متوقف کردن دانلود ناموفق بود.".into());
    }
    Ok(true)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(Mutex::<Option<Backend>>::new(None)))
        .manage(Arc::new(DownloadState::new()))
        .manage(ModelDownloadState(Arc::new(Mutex::new(HashMap::new()))))
        .manage(PendingAppUpdate::default())
        .setup(|app| {
            diagnostics::record(app.handle(), "startup", "success", None, None);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![activity_read, activity_clear, activity_interface_error, check_app_update, install_app_update, backend_command, model_download, cancel_model_download, notify_image_ready, cancel_download, set_model_folder, set_output_folder, setup_status, setup_install, update_diffusers_engine, hardware_usage])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri app");
}

#[derive(Default)]
struct PendingAppUpdate(Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AvailableAppUpdate {
    version: String,
    portable: bool,
}

#[tauri::command]
async fn check_app_update(app: AppHandle, pending: State<'_, PendingAppUpdate>) -> Result<Option<AvailableAppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let started = Instant::now();
    let portable = std::env::current_exe().ok()
        .is_some_and(|exe| exe.with_file_name("nocturne.portable").is_file());
    let result = async {
        let updater = app.updater_builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
            .map_err(|error| error.to_string())?;
        let mut update = updater.check().await.map_err(|error| error.to_string())?;
        let available = update.as_ref().map(|update| AvailableAppUpdate { version: update.version.clone(), portable });
        if let Some(update) = update.as_mut() {
            // The check has a short deadline. Packages can take longer to transfer.
            update.timeout = Some(std::time::Duration::from_secs(600));
        }
        *pending.0.lock().map_err(|error| error.to_string())? = if portable { None } else { update };
        Ok(available)
    }.await;
    diagnostics::outcome(&app, "check_app_update", &result.as_ref().map(|_| Value::Null).map_err(String::clone), started, false);
    result
}

#[tauri::command]
async fn install_app_update(app: AppHandle, pending: State<'_, PendingAppUpdate>) -> Result<(), String> {
    let update = pending.0.lock().map_err(|error| error.to_string())?.take();
    let Some(update) = update else { return Ok(()); };
    let started = Instant::now();
    diagnostics::record(&app, "install_app_update", "started", None, None);
    let result = update.download_and_install(|_, _| {}, || {}).await.map_err(|error| error.to_string());
    diagnostics::outcome(&app, "install_app_update", &result.clone().map(|_| Value::Null), started, false);
    if result.is_ok() {
        #[cfg(target_os = "linux")]
        app.restart();
    }
    result
}
