use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::redirect::Policy;
use tokio::io::AsyncWriteExt;
use url::Url;

// Construction plan sets can be large, but a remote response must never be
// allowed to consume unbounded disk or memory in the desktop app.
const MAX_REMOTE_PDF_BYTES: u64 = 256 * 1024 * 1024;
static DOWNLOAD_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub async fn download_pdf_from_url(raw_url: &str) -> Result<String, String> {
    let path = download_with_limit(raw_url, MAX_REMOTE_PDF_BYTES, &std::env::temp_dir()).await?;
    Ok(path.to_string_lossy().into_owned())
}

fn parse_remote_url(raw_url: &str) -> Result<Url, String> {
    let url =
        Url::parse(raw_url.trim()).map_err(|_| "Enter a valid HTTP or HTTPS URL".to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Only HTTP and HTTPS URLs can be downloaded".to_string());
    }
    Ok(url)
}

fn safe_pdf_filename(url: &Url) -> String {
    let segment = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .unwrap_or("");
    let filename: String = segment
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(80)
        .collect();
    if filename.to_ascii_lowercase().ends_with(".pdf") {
        filename
    } else {
        "download.pdf".to_string()
    }
}

fn temp_path(dir: &Path, filename: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let sequence = DOWNLOAD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(
        "oculith_url_{}_{}_{}_{}",
        std::process::id(),
        timestamp,
        sequence,
        filename
    ))
}

async fn download_with_limit(raw_url: &str, max_bytes: u64, dir: &Path) -> Result<PathBuf, String> {
    let url = parse_remote_url(raw_url)?;
    let redirect = Policy::custom(|attempt| {
        let next = attempt.url();
        if !matches!(next.scheme(), "http" | "https") {
            attempt.error("Redirect uses an unsupported URL scheme")
        } else if next.scheme() == "http"
            && attempt.previous().iter().any(|url| url.scheme() == "https")
        {
            attempt.error("HTTPS download cannot redirect to HTTP")
        } else if attempt.previous().len() > 10 {
            attempt.error("Too many redirects")
        } else {
            attempt.follow()
        }
    });
    let client = reqwest::Client::builder()
        .redirect(redirect)
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Download setup failed: {e}"))?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes)
    {
        return Err(format!("PDF download exceeds the {max_bytes} byte limit"));
    }

    let path = temp_path(dir, &safe_pdf_filename(response.url()));
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .await
        .map_err(|e| format!("Failed to create temp file: {e}"))?;
    let result = async {
        let mut received = 0u64;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Failed to read response: {e}"))?
        {
            received = received
                .checked_add(chunk.len() as u64)
                .ok_or_else(|| "PDF download size overflowed".to_string())?;
            if received > max_bytes {
                return Err(format!("PDF download exceeds the {max_bytes} byte limit"));
            }
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("Failed to write temp file: {e}"))?;
        }
        if received == 0 {
            return Err("Downloaded file is empty".to_string());
        }
        file.flush()
            .await
            .map_err(|e| format!("Failed to write temp file: {e}"))
    }
    .await;
    drop(file);
    if let Err(error) = result {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(error);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn serve_once(response: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request).await;
            stream.write_all(response).await.unwrap();
        });
        format!("http://{address}/drawing.pdf")
    }

    fn test_dir() -> PathBuf {
        let path = temp_path(&std::env::temp_dir(), "test");
        std::fs::create_dir(&path).unwrap();
        path
    }

    #[tokio::test]
    async fn rejects_non_http_schemes_before_requesting() {
        for url in [
            "file:///etc/passwd",
            "data:application/pdf;base64,JVBERi0=",
            "ftp://example.com/a.pdf",
        ] {
            assert!(parse_remote_url(url).is_err(), "{url}");
        }
        assert!(parse_remote_url("https://example.com/a.pdf?token=abc").is_ok());
    }

    #[tokio::test]
    async fn downloads_http_pdf_with_query_and_preserves_bytes() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\n%PDF-123").await;
        let dir = test_dir();
        let path = download_with_limit(&format!("{url}?token=abc"), 16, &dir)
            .await
            .unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), b"%PDF-123");
        assert!(path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("drawing.pdf"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rejects_declared_oversize_without_creating_a_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n").await;
        let dir = test_dir();
        let error = download_with_limit(&url, 16, &dir).await.unwrap_err();
        assert!(error.contains("exceeds"), "{error}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rejects_chunked_oversize_and_removes_partial_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n8\r\n%PDF-123\r\n8\r\n456789ab\r\n0\r\n\r\n").await;
        let dir = test_dir();
        let error = download_with_limit(&url, 10, &dir).await.unwrap_err();
        assert!(error.contains("exceeds"), "{error}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rejects_empty_response_and_removes_temp_file() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n").await;
        let dir = test_dir();
        let error = download_with_limit(&url, 16, &dir).await.unwrap_err();
        assert!(error.contains("empty"), "{error}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rejects_http_error_without_creating_a_file() {
        let url = serve_once(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
        let dir = test_dir();
        let error = download_with_limit(&url, 16, &dir).await.unwrap_err();
        assert!(error.contains("404"), "{error}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn removes_partial_file_after_truncated_response() {
        let url = serve_once(b"HTTP/1.1 200 OK\r\nContent-Length: 16\r\n\r\n%PDF-123").await;
        let dir = test_dir();
        let error = download_with_limit(&url, 16, &dir).await.unwrap_err();
        assert!(error.contains("Failed to read response"), "{error}");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn rejects_redirect_to_non_http_scheme() {
        let url = serve_once(
            b"HTTP/1.1 302 Found\r\nLocation: file:///etc/passwd\r\nContent-Length: 0\r\n\r\n",
        )
        .await;
        let dir = test_dir();
        assert!(download_with_limit(&url, 16, &dir).await.is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
