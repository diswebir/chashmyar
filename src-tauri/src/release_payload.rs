//! Headless verification of the *actual* production application's Tauri
//! context. This mode does not create an app, change the screen, start the
//! updater or require a running development server.
//!
//! The build script compares the hashes written here with its own `dist/`
//! inventory and runs this on both the standalone portable and the executable
//! extracted from the staged NSIS installer. It is not a WebView2 GUI test.

use serde::Serialize;
use std::{collections::BTreeMap, fs::OpenOptions, io::Write, path::Path};
use tauri::utils::assets::AssetKey;

// The caller uses this marker to reject older binaries *before* launching
// them with an option that those binaries would otherwise ignore.
const AUDIT_MARKER: &str = "CHASHMYAR_RELEASE_AUDIT_V1";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    marker: &'static str,
    ok: bool,
    error: Option<String>,
    version: &'static str,
    config_version: String,
    flavor: &'static str,
    production_protocol: bool,
    updater_public_key: &'static str,
    config_public_key: String,
    assets: BTreeMap<String, String>,
}

fn inspect() -> Report {
    let mut report = Report {
        marker: AUDIT_MARKER,
        ok: false,
        error: None,
        version: env!("CARGO_PKG_VERSION"),
        config_version: String::new(),
        flavor: if cfg!(feature = "portable") { "portable" } else { "installed" },
        production_protocol: !tauri::is_dev(),
        updater_public_key: crate::updater::PUBLIC_KEY.trim(),
        config_public_key: String::new(),
        assets: BTreeMap::new(),
    };
    let result = (|| -> Result<(), String> {
        if !report.production_protocol {
            return Err("Tauri custom-protocol is disabled (development mode)".into());
        }
        // This exact factory is also used by Builder::build in lib.rs.
        let context = crate::app_context();
        report.config_version = context.config().version.clone().unwrap_or_default();
        report.config_public_key = context.config().plugins.0.get("updater")
            .and_then(|p| p.get("pubkey"))
            .and_then(|v| v.as_str())
            .unwrap_or_default().trim().to_string();
        if report.version != report.config_version {
            return Err("Cargo and Tauri configuration versions differ".into());
        }
        if report.updater_public_key.is_empty() || report.updater_public_key != report.config_public_key {
            return Err("Embedded updater key and Tauri configuration key differ or are missing".into());
        }
        let assets = context.assets();
        for (path, _) in assets.iter() {
            let path = path.into_owned();
            let bytes = assets.get(&AssetKey::from(path.as_str()))
                .ok_or_else(|| format!("Cannot read or decompress embedded asset: {path}"))?;
            if bytes.is_empty() {
                return Err(format!("Embedded asset is empty: {path}"));
            }
            let digest = crate::release_hash::sha256_hex(bytes.as_ref());
            if report.assets.insert(path.clone(), digest).is_some() {
                return Err(format!("Duplicate embedded asset: {path}"));
            }
        }
        if !report.assets.contains_key("/index.html") {
            return Err("Embedded /index.html is missing".into());
        }
        Ok(())
    })();
    match result {
        Ok(()) => report.ok = true,
        Err(error) => report.error = Some(error),
    }
    report
}

/// Returns an exit status only when the private release-audit mode was
/// requested. A fresh output path is mandatory; never overwrite user files.
pub fn handle_command() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--verify-release-payload")) {
        return None;
    }
    let path = match (args.next(), args.next()) {
        (Some(path), None) => path,
        _ => return Some(2),
    };
    let report = inspect();
    let encoded = match serde_json::to_vec(&report) {
        Ok(bytes) => bytes,
        Err(_) => return Some(2),
    };
    let written = OpenOptions::new().write(true).create_new(true).open(Path::new(&path))
        .and_then(|mut file| file.write_all(&encoded));
    if written.is_err() {
        return Some(2);
    }
    Some(if report.ok { 0 } else { 1 })
}
