//! S3-style storage as a drive: Amazon S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi and the rest that speak the S3
//! API. The person pastes an access key; nothing is registered with anyone.
//!
//! A bucket has no folders, only keys: a folder here is every key that starts with its path and a `/`, and an empty one
//! is kept as a zero-byte key ending in `/`, as the services' own consoles make them. A move is a copy and a delete.
//! Requests are signed with AWS Signature Version 4.
//!
//! Versions are ETags, sent back with `If-Match` (and `If-None-Match: *` for a new file), which AWS, R2 and MinIO
//! honour. The version is also checked just before each change, so a service that ignores those headers still never
//! overwrites a file that changed since it was read, except in the moment between.
use std::path::Path;
use std::time::Duration;

use sha2::{Digest, Sha256};

use crate::calendar_accounts::{Node, xml};
use crate::drives::{CHANGED, Drive, EXISTS, Entry, File, MAX_FILE, MAX_SYNC_FILE};

type Res<T> = Result<T, String>;

/// Files over this go up as a multipart upload, in parts of this size (S3 takes parts of 5 MB to 5 GB).
const PART: u64 = 32 * 1024 * 1024;
const MAX_LISTING: u64 = 8 * 1024 * 1024;
/// The hash S3 is sent for a body it is not asked to check (a big file, streamed).
const UNSIGNED: &str = "UNSIGNED-PAYLOAD";

pub struct S3 {
    /// `https://host[:port]`, without a path.
    endpoint: url::Url,
    bucket: String,
    /// Keys under this, without a leading or trailing `/`; empty for the whole bucket.
    prefix: String,
    region: String,
    key_id: String,
    secret: String,
    /// The bucket in the host name (`bucket.s3.region.amazonaws.com`), as AWS prefers; elsewhere in the path.
    virtual_host: bool,
    http: ureq::Agent,
    part: u64,
}

/// What a request sends.
#[derive(Clone, Copy)]
enum Body<'a> {
    Bytes(&'a [u8]),
    File(&'a Path),
}

struct Reply {
    status: u16,
    etag: Option<String>,
    body: Vec<u8>,
}

/// The region an endpoint names, where it names one: `s3.eu-west-2.amazonaws.com`, R2's `auto`.
pub fn region_of(endpoint: &url::Url) -> Option<String> {
    let host = endpoint.host_str()?;
    if host.ends_with(".r2.cloudflarestorage.com") {
        return Some("auto".into());
    }
    let parts: Vec<&str> = host.split('.').collect();
    // s3.<region>.amazonaws.com, s3.<region>.backblazeb2.com, s3.<region>.wasabisys.com
    (parts.len() >= 4 && parts[0] == "s3").then(|| parts[1].to_owned()).filter(|r| r != "amazonaws")
}

/// Whether a bucket name is one S3 accepts: 3 to 63 lowercase letters, digits, dots and hyphens.
pub fn bucket_ok(name: &str) -> bool {
    (3..=63).contains(&name.len())
        && name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
        && name.starts_with(|c: char| c.is_ascii_alphanumeric())
        && name.ends_with(|c: char| c.is_ascii_alphanumeric())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut block = [0u8; 64];
    if key.len() > 64 {
        block[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        block[..key.len()].copy_from_slice(key);
    }
    let mut inner = Sha256::new();
    inner.update(block.map(|b| b ^ 0x36));
    inner.update(data);
    let mut outer = Sha256::new();
    outer.update(block.map(|b| b ^ 0x5c));
    outer.update(inner.finalize());
    outer.finalize().to_vec()
}

/// RFC 3986 encoding as Signature Version 4 wants it: everything but `A-Z a-z 0-9 - _ . ~` (and `/` in a path).
fn encode(text: &str, keep_slash: bool) -> String {
    let mut out = String::new();
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') || (keep_slash && b == b'/') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// The `Authorization` header for a request: Signature Version 4, for service `s3`.
#[allow(clippy::too_many_arguments)]
fn authorization(method: &str, path: &str, query: &[(String, String)], headers: &[(String, String)], payload: &str, amz_date: &str, region: &str, key_id: &str, secret: &str) -> String {
    let mut query: Vec<(String, String)> = query.iter().map(|(k, v)| (encode(k, false), encode(v, false))).collect();
    query.sort();
    let canonical_query = query.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join("&");
    let mut headers: Vec<(String, String)> = headers.iter().map(|(k, v)| (k.to_ascii_lowercase(), v.split_whitespace().collect::<Vec<_>>().join(" "))).collect();
    headers.sort();
    let canonical_headers: String = headers.iter().map(|(k, v)| format!("{k}:{v}\n")).collect();
    let signed = headers.iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>().join(";");
    let canonical = format!("{method}\n{}\n{canonical_query}\n{canonical_headers}\n{signed}\n{payload}", encode(path, true));
    let date = &amz_date[..8];
    let scope = format!("{date}/{region}/s3/aws4_request");
    let to_sign = format!("AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}", sha256_hex(canonical.as_bytes()));
    let mut key = hmac(format!("AWS4{secret}").as_bytes(), date.as_bytes());
    for part in [region, "s3", "aws4_request"] {
        key = hmac(&key, part.as_bytes());
    }
    format!("AWS4-HMAC-SHA256 Credential={key_id}/{scope}, SignedHeaders={signed}, Signature={}", hex(&hmac(&key, to_sign.as_bytes())))
}

/// A drive path split into its names, refusing ones that would step outside the drive.
fn names(path: &str) -> Res<Vec<&str>> {
    let path = path.trim().trim_matches('/');
    if path.is_empty() {
        return Ok(Vec::new());
    }
    path.split('/')
        .map(|n| if n.is_empty() || n == "." || n == ".." || n.contains('\\') || n.chars().any(char::is_control) { Err("That is not a name a file can have.".to_owned()) } else { Ok(n) })
        .collect()
}

impl S3 {
    /// `base` is the path-style address of the folder: `https://host/bucket/prefix/`.
    pub fn new(base: &url::Url, region: &str, key_id: &str, secret: &str, http: ureq::Agent) -> Res<S3> {
        let mut segments = base.path().trim_matches('/').split('/').filter(|s| !s.is_empty());
        let bucket = segments.next().ok_or("Give the bucket's name.")?.to_owned();
        if !bucket_ok(&bucket) {
            return Err("That is not a bucket name S3 accepts: 3 to 63 lowercase letters, digits, dots and hyphens.".into());
        }
        let prefix = segments.map(|s| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()).collect::<Vec<_>>().join("/");
        let mut endpoint = base.clone();
        endpoint.set_path("/");
        endpoint.set_query(None);
        endpoint.set_fragment(None);
        let virtual_host = endpoint.host_str().is_some_and(|h| h.ends_with(".amazonaws.com")) && !bucket.contains('.');
        let region = Some(region.trim()).filter(|r| !r.is_empty()).map(str::to_owned).or_else(|| region_of(&endpoint)).unwrap_or_else(|| "us-east-1".into());
        Ok(S3 { endpoint, bucket, prefix, region, key_id: key_id.trim().to_owned(), secret: secret.to_owned(), virtual_host, http, part: PART })
    }

    pub fn region(&self) -> &str {
        &self.region
    }

    /// The key for a drive path (`folder` adds the trailing `/` of a folder's key).
    fn key(&self, path: &str, folder: bool) -> Res<String> {
        let names = names(path)?;
        let mut parts: Vec<&str> = Vec::new();
        if !self.prefix.is_empty() {
            parts.push(&self.prefix);
        }
        parts.extend(names);
        let key = parts.join("/");
        Ok(if folder && !key.is_empty() { format!("{key}/") } else { key })
    }

    /// The drive path of a key, or `None` when it is outside the drive.
    fn path_of(&self, key: &str) -> Option<String> {
        let key = key.trim_end_matches('/');
        if self.prefix.is_empty() {
            return Some(key.to_owned());
        }
        if key == self.prefix {
            return Some(String::new());
        }
        key.strip_prefix(&format!("{}/", self.prefix)).map(str::to_owned)
    }

    /// One signed request to `key` (empty: the bucket).
    #[allow(clippy::too_many_arguments)]
    fn request(&self, method: &str, key: &str, query: &[(&str, String)], extra: &[(&str, String)], body: Body, limit: usize, to: Option<&Path>) -> Res<Reply> {
        let path = if self.virtual_host { format!("/{key}") } else if key.is_empty() { format!("/{}/", self.bucket) } else { format!("/{}/{key}", self.bucket) };
        let host = match (self.endpoint.host_str(), self.endpoint.port()) {
            (Some(h), Some(p)) if self.virtual_host => format!("{}.{h}:{p}", self.bucket),
            (Some(h), None) if self.virtual_host => format!("{}.{h}", self.bucket),
            (Some(h), Some(p)) => format!("{h}:{p}"),
            (Some(h), None) => h.to_owned(),
            (None, _) => return Err("That address has no server in it.".into()),
        };
        let (payload, size) = match body {
            Body::Bytes(b) => (sha256_hex(b), b.len() as u64),
            Body::File(p) => (UNSIGNED.to_owned(), std::fs::metadata(p).map_err(|e| e.to_string())?.len()),
        };
        let amz_date = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
        let mut headers: Vec<(String, String)> = vec![("host".into(), host.clone()), ("x-amz-date".into(), amz_date.clone()), ("x-amz-content-sha256".into(), payload.clone())];
        headers.extend(extra.iter().map(|(k, v)| ((*k).to_owned(), v.clone())));
        let query: Vec<(String, String)> = query.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect();
        let auth = authorization(method, &path, &query, &headers, &payload, &amz_date, &self.region, &self.key_id, &self.secret);
        let mut q: Vec<String> = query.iter().map(|(k, v)| if v.is_empty() && !k.contains('=') { encode(k, false) } else { format!("{}={}", encode(k, false), encode(v, false)) }).collect();
        q.sort();
        let url = format!("{}://{host}{}{}", self.endpoint.scheme(), encode(&path, true), if q.is_empty() { String::new() } else { format!("?{}", q.join("&")) });
        let mut builder = ureq::http::Request::builder().method(method).uri(&url).header("Authorization", auth);
        for (k, v) in headers.iter().filter(|(k, _)| k != "host") {
            builder = builder.header(k.as_str(), v.as_str());
        }
        let unreachable = |e: ureq::Error| format!("Could not reach {}: {e}", self.endpoint.host_str().unwrap_or("the server"));
        let time = Duration::from_secs(300 + size / (64 * 1024));
        let mut response = match body {
            Body::Bytes(b) => {
                let request = self.http.configure_request(builder.body(b.to_vec()).map_err(|e| e.to_string())?).timeout_global(Some(time)).build();
                self.http.run(request).map_err(unreachable)?
            }
            Body::File(p) => {
                let file = std::fs::File::open(p).map_err(|e| e.to_string())?;
                let request = self.http.configure_request(builder.body(file).map_err(|e| e.to_string())?).timeout_global(Some(time)).build();
                self.http.run(request).map_err(unreachable)?
            }
        };
        let status = response.status().as_u16();
        let etag = response.headers().get("etag").and_then(|v| v.to_str().ok()).map(str::to_owned);
        let body = match to {
            Some(path) if status == 200 => {
                let mut out = std::fs::File::create(path).map_err(|e| e.to_string())?;
                let mut reader = response.body_mut().with_config().limit(MAX_SYNC_FILE).reader();
                std::io::copy(&mut reader, &mut out).map_err(|e| e.to_string())?;
                out.sync_all().map_err(|e| e.to_string())?;
                Vec::new()
            }
            _ => response.body_mut().with_config().limit(u64::try_from(limit).unwrap_or(u64::MAX)).read_to_vec().map_err(|e| match e {
                ureq::Error::BodyExceedsLimit(_) => format!("That file is bigger than {} MB, the most Mobius opens from a drive for now.", MAX_FILE / (1024 * 1024)),
                e => e.to_string(),
            })?,
        };
        Ok(Reply { status, etag, body })
    }

    fn small(&self, method: &str, key: &str, query: &[(&str, String)], extra: &[(&str, String)]) -> Res<Reply> {
        self.request(method, key, query, extra, Body::Bytes(&[]), 64 * 1024, None)
    }

    /// Why a request did not work, in the person's words, from its status and S3's error code.
    fn failed(&self, reply: &Reply, version: Option<&str>) -> String {
        let code = String::from_utf8_lossy(&reply.body).split("<Code>").nth(1).and_then(|c| c.split('<').next()).unwrap_or("").to_owned();
        match (reply.status, code.as_str()) {
            (_, "InvalidAccessKeyId" | "SignatureDoesNotMatch" | "InvalidToken" | "ExpiredToken") | (401, _) => "The server did not accept the drive's access key and secret.".into(),
            (_, "NoSuchBucket") => format!("There is no bucket called {} there.", self.bucket),
            (_, "AuthorizationHeaderMalformed") => "The bucket is in another region. Give its region (such as eu-west-2).".into(),
            (301, _) | (_, "PermanentRedirect") => "The bucket is at another address. Give the address for its region.".into(),
            (403, _) => "The server does not let this access key do that.".into(),
            (404, _) => "That is not on the drive any more.".into(),
            (409 | 412, _) if version.is_some() => CHANGED.into(),
            (412, _) => EXISTS.into(),
            (413, _) | (_, "EntityTooLarge") => "The server refused a file that size.".into(),
            (507, _) | (_, "QuotaExceeded") => "The drive is full.".into(),
            (s, "") => format!("The server answered {s}."),
            (s, c) => format!("The server answered {s} ({c})."),
        }
    }

    /// The object at `key`: its version, or `None` when there is none.
    fn head(&self, key: &str) -> Res<Option<String>> {
        let reply = self.small("HEAD", key, &[], &[])?;
        match reply.status {
            200 => Ok(Some(reply.etag.unwrap_or_default())),
            404 => Ok(None),
            _ => Err(self.failed(&reply, None)),
        }
    }

    /// One page of keys under `prefix`: with `delimiter`, only one level (files, then folders as prefixes).
    fn list_page(&self, prefix: &str, delimiter: bool, token: Option<&str>, max: Option<u32>) -> Res<Node> {
        let mut query = vec![("list-type", "2".to_owned()), ("prefix", prefix.to_owned())];
        if delimiter {
            query.push(("delimiter", "/".to_owned()));
        }
        if let Some(t) = token {
            query.push(("continuation-token", t.to_owned()));
        }
        if let Some(m) = max {
            query.push(("max-keys", m.to_string()));
        }
        let reply = self.request("GET", "", &query, &[], Body::Bytes(&[]), usize::try_from(MAX_LISTING).unwrap_or(usize::MAX), None)?;
        if reply.status != 200 {
            return Err(self.failed(&reply, None));
        }
        xml(&String::from_utf8_lossy(&reply.body))
    }

    /// Every key under `prefix`, at any depth, with its version.
    fn all_keys(&self, prefix: &str) -> Res<Vec<(String, String)>> {
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let page = self.list_page(prefix, false, token.as_deref(), None)?;
            let mut contents = Vec::new();
            page.all("Contents", &mut contents);
            out.extend(contents.iter().filter_map(|c| Some((c.text_of("Key")?, c.text_of("ETag").unwrap_or_default()))));
            token = page.text_of("NextContinuationToken").filter(|_| page.text_of("IsTruncated").as_deref() == Some("true"));
            if token.is_none() {
                return Ok(out);
            }
        }
    }

    /// Checks the version just before a change: a new file needs nothing there, a change the version it was based on.
    fn still(&self, key: &str, version: Option<&str>) -> Res<()> {
        match (version, self.head(key)?) {
            (None, Some(_)) => Err(EXISTS.into()),
            (Some(_), None) => Err(CHANGED.into()),
            (Some(v), Some(now)) if now != v => Err(CHANGED.into()),
            _ => Ok(()),
        }
    }

    fn condition(version: Option<&str>) -> (&'static str, String) {
        version.map_or(("If-None-Match", "*".to_owned()), |v| ("If-Match", v.to_owned()))
    }

    /// A multipart upload: parts of `self.part`, then joined; abandoned on any failure, so no parts are left to pay for.
    fn write_in_parts(&self, key: &str, from: &Path, version: Option<&str>) -> Res<Option<String>> {
        use std::io::Read;
        let reply = self.small("POST", key, &[("uploads", String::new())], &[])?;
        if reply.status != 200 {
            return Err(self.failed(&reply, version));
        }
        let id = xml(&String::from_utf8_lossy(&reply.body))?.text_of("UploadId").ok_or("The server did not start the upload.")?;
        let sent = (|| -> Res<Option<String>> {
            let mut file = std::fs::File::open(from).map_err(|e| e.to_string())?;
            let mut piece = vec![0; usize::try_from(self.part).unwrap_or(usize::MAX)];
            let mut parts = Vec::new();
            for n in 1u32.. {
                let mut filled = 0;
                while filled < piece.len() {
                    match file.read(&mut piece[filled..]).map_err(|e| e.to_string())? {
                        0 => break,
                        k => filled += k,
                    }
                }
                if filled == 0 {
                    break;
                }
                let reply = self.request("PUT", key, &[("partNumber", n.to_string()), ("uploadId", id.clone())], &[], Body::Bytes(&piece[..filled]), 64 * 1024, None)?;
                if reply.status != 200 {
                    return Err(self.failed(&reply, None));
                }
                parts.push(format!("<Part><PartNumber>{n}</PartNumber><ETag>{}</ETag></Part>", reply.etag.unwrap_or_default().replace('&', "&amp;").replace('<', "&lt;")));
            }
            self.still(key, version)?;
            let done = format!("<CompleteMultipartUpload>{}</CompleteMultipartUpload>", parts.concat());
            let reply = self.request("POST", key, &[("uploadId", id.clone())], &[Self::condition(version)], Body::Bytes(done.as_bytes()), 64 * 1024, None)?;
            // S3 can answer 200 and still have failed: the error is in the body.
            if reply.status != 200 || String::from_utf8_lossy(&reply.body).contains("<Error>") {
                return Err(self.failed(&reply, version));
            }
            Ok(xml(&String::from_utf8_lossy(&reply.body)).ok().and_then(|d| d.text_of("ETag")).or(self.head(key)?))
        })();
        if sent.is_err() {
            let _ = self.small("DELETE", key, &[("uploadId", id)], &[]);
        }
        sent
    }

    fn copy(&self, from: &str, to: &str) -> Res<()> {
        let source = format!("/{}/{}", self.bucket, encode(from, true));
        let reply = self.small("PUT", to, &[], &[("x-amz-copy-source", source)])?;
        if reply.status != 200 || String::from_utf8_lossy(&reply.body).contains("<Error>") {
            return Err(self.failed(&reply, None));
        }
        Ok(())
    }

    fn delete_key(&self, key: &str) -> Res<()> {
        let reply = self.small("DELETE", key, &[], &[])?;
        match reply.status {
            200 | 204 => Ok(()),
            _ => Err(self.failed(&reply, None)),
        }
    }

    #[cfg(test)]
    pub(crate) fn with_part(mut self, part: u64) -> S3 {
        self.part = part;
        self
    }
}

impl Drive for S3 {
    fn check(&self) -> Res<()> {
        let prefix = self.key("", true)?;
        self.list_page(&prefix, true, None, Some(1)).map(|_| ())
    }

    fn list(&self, folder: &str) -> Res<Vec<Entry>> {
        let prefix = self.key(folder, true)?;
        let mut out = Vec::new();
        let mut token: Option<String> = None;
        loop {
            let page = self.list_page(&prefix, true, token.as_deref(), None)?;
            let (mut contents, mut folders) = (Vec::new(), Vec::new());
            page.all("Contents", &mut contents);
            page.all("CommonPrefixes", &mut folders);
            for c in contents {
                let Some(key) = c.text_of("Key") else { continue };
                // A folder's own marker is not a file in it.
                if key == prefix || key.ends_with('/') {
                    continue;
                }
                let Some(path) = self.path_of(&key) else { continue };
                out.push(Entry {
                    name: path.rsplit('/').next().unwrap_or("").to_owned(),
                    size: c.text_of("Size").and_then(|s| s.parse().ok()).unwrap_or(0),
                    modified: c.text_of("LastModified"),
                    version: c.text_of("ETag"),
                    content_type: None,
                    id: None,
                    link: None,
                    folder: false,
                    path,
                });
            }
            for f in folders {
                let Some(path) = f.text_of("Prefix").and_then(|p| self.path_of(&p)) else { continue };
                out.push(Entry { name: path.rsplit('/').next().unwrap_or("").to_owned(), size: 0, modified: None, version: None, content_type: None, id: None, link: None, folder: true, path });
            }
            token = page.text_of("NextContinuationToken").filter(|_| page.text_of("IsTruncated").as_deref() == Some("true"));
            if token.is_none() {
                break;
            }
        }
        out.sort_by(|a, b| b.folder.cmp(&a.folder).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
        Ok(out)
    }

    fn read(&self, path: &str) -> Res<File> {
        if names(path)?.is_empty() {
            return Err("That is a folder.".into());
        }
        let reply = self.request("GET", &self.key(path, false)?, &[], &[], Body::Bytes(&[]), MAX_FILE, None)?;
        match reply.status {
            200 => Ok(File { bytes: reply.body, version: reply.etag, content_type: None }),
            _ => Err(self.failed(&reply, None)),
        }
    }

    fn write(&self, path: &str, bytes: &[u8], version: Option<&str>) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("A file needs a name.".into());
        }
        let key = self.key(path, false)?;
        self.still(&key, version)?;
        let reply = self.request("PUT", &key, &[], &[Self::condition(version), ("Content-Type", "application/octet-stream".to_owned())], Body::Bytes(bytes), 64 * 1024, None)?;
        match reply.status {
            200 => Ok(reply.etag.or(self.head(&key)?)),
            _ => Err(self.failed(&reply, version)),
        }
    }

    fn make_folder(&self, path: &str) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("A folder needs a name.".into());
        }
        let key = self.key(path, true)?;
        let inside = self.list_page(&key, true, None, Some(1))?;
        if self.head(&key)?.is_some() || inside.first("Contents").is_some() || inside.first("CommonPrefixes").is_some() {
            return Err(EXISTS.into());
        }
        let reply = self.request("PUT", &key, &[], &[("If-None-Match", "*".to_owned())], Body::Bytes(&[]), 64 * 1024, None)?;
        match reply.status {
            200 => Ok(()),
            _ => Err(self.failed(&reply, None)),
        }
    }

    fn rename(&self, from: &str, to: &str) -> Res<()> {
        if names(from)?.is_empty() || names(to)?.is_empty() {
            return Err("The drive's top folder cannot be moved.".into());
        }
        let (file, target) = (self.key(from, false)?, self.key(to, false)?);
        if self.head(&target)?.is_some() || !self.all_keys(&format!("{target}/"))?.is_empty() {
            return Err(EXISTS.into());
        }
        if self.head(&file)?.is_some() {
            self.copy(&file, &target)?;
            return self.delete_key(&file);
        }
        // A folder: every key under it, copied, then the old ones removed.
        let under = self.all_keys(&format!("{file}/"))?;
        if under.is_empty() {
            return Err("That is not on the drive any more.".into());
        }
        for (key, _) in &under {
            self.copy(key, &format!("{target}{}", &key[file.len()..]))?;
        }
        for (key, _) in &under {
            self.delete_key(key)?;
        }
        Ok(())
    }

    fn delete(&self, path: &str, version: Option<&str>) -> Res<()> {
        if names(path)?.is_empty() {
            return Err("The drive's top folder cannot be deleted.".into());
        }
        let key = self.key(path, false)?;
        match self.head(&key)? {
            Some(now) => {
                if version.is_some_and(|v| v != now) {
                    return Err(CHANGED.into());
                }
                self.delete_key(&key)
            }
            None => {
                let under = self.all_keys(&format!("{key}/"))?;
                if under.is_empty() {
                    return Err(if version.is_some() { CHANGED.into() } else { "That is not on the drive any more.".into() });
                }
                under.iter().try_for_each(|(k, _)| self.delete_key(k))
            }
        }
    }

    fn read_into(&self, path: &str, to: &Path) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("That is a folder.".into());
        }
        let reply = self.request("GET", &self.key(path, false)?, &[], &[], Body::Bytes(&[]), 64 * 1024, Some(to))?;
        match reply.status {
            200 => Ok(reply.etag),
            _ => Err(self.failed(&reply, None)),
        }
    }

    fn write_from(&self, path: &str, from: &Path, version: Option<&str>) -> Res<Option<String>> {
        if names(path)?.is_empty() {
            return Err("A file needs a name.".into());
        }
        let size = std::fs::metadata(from).map_err(|e| e.to_string())?.len();
        if size > MAX_SYNC_FILE {
            return Err(format!("Files bigger than {} GB are not sent to a drive.", MAX_SYNC_FILE / (1024 * 1024 * 1024)));
        }
        let key = self.key(path, false)?;
        if size > self.part {
            return self.write_in_parts(&key, from, version);
        }
        self.still(&key, version)?;
        let reply = self.request("PUT", &key, &[], &[Self::condition(version), ("Content-Type", "application/octet-stream".to_owned())], Body::File(from), 64 * 1024, None)?;
        match reply.status {
            200 => Ok(reply.etag.or(self.head(&key)?)),
            _ => Err(self.failed(&reply, version)),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::sync::{Arc, Mutex};

    #[test]
    fn signatures_match_the_aws_example() {
        // "GET Object" from the Signature Version 4 examples in the Amazon S3 API reference.
        let headers = [
            ("host".to_owned(), "examplebucket.s3.amazonaws.com".to_owned()),
            ("range".to_owned(), "bytes=0-9".to_owned()),
            ("x-amz-content-sha256".to_owned(), sha256_hex(b"")),
            ("x-amz-date".to_owned(), "20130524T000000Z".to_owned()),
        ];
        let auth = authorization("GET", "/test.txt", &[], &headers, &sha256_hex(b""), "20130524T000000Z", "us-east-1", "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
        assert_eq!(auth, "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    }

    #[test]
    fn regions_and_bucket_names() {
        let at = |u: &str| region_of(&url::Url::parse(u).unwrap());
        assert_eq!(at("https://s3.eu-west-2.amazonaws.com"), Some("eu-west-2".into()));
        assert_eq!(at("https://abc123.r2.cloudflarestorage.com"), Some("auto".into()));
        assert_eq!(at("https://s3.us-west-004.backblazeb2.com"), Some("us-west-004".into()));
        assert_eq!(at("http://minio.local:9000"), None);
        assert!(bucket_ok("my-photos.2026"));
        for bad in ["ab", "My-Photos", "-start", "end-", "has space", "a/b"] {
            assert!(!bucket_ok(bad), "{bad}");
        }
    }

    /// What the fake service holds: key → (bytes, etag number).
    pub(crate) type Objects = Arc<Mutex<BTreeMap<String, (Vec<u8>, u32)>>>;

    /// A small S3 service for bucket `photos`, for key `AKID` and secret `s3cret`. It checks each signature with the
    /// same code that makes them (the AWS example above checks that code), and speaks enough of S3 for drives:
    /// ListObjectsV2 with prefix, delimiter and pages of `page` keys, GET, HEAD, PUT with If-Match / If-None-Match,
    /// copy, DELETE, and multipart uploads.
    pub(crate) fn service(page: usize) -> (String, Objects) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let objects: Objects = Arc::default();
        let store = objects.clone();
        std::thread::spawn(move || {
            let mut next = 1u32;
            let mut uploads: BTreeMap<String, BTreeMap<u32, Vec<u8>>> = BTreeMap::new();
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() {
                    continue;
                }
                let mut parts = line.split_whitespace();
                let (method, target) = (parts.next().unwrap_or("").to_owned(), parts.next().unwrap_or("").to_owned());
                let mut headers = BTreeMap::new();
                loop {
                    let mut h = String::new();
                    reader.read_line(&mut h).unwrap();
                    if h.trim().is_empty() {
                        break;
                    }
                    let (k, v) = h.split_once(':').unwrap();
                    headers.insert(k.to_ascii_lowercase(), v.trim().to_owned());
                }
                let length = headers.get("content-length").and_then(|l| l.parse().ok()).unwrap_or(0);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                let header = |k: &str| headers.get(k).cloned().unwrap_or_default();
                let (raw_path, raw_query) = target.split_once('?').unwrap_or((&target, ""));
                let decode = |s: &str| percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned();
                let path = decode(raw_path);
                let query: Vec<(String, String)> = raw_query.split('&').filter(|p| !p.is_empty()).map(|p| p.split_once('=').map_or((decode(p), String::new()), |(k, v)| (decode(k), decode(v)))).collect();
                let q = |k: &str| query.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());
                // The signature, made again from what arrived.
                let signed: Vec<(String, String)> = header("authorization").split("SignedHeaders=").nth(1).and_then(|s| s.split(',').next()).unwrap_or("").split(';').map(|h| (h.to_owned(), header(h))).collect();
                let expect = authorization(&method, &path, &query, &signed, &header("x-amz-content-sha256"), &header("x-amz-date"), "us-east-1", "AKID", "s3cret");
                let payload_ok = header("x-amz-content-sha256") == UNSIGNED || header("x-amz-content-sha256") == sha256_hex(&body);
                let mut st = store.lock().unwrap();
                let tag = |v: u32| format!("\"e{v}\"");
                let error = |status: &'static str, code: &str| (status, String::new(), format!("<Error><Code>{code}</Code></Error>").into_bytes());
                let key = path.strip_prefix("/photos/").map(str::to_owned);
                let (status, extra, reply): (&str, String, Vec<u8>) = if header("authorization") != expect || !payload_ok {
                    error("403 Forbidden", if header("authorization").contains("Credential=AKID/") { "SignatureDoesNotMatch" } else { "InvalidAccessKeyId" })
                } else if !path.starts_with("/photos/") {
                    error("404 Not Found", "NoSuchBucket")
                } else {
                    let key = key.unwrap_or_default();
                    let current = st.get(&key).map(|(_, v)| tag(*v));
                    let (if_match, if_none) = (header("if-match"), header("if-none-match"));
                    let refused = (!if_match.is_empty() && current.as_deref() != Some(if_match.as_str())) || (if_none == "*" && current.is_some());
                    match (method.as_str(), key.is_empty()) {
                        ("GET", true) => {
                            let prefix = q("prefix").unwrap_or_default();
                            let delimiter = q("delimiter").is_some();
                            let after = q("continuation-token").unwrap_or_default();
                            let max = q("max-keys").and_then(|m| m.parse().ok()).unwrap_or(page);
                            let mut items: Vec<(String, bool)> = Vec::new();
                            for k in st.keys().filter(|k| k.starts_with(&prefix)) {
                                let rest = &k[prefix.len()..];
                                match rest.find('/') {
                                    Some(i) if delimiter => {
                                        let folder = format!("{prefix}{}", &rest[..=i]);
                                        if !items.iter().any(|(f, d)| *d && *f == folder) {
                                            items.push((folder, true));
                                        }
                                    }
                                    _ => items.push((k.clone(), false)),
                                }
                            }
                            let start = items.iter().position(|(k, _)| *k > after).unwrap_or(items.len());
                            let shown = &items[start..(start + max).min(items.len())];
                            let truncated = start + max < items.len();
                            let mut out = String::from("<ListBucketResult>");
                            for (k, folder) in shown {
                                if *folder {
                                    out.push_str(&format!("<CommonPrefixes><Prefix>{k}</Prefix></CommonPrefixes>"));
                                } else {
                                    let (b, v) = &st[k];
                                    out.push_str(&format!("<Contents><Key>{k}</Key><LastModified>2026-11-15T10:00:00.000Z</LastModified><ETag>{}</ETag><Size>{}</Size></Contents>", tag(*v).replace('"', "&quot;"), b.len()));
                                }
                            }
                            out.push_str(&format!("<IsTruncated>{truncated}</IsTruncated>"));
                            if truncated {
                                out.push_str(&format!("<NextContinuationToken>{}</NextContinuationToken>", shown.last().unwrap().0));
                            }
                            out.push_str("</ListBucketResult>");
                            ("200 OK", String::new(), out.into_bytes())
                        }
                        ("GET" | "HEAD", false) => match st.get(&key) {
                            Some((b, v)) => ("200 OK", format!("ETag: {}\r\n", tag(*v)), if method == "GET" { b.clone() } else { Vec::new() }),
                            None => error("404 Not Found", "NoSuchKey"),
                        },
                        ("POST", false) if q("uploads").is_some() => {
                            let id = format!("up{next}");
                            next += 1;
                            uploads.insert(id.clone(), BTreeMap::new());
                            ("200 OK", String::new(), format!("<InitiateMultipartUploadResult><UploadId>{id}</UploadId></InitiateMultipartUploadResult>").into_bytes())
                        }
                        ("PUT", false) if q("uploadId").is_some() => match uploads.get_mut(&q("uploadId").unwrap()) {
                            Some(parts) => {
                                let n: u32 = q("partNumber").and_then(|n| n.parse().ok()).unwrap_or(0);
                                parts.insert(n, body);
                                ("200 OK", format!("ETag: \"p{n}\"\r\n"), Vec::new())
                            }
                            None => error("404 Not Found", "NoSuchUpload"),
                        },
                        ("POST", false) if q("uploadId").is_some() => {
                            if refused {
                                error("412 Precondition Failed", "PreconditionFailed")
                            } else {
                                match uploads.remove(&q("uploadId").unwrap()) {
                                    Some(parts) => {
                                        let joined: Vec<u8> = parts.into_values().flatten().collect();
                                        let v = next;
                                        next += 1;
                                        st.insert(key.clone(), (joined, v));
                                        ("200 OK", String::new(), format!("<CompleteMultipartUploadResult><ETag>{}</ETag></CompleteMultipartUploadResult>", tag(v).replace('"', "&quot;")).into_bytes())
                                    }
                                    None => error("404 Not Found", "NoSuchUpload"),
                                }
                            }
                        }
                        ("DELETE", false) if q("uploadId").is_some() => {
                            uploads.remove(&q("uploadId").unwrap());
                            ("204 No Content", String::new(), Vec::new())
                        }
                        ("PUT", false) if !header("x-amz-copy-source").is_empty() => {
                            let from = decode(&header("x-amz-copy-source")).strip_prefix("/photos/").map(str::to_owned).unwrap_or_default();
                            match st.get(&from).cloned() {
                                Some((b, _)) => {
                                    let v = next;
                                    next += 1;
                                    st.insert(key.clone(), (b, v));
                                    ("200 OK", String::new(), b"<CopyObjectResult/>".to_vec())
                                }
                                None => error("404 Not Found", "NoSuchKey"),
                            }
                        }
                        ("PUT", false) => {
                            if refused {
                                error("412 Precondition Failed", "PreconditionFailed")
                            } else {
                                let v = next;
                                next += 1;
                                st.insert(key.clone(), (body, v));
                                ("200 OK", format!("ETag: {}\r\n", tag(v)), Vec::new())
                            }
                        }
                        ("DELETE", false) => {
                            st.remove(&key);
                            ("204 No Content", String::new(), Vec::new())
                        }
                        _ => error("405 Method Not Allowed", "MethodNotAllowed"),
                    }
                };
                drop(st);
                let _ = write!(stream, "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", reply.len());
                if method != "HEAD" {
                    let _ = stream.write_all(&reply);
                }
            }
        });
        (base, objects)
    }

    pub(crate) fn drive(base: &str, folder: &str) -> S3 {
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).allow_non_standard_methods(true).build().into();
        S3::new(&url::Url::parse(&format!("{base}/photos/{folder}")).unwrap(), "", "AKID", "s3cret", agent).unwrap()
    }

    #[test]
    fn a_bucket_folder_is_a_drive_whose_changes_keep_to_the_version_read() {
        // Pages of two keys, so every listing has to follow its continuation.
        let (base, objects) = service(2);
        let wrong = S3::new(&url::Url::parse(&format!("{base}/photos/")).unwrap(), "", "AKID", "nope", ureq::Agent::config_builder().http_status_as_error(false).build().into()).unwrap();
        assert!(wrong.check().unwrap_err().starts_with("The server did not accept"), "a sign-in problem, as sync knows it");
        let d = drive(&base, "Mobius");
        assert_eq!(d.region(), "us-east-1");
        d.check().unwrap();

        d.make_folder("Trips").unwrap();
        assert_eq!(d.make_folder("Trips").unwrap_err(), EXISTS);
        let v1 = d.write("Trips/plan.md", b"# Lisbon", None).unwrap().unwrap();
        assert_eq!(d.write("Trips/plan.md", b"again", None).unwrap_err(), EXISTS, "a new file never replaces one");
        for n in ["a", "b", "c"] {
            d.write(&format!("Trips/{n}.txt"), n.as_bytes(), None).unwrap();
        }
        d.write("top.txt", b"top", None).unwrap();
        assert!(objects.lock().unwrap().contains_key("Mobius/Trips/plan.md"), "kept under the drive's folder in the bucket");

        let top = d.list("").unwrap();
        assert_eq!(top.iter().map(|e| (e.name.as_str(), e.folder)).collect::<Vec<_>>(), vec![("Trips", true), ("top.txt", false)]);
        let trips = d.list("Trips").unwrap();
        assert_eq!(trips.iter().map(|e| e.path.as_str()).collect::<Vec<_>>(), vec!["Trips/a.txt", "Trips/b.txt", "Trips/c.txt", "Trips/plan.md"], "the folder's own marker is not a file in it");
        let plan = trips.iter().find(|e| e.name == "plan.md").unwrap();
        assert_eq!((plan.size, plan.version.as_deref()), (8, Some(v1.as_str())));
        let file = d.read("Trips/plan.md").unwrap();
        assert_eq!((file.bytes.as_slice(), file.version.as_deref()), (b"# Lisbon".as_slice(), Some(v1.as_str())));

        // Changed by someone else: a change based on the old version is refused.
        let v2 = d.write("Trips/plan.md", b"# Lisbon v2", Some(&v1)).unwrap().unwrap();
        assert_eq!(d.write("Trips/plan.md", b"mine", Some(&v1)).unwrap_err(), CHANGED);
        assert_eq!(d.delete("Trips/plan.md", Some(&v1)).unwrap_err(), CHANGED);

        // A move is a copy and a delete, of a file or a whole folder, and never over something there.
        assert_eq!(d.rename("Trips/a.txt", "top.txt").unwrap_err(), EXISTS);
        d.rename("Trips/a.txt", "Trips/z.txt").unwrap();
        d.rename("Trips", "Portugal").unwrap();
        let keys: Vec<String> = objects.lock().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["Mobius/Portugal/", "Mobius/Portugal/b.txt", "Mobius/Portugal/c.txt", "Mobius/Portugal/plan.md", "Mobius/Portugal/z.txt", "Mobius/top.txt"]);
        let moved = d.read("Portugal/plan.md").unwrap();
        d.delete("Portugal/plan.md", moved.version.as_deref()).unwrap();
        d.delete("Portugal", None).unwrap();
        assert_eq!(objects.lock().unwrap().keys().cloned().collect::<Vec<_>>(), ["Mobius/top.txt"]);
        assert_ne!(v1, v2);
    }

    #[test]
    fn a_bucket_is_added_as_a_drive_and_a_workspace_folder_syncs_with_it() {
        use crate::drive_sync::{Base, RoundOptions, round};
        use crate::drives::Drives;
        use crate::secrets::MemorySecrets;
        let (base, objects) = service(1000);
        let dir = tempfile::tempdir().unwrap();
        let drives = Drives::new(dir.path(), Arc::new(MemorySecrets::new(true)));
        assert!(drives.add_s3("Photos", &base, "photos", "Mobius", "", "AKID", "wrong").unwrap_err().starts_with("The server did not accept"));
        assert!(drives.add_s3("Photos", &base, "Bad_Name", "", "", "AKID", "s3cret").unwrap_err().contains("bucket name"));
        let added = drives.add_s3("Photos", &base, "photos", "Mobius", "", "AKID", "s3cret").unwrap();
        assert_eq!((added["kind"].as_str(), added["url"].as_str(), added["region"].as_str()), (Some("s3"), Some(format!("{base}/photos/Mobius/").as_str()), Some("us-east-1")));
        let id = added["id"].as_str().unwrap().to_owned();
        assert!(drives.sign_in(&id, "wrong").unwrap_err().starts_with("The server did not accept"));
        let drive = drives.open(&id).unwrap();

        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("trips")).unwrap();
        std::fs::write(root.path().join("trips/plan.md"), "# Lisbon").unwrap();
        let mut sync_base = Base::default();
        let options = RoundOptions { stamp: "2026-11-15 14.32", ..RoundOptions::default() };
        let r = round(drive.as_ref(), root.path(), "Notes", &mut sync_base, &options, &mut |_| {}).unwrap();
        assert_eq!(r.uploaded, ["trips/plan.md"]);
        assert_eq!(objects.lock().unwrap()["Mobius/Notes/trips/plan.md"].0, b"# Lisbon");
        objects.lock().unwrap().insert("Mobius/Notes/trips/plan.md".into(), (b"# Lisbon and Porto".to_vec(), 900));
        let r = round(drive.as_ref(), root.path(), "Notes", &mut sync_base, &options, &mut |_| {}).unwrap();
        assert_eq!(r.downloaded, ["trips/plan.md"]);
        assert_eq!(std::fs::read_to_string(root.path().join("trips/plan.md")).unwrap(), "# Lisbon and Porto");
    }

    #[test]
    fn big_files_go_up_in_parts_and_come_back_a_piece_at_a_time() {
        let (base, objects) = service(1000);
        let d = drive(&base, "").with_part(50);
        let dir = tempfile::tempdir().unwrap();
        let big: Vec<u8> = (0..230u32).map(|i| u8::try_from(i % 251).unwrap()).collect();
        let from = dir.path().join("big.bin");
        std::fs::write(&from, &big).unwrap();
        let v1 = d.write_from("big.bin", &from, None).unwrap().unwrap();
        assert_eq!(objects.lock().unwrap()["big.bin"].0, big);
        assert_eq!(d.write_from("big.bin", &from, None).unwrap_err(), EXISTS);
        let v2 = d.write_from("big.bin", &from, Some(&v1)).unwrap().unwrap();
        assert_eq!(d.write_from("big.bin", &from, Some(&v1)).unwrap_err(), CHANGED);
        let back = dir.path().join("back.bin");
        assert_eq!(d.read_into("big.bin", &back).unwrap().as_deref(), Some(v2.as_str()));
        assert_eq!(std::fs::read(&back).unwrap(), big);
        std::fs::write(&from, b"small").unwrap();
        d.write_from("small.bin", &from, None).unwrap();
        assert_eq!(objects.lock().unwrap()["small.bin"].0, b"small");
    }
}
