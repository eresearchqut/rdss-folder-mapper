use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

const SIDECAR: &str = "binaries/rdss-folder-mapper";
const HELP_URL: &str = "https://eresearchqut.github.io/rdss-folder-mapper";

// ─── Shared state ──────────────────────────────────────────────────────────────

#[derive(Default)]
struct AppState {
    child: Mutex<Option<CommandChild>>,
    cancelled: Mutex<bool>,
    creds_tx: Mutex<Option<oneshot::Sender<Option<Credentials>>>>,
    logs: Mutex<Vec<String>>,
}

// ─── Serde types mirroring the Electron preload contract ─────────────────────────

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Config {
    debug: bool,
    base_dir: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Credentials {
    #[serde(default)]
    username: String,
    #[serde(default)]
    password: String,
    #[serde(default)]
    ad_domain: Option<String>,
}

#[derive(Serialize, Clone)]
struct OpResult {
    success: bool,
    cancelled: bool,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            // Skip CSI sequences: ESC [ ... <final-byte>
            if chars.peek() == Some(&'[') {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if ('@'..='~').contains(&n) {
                        break;
                    }
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn emit_log(app: &AppHandle, line: &str) {
    let state = app.state::<AppState>();
    state.logs.lock().unwrap().push(line.to_string());
    let _ = app.emit("log", line);
}

fn current_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_default()
}

fn default_base_dir(app: &AppHandle) -> String {
    app.path()
        .home_dir()
        .map(|h| h.join("Desktop").join("RDSS Folders"))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("gui-config.json"))
}

fn load_config(app: &AppHandle) -> Config {
    let fallback = Config {
        debug: false,
        base_dir: default_base_dir(app),
    };
    let Some(path) = config_file(app) else {
        return fallback;
    };
    match fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str::<Config>(&raw).unwrap_or(fallback),
        Err(_) => fallback,
    }
}

/// IT-provisioned system config path, matching the previous Electron behaviour.
fn system_deployment_config() -> PathBuf {
    if cfg!(target_os = "windows") {
        let base = std::env::var("PROGRAMDATA").unwrap_or_else(|_| "C:\\ProgramData".into());
        PathBuf::from(base).join("RDSSFolderMapper").join("config.json")
    } else if cfg!(target_os = "macos") {
        PathBuf::from("/Library/Application Support/RDSSFolderMapper/config.json")
    } else {
        PathBuf::from("/etc/RDSSFolderMapper/config.json")
    }
}

/// Resolves the deployment config (apiUrl/clientId/remotePath/…) at runtime.
///
/// NOTE: the deployment config is intentionally NOT bundled with the app and
/// must never be committed to the repo — even though the values are largely
/// public (OAuth client id, public URLs), they are environment-specific and
/// are provisioned per deployment. Resolution order:
///   1. IT-provisioned system config (SCCM / Jamf / install script)
///   2. A developer override dropped in the app config dir (git-ignored)
fn read_deployment_config(app: &AppHandle) -> Option<String> {
    let system = system_deployment_config();
    if system.exists() {
        if let Ok(raw) = fs::read_to_string(&system) {
            return Some(raw);
        }
    }
    if let Ok(dir) = app.path().app_config_dir() {
        let dev = dir.join("config.json");
        if dev.exists() {
            if let Ok(raw) = fs::read_to_string(&dev) {
                return Some(raw);
            }
        }
    }
    None
}

/// Prepares the directory the CLI sidecar runs in, writing a deployment
/// `config.json` resolved at runtime (see `read_deployment_config`). When no
/// config is found the CLI runs with an empty config and emits its own clear
/// "OAuth config is not configured" error.
fn prepare_workdir(app: &AppHandle) -> Result<PathBuf, String> {
    let workdir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("work");
    fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;

    let raw = read_deployment_config(app).unwrap_or_else(|| "{}".to_string());

    // Strip any credential fields that must never come from a config file.
    let mut parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = parsed.as_object_mut() {
        obj.remove("username");
        obj.remove("password");
        obj.remove("domain");
    }
    fs::write(
        workdir.join("config.json"),
        serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    Ok(workdir)
}

/// Spawns the CLI sidecar, streams its output to the renderer as `log` events,
/// and resolves to the process success state. Optional `stdin_lines` are written
/// to the child's stdin (used to drive the interactive `auth` subcommand).
async fn run_sidecar(
    app: &AppHandle,
    args: Vec<String>,
    workdir: &Path,
    stdin_lines: Option<Vec<String>>,
) -> bool {
    let sidecar = match app.shell().sidecar(SIDECAR) {
        Ok(c) => c,
        Err(e) => {
            emit_log(app, &format!("✗ {e}"));
            return false;
        }
    };

    let (mut rx, mut child) = match sidecar.current_dir(workdir).args(args).spawn() {
        Ok(v) => v,
        Err(e) => {
            emit_log(app, &format!("✗ {e}"));
            return false;
        }
    };

    if let Some(lines) = stdin_lines {
        for line in lines {
            let _ = child.write(format!("{line}\n").as_bytes());
        }
    }

    *app.state::<AppState>().child.lock().unwrap() = Some(child);

    let mut success = false;
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                let line = strip_ansi(&String::from_utf8_lossy(&bytes));
                let line = line.trim_end();
                if !line.is_empty() {
                    emit_log(app, line);
                }
            }
            CommandEvent::Terminated(payload) => {
                success = payload.code == Some(0);
            }
            CommandEvent::Error(err) => emit_log(app, &format!("✗ {err}")),
            _ => {}
        }
    }

    *app.state::<AppState>().child.lock().unwrap() = None;
    success
}

// ─── Commands ────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn get_config(app: AppHandle) -> Config {
    load_config(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: Config) -> Result<(), String> {
    let path = config_file(&app).ok_or("Could not resolve config directory")?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn has_shortcuts(app: AppHandle) -> bool {
    let ignored = [".mounts", ".DS_Store", "desktop.ini", "Thumbs.db", ".mountignore"];
    let base = load_config(&app).base_dir;
    match fs::read_dir(&base) {
        Ok(entries) => entries.flatten().any(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            !ignored.contains(&name.as_ref())
        }),
        Err(_) => false,
    }
}

#[tauri::command]
async fn pick_folder(app: AppHandle) -> Option<String> {
    let base = load_config(&app).base_dir;
    let (tx, rx) = oneshot::channel();
    app.dialog()
        .file()
        .set_directory(&base)
        .set_title("Select base folder for mappings")
        .pick_folder(move |picked| {
            let _ = tx.send(picked);
        });
    rx.await
        .ok()
        .flatten()
        .and_then(|fp| fp.into_path().ok())
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn open_log_file(app: AppHandle) -> Result<(), String> {
    let log_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("activity.log");

    let logs = app.state::<AppState>().logs.lock().unwrap().clone();
    let content = if logs.is_empty() {
        "(No activity recorded yet)\n".to_string()
    } else {
        format!("{}\n", logs.join("\n"))
    };
    fs::write(&log_path, content).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(log_path.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_base_dir(app: AppHandle) -> Result<(), String> {
    let base = load_config(&app).base_dir;
    let expanded = if let Some(stripped) = base.strip_prefix('~') {
        app.path()
            .home_dir()
            .map(|h| format!("{}{}", h.to_string_lossy(), stripped))
            .unwrap_or(base)
    } else {
        base
    };
    app.opener()
        .open_path(expanded, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_help(app: AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(HELP_URL, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn submit_credentials(app: AppHandle, credentials: Credentials) {
    if let Some(tx) = app.state::<AppState>().creds_tx.lock().unwrap().take() {
        let _ = tx.send(Some(credentials));
    }
}

#[tauri::command]
fn cancel_operation(app: AppHandle) {
    let state = app.state::<AppState>();
    *state.cancelled.lock().unwrap() = true;
    let child = state.child.lock().unwrap().take();
    if let Some(child) = child {
        let _ = child.kill();
    }
    let tx = state.creds_tx.lock().unwrap().take();
    if let Some(tx) = tx {
        let _ = tx.send(None);
    }
}

#[tauri::command]
async fn map_folders(app: AppHandle) -> OpResult {
    *app.state::<AppState>().cancelled.lock().unwrap() = false;

    let cfg = load_config(&app);
    let workdir = match prepare_workdir(&app) {
        Ok(w) => w,
        Err(e) => {
            emit_log(&app, &format!("✗ {e}"));
            return OpResult { success: false, cancelled: false };
        }
    };

    // Prompt for SMB credentials only on first run (mirrors the keychain-empty
    // check in the CLI). Saved via the CLI `auth` subcommand which persists them
    // to the OS keychain / Credential Manager.
    let marker = workdir.join(".creds-saved");
    if !marker.exists() {
        let (tx, rx) = oneshot::channel();
        *app.state::<AppState>().creds_tx.lock().unwrap() = Some(tx);
        let _ = app.emit(
            "credentials-required",
            serde_json::json!({ "defaultUsername": current_username() }),
        );

        if let Some(creds) = rx.await.ok().flatten() {
            if !creds.username.is_empty() || !creds.password.is_empty() {
                let mut auth_args = Vec::new();
                if cfg.debug {
                    auth_args.push("--debug".to_string());
                }
                auth_args.push("auth".to_string());
                let stdin = vec![
                    creds.username.clone(),
                    creds.password.clone(),
                    creds.ad_domain.clone().unwrap_or_default(),
                ];
                run_sidecar(&app, auth_args, &workdir, Some(stdin)).await;
                let _ = fs::write(&marker, "1");
            }
        }

        if *app.state::<AppState>().cancelled.lock().unwrap() {
            return OpResult { success: false, cancelled: true };
        }
    }

    let mut args = vec![
        "--refresh".to_string(),
        "--base-dir".to_string(),
        cfg.base_dir.clone(),
    ];
    if cfg.debug {
        args.push("--debug".to_string());
    }

    let success = run_sidecar(&app, args, &workdir, None).await;
    let cancelled = *app.state::<AppState>().cancelled.lock().unwrap();
    OpResult {
        success: success && !cancelled,
        cancelled,
    }
}

#[tauri::command]
async fn remove_mappings(app: AppHandle) -> OpResult {
    *app.state::<AppState>().cancelled.lock().unwrap() = false;
    let cfg = load_config(&app);
    let workdir = match prepare_workdir(&app) {
        Ok(w) => w,
        Err(e) => {
            emit_log(&app, &format!("✗ {e}"));
            return OpResult { success: false, cancelled: false };
        }
    };

    let mut args = Vec::new();
    if cfg.debug {
        args.push("--debug".to_string());
    }
    args.push("--base-dir".to_string());
    args.push(cfg.base_dir.clone());
    args.push("reset".to_string());

    let success = run_sidecar(&app, args, &workdir, None).await;
    let cancelled = *app.state::<AppState>().cancelled.lock().unwrap();
    OpResult {
        success: success && !cancelled,
        cancelled,
    }
}

#[tauri::command]
async fn clear_auth(app: AppHandle) -> OpResult {
    let cfg = load_config(&app);
    let workdir = match prepare_workdir(&app) {
        Ok(w) => w,
        Err(e) => {
            emit_log(&app, &format!("✗ {e}"));
            return OpResult { success: false, cancelled: false };
        }
    };

    let mut args = Vec::new();
    if cfg.debug {
        args.push("--debug".to_string());
    }
    args.push("clear-auth".to_string());

    let success = run_sidecar(&app, args, &workdir, None).await;
    let _ = fs::remove_file(workdir.join(".creds-saved"));
    OpResult { success, cancelled: false }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_version,
            get_config,
            save_config,
            has_shortcuts,
            pick_folder,
            open_log_file,
            open_base_dir,
            open_help,
            submit_credentials,
            cancel_operation,
            map_folders,
            remove_mappings,
            clear_auth
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
