//! Chrome launches the installed executable with its extension origin argument.
use crate::browser_bridge::{MAX_RESPONSE, read_frame, write_frame};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::net::UnixStream;

pub fn identity() -> Value {
    serde_json::from_str(include_str!("../../../extension/identity.json"))
        .expect("Extension identity")
}
pub fn data_directory() -> Result<PathBuf> {
    Ok(std::env::var_os("DIFFCITY_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or(
            dirs::data_dir()
                .context("No application data directory")?
                .join("city.diff.desktop"),
        ))
}
fn validate_origin(origin: &str) -> Result<()> {
    ensure!(
        origin == format!("chrome-extension://{}/", identity()["id"].as_str().unwrap()),
        "Unknown browser extension"
    );
    Ok(())
}

pub fn install() -> Result<Vec<String>> {
    use std::os::unix::fs::PermissionsExt;
    let identity = identity();
    let manifest = json!({"name":identity["host"],"description":"Diff City local review companion","path":std::env::current_exe()?,"type":"stdio","allowed_origins":[format!("chrome-extension://{}/",identity["id"].as_str().unwrap())]});
    let home = dirs::home_dir().context("No home directory")?;
    #[cfg(target_os = "macos")]
    let roots = [
        home.join("Library/Application Support/Google/Chrome/NativeMessagingHosts"),
        home.join("Library/Application Support/Chromium/NativeMessagingHosts"),
        home.join("Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts"),
    ];
    #[cfg(not(target_os = "macos"))]
    let roots = [
        home.join(".config/google-chrome/NativeMessagingHosts"),
        home.join(".config/chromium/NativeMessagingHosts"),
        home.join(".config/google-chrome-for-testing/NativeMessagingHosts"),
    ];
    roots
        .into_iter()
        .map(|root| {
            std::fs::create_dir_all(&root)?;
            let path = root.join("city.diff.companion.json");
            // Atomic replacement; never truncate through a preexisting symlink.
            let temp = root.join(format!(".diffcity-{}.json", uuid::Uuid::new_v4()));
            std::fs::write(&temp, serde_json::to_vec_pretty(&manifest)?)?;
            std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
            std::fs::rename(temp, &path)?;
            Ok(path.to_string_lossy().into_owned())
        })
        .collect()
}

async fn connect(directory: &Path) -> Result<UnixStream> {
    let socket = directory.join("browser.sock");
    if let Ok(stream) = UnixStream::connect(&socket).await {
        return Ok(stream);
    }
    let exe = std::env::current_exe()?;
    #[cfg(target_os = "macos")]
    {
        let bundle = exe
            .parent()
            .and_then(Path::parent)
            .and_then(Path::parent)
            .context("App bundle missing")?;
        ensure!(
            bundle.extension().is_some_and(|ext| ext == "app"),
            "Open Diff City before connecting the development extension"
        );
        tokio::process::Command::new("/usr/bin/open")
            .args(["-g", "-a"])
            .arg(bundle)
            .args(["--args", "--browser-companion"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?
            .wait()
            .await?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        tokio::process::Command::new(exe)
            .arg("--browser-companion")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
    }
    for _ in 0..100 {
        if let Ok(stream) = UnixStream::connect(&socket).await {
            return Ok(stream);
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    anyhow::bail!("Open Diff City and retry the browser connection")
}

/// Native host-to-Chrome messages must stay below 1 MiB, even for large PRs.
pub fn chunks(bytes: &[u8]) -> Result<Vec<Value>> {
    let text = std::str::from_utf8(bytes)?;
    let message = uuid::Uuid::new_v4().to_string();
    let mut result = vec![];
    let mut start = 0;
    while start < text.len() {
        let mut end = (start + 128 * 1024).min(text.len());
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        result.push(json!({"message":message,"chunk":&text[start..end],"last":end==text.len()}));
        start = end;
    }
    Ok(result)
}
pub async fn run(origin: &str) -> Result<()> {
    validate_origin(origin)?;
    let stream = connect(&data_directory()?).await?;
    let (mut reader, mut writer) = stream.into_split();
    let input = async {
        let mut stdin = tokio::io::stdin();
        while let Some(bytes) = read_frame(&mut stdin, 8 * 1024 * 1024).await? {
            write_frame(&mut writer, &bytes).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    let output = async {
        let mut stdout = tokio::io::stdout();
        while let Some(bytes) = read_frame(&mut reader, MAX_RESPONSE).await? {
            for chunk in chunks(&bytes)? {
                write_frame(&mut stdout, &serde_json::to_vec(&chunk)?).await?;
            }
        }
        Ok::<_, anyhow::Error>(())
    };
    tokio::select! { result=input=>result, result=output=>result }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_must_match_exactly() {
        assert!(
            validate_origin(&format!(
                "chrome-extension://{}/",
                identity()["id"].as_str().unwrap()
            ))
            .is_ok()
        );
        for origin in [
            "https://github.com/",
            "chrome-extension://other/",
            "null",
            "",
        ] {
            assert!(validate_origin(origin).is_err());
        }
    }
    #[test]
    fn large_unicode_payloads_roundtrip_within_chrome_frame_limit() {
        let text = "🦀\"\\\n".repeat(300_000);
        let parts = chunks(text.as_bytes()).unwrap();
        assert!(parts.len() > 1);
        assert!(
            parts
                .iter()
                .all(|part| serde_json::to_vec(part).unwrap().len() < 1024 * 1024)
        );
        assert_eq!(
            parts
                .iter()
                .map(|p| p["chunk"].as_str().unwrap())
                .collect::<String>(),
            text
        );
        assert_eq!(parts.last().unwrap()["last"], true);
    }
}
