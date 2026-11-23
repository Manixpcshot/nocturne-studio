use std::collections::HashMap;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
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
        if let Some(index) = device.strip_prefix("cuda:") {
            #[cfg(target_os = "windows")]
            let output = Command::new("nvidia-smi")
                .args(["--query-gpu=memory.used,memory.total,utilization.gpu", "--format=csv,noheader,nounits", "-i", index])
                .creation_flags(0x08000000).output();
            #[cfg(not(target_os = "windows"))]
            let output = Command::new("nvidia-smi")
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

fn python_executable() -> Option<PathBuf> {
    if let Ok(output) = Command::new("py").args(["-3.13", "-c", "import sys; print(sys.executable)"])
        .creation_flags(0x08000000).output() {
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

fn missing_python_packages(python: &std::path::Path) -> Result<Vec<String>, String> {
    let modules = PYTHON_PACKAGES.iter().map(|(module, _)| *module).collect::<Vec<_>>();
    let script = format!("import importlib.util as u, json\nmissing=[]\nfor name in {}:\n try:\n  found=u.find_spec(name) is not None\n except ModuleNotFoundError:\n  found=False\n if not found: missing.append(name)\nprint(json.dumps(missing))", json!(modules));
    let script = script.replace("\nprint(json.dumps(missing))", "\nif 'sdnq' not in missing:\n try:\n  from importlib.metadata import version\n  from packaging.version import Version\n  if Version(version('sdnq')) < Version('0.2.2'): missing.append('sdnq')\n except Exception:\n  missing.append('sdnq')\nprint(json.dumps(missing))");
    let output = Command::new(python).args(["-c", &script]).creation_flags(0x08000000)
        .output().map_err(|e| format!("بررسی بسته‌های پایتون ناموفق بود: {e}"))?;
    if !output.status.success() {
        return Err(format!("پایتون اجرا نشد: {}", String::from_utf8_lossy(&output.stderr)));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| format!("پاسخ پایتون نامعتبر بود: {e}"))
}

fn prerequisites_status() -> Result<Value, String> {
    let Some(python) = python_executable() else {
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
    for mirror in [None, Some("https://pypi.tuna.tsinghua.edu.cn/simple")] {
        let mut command = Command::new(python);
        command.args(["-m", "pip", "install", "--timeout", "30", "--retries", "1"]);
        if let Some(url) = mirror { command.args(["--index-url", url]); }
        command.arg(package).creation_flags(0x08000000);
        emit_setup(app, &format!("در حال نصب {package}{}...", if mirror.is_some() { " از مسیر جایگزین" } else { "" }));
        if let Ok(status) = command.status() {
            if status.success() { return Ok(()); }
        }
    }
    Err(format!("نصب {package} ناموفق بود. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید."))
}

#[tauri::command]
async fn setup_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(prerequisites_status)
        .await
        .map_err(|error| format!("بررسی پیش‌نیازها متوقف شد: {error}"))?
}

#[tauri::command]
async fn update_diffusers_engine(
    app: AppHandle,
    state: State<'_, Arc<Mutex<Option<Backend>>>>,
) -> Result<Value, String> {
    let state = Arc::clone(&state);
    tauri::async_runtime::spawn_blocking(move || {
        {
            let mut guard = state.lock().map_err(|_| "موتور برنامه در دسترس نیست".to_string())?;
            *guard = None;
        }
        let python = python_executable().ok_or("Python 3.13 پیدا نشد. راه‌اندازی اولیه را اجرا کنید.")?;
        emit_setup(&app, "در حال به‌روزرسانی موتور Diffusers...");
        let output = Command::new(&python)
            .args(["-m", "pip", "install", "--upgrade", "--timeout", "30", "--retries", "2", "diffusers"])
            .creation_flags(0x08000000)
            .output().map_err(|e| format!("اجرای به‌روزرسانی ناموفق بود: {e}"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr);
            return Err(format!("به‌روزرسانی Diffusers ناموفق بود: {}", error.chars().rev().take(900).collect::<String>().chars().rev().collect::<String>()));
        }
        let version = Command::new(&python)
            .args(["-c", "import diffusers; print(diffusers.__version__)"])
            .creation_flags(0x08000000)
            .output().map_err(|e| format!("بررسی موتور تازه ناموفق بود: {e}"))?;
        if !version.status.success() {
            return Err("Diffusers نصب شد، اما اجرای آن ناموفق بود. پیش‌نیازهای Python را بررسی کنید.".into());
        }
        let version = String::from_utf8_lossy(&version.stdout).trim().to_string();
        emit_setup(&app, "موتور Diffusers به‌روز شد.");
        Ok(json!({"version": version}))
    }).await.map_err(|e| format!("به‌روزرسانی متوقف شد: {e}"))?
}

#[tauri::command]
async fn setup_install(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut python = python_executable();
        if python.is_none() {
            emit_setup(&app, "در حال دریافت نصب‌کنندهٔ Python 3.13 از سایت رسمی...");
            let installer = std::env::temp_dir().join("nocturne-python-3.13.17-amd64.exe");
            let download = Command::new("curl.exe").args(["--fail", "--location", "--retry", "2", "--output"])
                .arg(&installer).arg(PYTHON_INSTALLER_URL).creation_flags(0x08000000)
                .status().map_err(|e| format!("دریافت Python ناموفق بود: {e}"))?;
            if !download.success() { return Err("دریافت Python از سایت رسمی ناموفق بود.".into()); }
            emit_setup(&app, "در حال نصب Python 3.13...");
            let installed = Command::new(&installer)
                .args(["/quiet", "InstallAllUsers=0", "PrependPath=0", "Include_launcher=1", "Include_pip=1", "Include_test=0"])
                .creation_flags(0x08000000).status()
                .map_err(|e| format!("اجرای نصب‌کنندهٔ Python ناموفق بود: {e}"))?;
            if !installed.success() { return Err("نصب Python کامل نشد.".into()); }
            python = python_executable();
        }
        let python = python.ok_or("Python 3.13 پس از نصب پیدا نشد.")?;
        let pip = Command::new(&python).args(["-m", "pip", "--version"])
            .creation_flags(0x08000000).status()
            .map_err(|e| format!("بررسی pip ناموفق بود: {e}"))?;
        if !pip.success() {
            emit_setup(&app, "در حال نصب ابزار بسته‌های Python...");
            let status = Command::new(&python).args(["-m", "ensurepip", "--upgrade"])
                .creation_flags(0x08000000).status()
                .map_err(|e| format!("نصب pip ناموفق بود: {e}"))?;
            if !status.success() { return Err("نصب pip ناموفق بود.".into()); }
        }
        let missing = missing_python_packages(&python)?;
        for (module, package) in PYTHON_PACKAGES {
            if missing.contains(&module.to_string()) { install_package(&app, &python, package)?; }
        }
        emit_setup(&app, "در حال بررسی نهایی پیش‌نیازها...");
        let result = prerequisites_status()?;
        if result["ready"] != true { return Err("برخی پیش‌نیازها هنوز نصب نشده‌اند. دوباره تلاش کنید.".into()); }
        Ok(result)
    }).await.map_err(|e| format!("راه‌اندازی متوقف شد: {e}"))?
}

struct Backend {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
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
        let _ = self.child.kill();
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
    let exe_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("مسیر برنامه پیدا نشد")?
        .to_path_buf();
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
        .unwrap_or_else(|_| std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default().join(".cache/huggingface"));
    let chosen_home = saved_settings.get("model_folder").and_then(Value::as_str).map(PathBuf::from)
        .unwrap_or_else(|| original_home.clone());
    let python = python_executable().ok_or("Python 3.13 پیدا نشد. راه‌اندازی اولیه را اجرا کنید.")?;
    let mut child = Command::new(python)
        .arg("-u")
        .arg(script)
        .env("NOCTURNE_IMAGES_DIR", gallery_dir)
        .env("NOCTURNE_APP_DIR", &exe_dir)
        .env("NOCTURNE_ORIGINAL_HF_HOME", original_home)
        .env("HF_HOME", chosen_home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| format!("اجرای Python ناموفق بود: {e}"))?;
    let stdin = child.stdin.take().ok_or("ورودی موتور پیدا نشد")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("خروجی موتور پیدا نشد")?);
    Ok(Backend { child, stdin, stdout })
}

#[tauri::command]
fn save_folder(state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String, key: &str, restart: bool) -> Result<(), String> {
    let folder = PathBuf::from(path);
    if !folder.is_absolute() || !folder.is_dir() {
        return Err("یک پوشهٔ معتبر انتخاب کنید.".into());
    }
    let probe = folder.join(format!(".nocturne-write-test-{}", std::process::id()));
    std::fs::OpenOptions::new().write(true).create_new(true).open(&probe)
        .map_err(|e| format!("پوشه قابل نوشتن نیست: {e}"))?;
    let _ = std::fs::remove_file(probe);
    let exe_dir = std::env::current_exe().map_err(|e| e.to_string())?
        .parent().ok_or("مسیر برنامه پیدا نشد")?.to_path_buf();
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
fn set_model_folder(state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String) -> Result<(), String> {
    save_folder(state, path, "model_folder", true)
}

#[tauri::command]
fn set_output_folder(state: State<'_, Arc<Mutex<Option<Backend>>>>, path: String) -> Result<(), String> {
    save_folder(state, path, "output_folder", false)
}

fn send_backend_request(backend: &mut Backend, app: &AppHandle, action: &str, payload: Value) -> Result<Value, String> {
    let request = json!({"action": action, "payload": payload});
    writeln!(backend.stdin, "{request}").map_err(|e| e.to_string())?;
    backend.stdin.flush().map_err(|e| e.to_string())?;
    loop {
    let mut line = String::new();
    let read = backend.stdout.read_line(&mut line).map_err(|e| e.to_string())?;
    if read == 0 {
        return Err("موتور Python بسته شد.".into());
    }
    let response: Value = serde_json::from_str(&line)
        .map_err(|e| format!("پاسخ نامعتبر از موتور: {e}"))?;
    if let Some(event) = response.get("event").and_then(Value::as_str) {
        if matches!(event, "download-progress" | "batch-progress" | "queue-progress" | "chat-progress" | "chat-token" | "chat-agent-step") {
            let _ = app.emit(event, &response["data"]);
            continue;
        }
    }
    return Ok(response);
    }
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
        let result = (|| {
            let mut backend = start_backend(&app)?;
            worker.pid.store(backend.child.id(), Ordering::SeqCst);
            worker.active.store(true, Ordering::SeqCst);
            send_backend_request(&mut backend, &app, &action, payload)
        })();
        worker.finish();
        if let Ok(mut jobs) = workers.lock() {
            jobs.remove(&job_id);
        }
        if worker.cancelled.swap(false, Ordering::SeqCst) && result.is_err() {
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
    let mut guard = state.lock().map_err(|_| "موتور برنامه در دسترس نیست".to_string())?;
    if guard.is_none() {
        *guard = Some(start_backend(&app)?);
    }
    let backend = guard.as_mut().ok_or("موتور برنامه در دسترس نیست")?;
    let is_download = matches!(action.as_str(), "download" | "batch_generate" | "batch_queue" | "tts_download" | "tts_generate" | "chat_pull" | "chat_generate");
    if is_download {
        download.cancelled.store(false, Ordering::SeqCst);
        download.pid.store(backend.child.id(), Ordering::SeqCst);
        download.active.store(true, Ordering::SeqCst);
    }
    let outcome = send_backend_request(backend, &app, &action, payload);
    if is_download {
        download.finish();
    }
    if outcome.is_err() {
        *guard = None;
        if download.cancelled.swap(false, Ordering::SeqCst) {
            return Err("عملیات متوقف شد. فایل‌های ساخته یا دریافت‌شده حفظ شده‌اند.".into());
        }
    }
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
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| format!("لغو دانلود ناموفق بود: {e}"))?;
    #[cfg(not(target_os = "windows"))]
    let status = Command::new("kill")
        .arg(pid.to_string())
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(Arc::new(Mutex::<Option<Backend>>::new(None)))
        .manage(Arc::new(DownloadState::new()))
        .manage(ModelDownloadState(Arc::new(Mutex::new(HashMap::new()))))
        .invoke_handler(tauri::generate_handler![backend_command, model_download, cancel_model_download, notify_image_ready, cancel_download, set_model_folder, set_output_folder, setup_status, setup_install, update_diffusers_engine, hardware_usage])
        .run(tauri::generate_context!())
        .expect("failed to run Tauri app");
}
