//! End-to-end encryption for Matrix: the Olm and Megolm state machine (`matrix-sdk-crypto`) on top of Mobius's own
//! Matrix client (`matrix.rs`). The machine never touches the network: it says what to send, Mobius sends it and hands
//! back the answer.
//!
//! Its store is a SQLite file per account, encrypted at rest with a random key that lives in the system secret store
//! beside the sign-in. Without that key the file is unreadable.
use std::collections::BTreeMap;
use std::path::Path;

use matrix_sdk_crypto::backups::MegolmV1BackupKey;
use matrix_sdk_crypto::store::types::BackupDecryptionKey;
use matrix_sdk_crypto::types::requests::{AnyIncomingResponse, OutgoingRequest};
use matrix_sdk_crypto::{CrossSigningKeyExport, DecryptionSettings, EncryptionSyncChanges, OlmMachine, OlmMachineBuilder, TrustRequirement};
use matrix_sdk_sqlite::SqliteCryptoStore;
use ruma::api::client::sync::sync_events::DeviceLists;
use ruma::events::AnyToDeviceEvent;
use ruma::serde::Raw;
use ruma::{OneTimeKeyAlgorithm, OwnedRoomId, RoomId, TransactionId, UInt, UserId};
use serde_json::Value;

type Res<T> = Result<T, String>;

/// One account's encryption: its machine, and a small runtime to drive the machine's async calls from Mobius's
/// threads.
pub struct Crypto {
    rt: tokio::runtime::Runtime,
    /// Always there until the account's encryption is put away (`Drop`).
    machine: Option<OlmMachine>,
}

impl Drop for Crypto {
    /// The store's connections close on the runtime they were opened on.
    fn drop(&mut self) {
        let _inside = self.rt.enter();
        drop(self.machine.take());
    }
}

fn said(e: impl std::fmt::Display) -> String {
    format!("Encryption failed: {e}")
}

impl Crypto {
    /// Opens (or starts) the account's encryption in `dir`, its store unlocked with `key` (32 bytes).
    pub fn open(dir: &Path, user: &str, device: &str, key: &[u8]) -> Res<Crypto> {
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().map_err(said)?;
        let user = UserId::parse(user).map_err(|_| "That Matrix ID can't be read.".to_owned())?;
        let device: ruma::OwnedDeviceId = device.into();
        std::fs::create_dir_all(dir).map_err(said)?;
        let machine = rt.block_on(async {
            let store = SqliteCryptoStore::open_with_key(dir, Some(key)).await.map_err(said)?;
            OlmMachineBuilder::new(&user, &device).with_crypto_store(store).build().await.map_err(said)
        })?;
        Ok(Crypto { rt, machine: Some(machine) })
    }

    pub fn block<F: std::future::Future>(&self, f: F) -> F::Output {
        self.rt.block_on(f)
    }

    pub fn machine(&self) -> &OlmMachine {
        match &self.machine {
            Some(m) => m,
            None => unreachable!("the machine is only taken as the encryption is dropped"),
        }
    }

    /// Takes in what a `/sync` brought for encryption: messages sent to this device, whose devices changed, and how
    /// many one-time keys are left.
    pub fn receive(&self, sync: &Value) -> Res<()> {
        let to_device: Vec<Raw<AnyToDeviceEvent>> = sync.pointer("/to_device/events").and_then(|e| serde_json::from_value(e.clone()).ok()).unwrap_or_default();
        let lists: DeviceLists = sync.get("device_lists").and_then(|d| serde_json::from_value(d.clone()).ok()).unwrap_or_default();
        let counts: BTreeMap<OneTimeKeyAlgorithm, UInt> = sync.get("device_one_time_keys_count").and_then(|c| serde_json::from_value(c.clone()).ok()).unwrap_or_default();
        let fallback: Option<Vec<OneTimeKeyAlgorithm>> = sync.get("device_unused_fallback_key_types").and_then(|f| serde_json::from_value(f.clone()).ok());
        let changes = EncryptionSyncChanges {
            to_device_events: to_device,
            changed_devices: &lists,
            one_time_keys_counts: &counts,
            unused_fallback_keys: fallback.as_deref(),
            next_batch_token: sync.get("next_batch").and_then(Value::as_str).map(str::to_owned),
        };
        let settings = DecryptionSettings { sender_device_trust_requirement: TrustRequirement::Untrusted };
        self.block(self.machine().receive_sync_changes(changes, &settings)).map(|_| ()).map_err(said)
    }

    /// What the machine wants sent now.
    pub fn outgoing(&self) -> Res<Vec<OutgoingRequest>> {
        self.block(self.machine().outgoing_requests()).map_err(said)
    }

    pub fn sent<'a>(&self, id: &TransactionId, response: impl Into<AnyIncomingResponse<'a>>) -> Res<()> {
        self.block(self.machine().mark_request_as_sent(id, response)).map_err(said)
    }

    /// An encrypted room event, decrypted into the same event: its type and content replaced, everything else kept.
    /// `None` when this device doesn't have its key.
    pub fn decrypt(&self, room: &str, event: &Value) -> Option<Value> {
        let room = RoomId::parse(room).ok()?;
        let raw = serde_json::from_value(event.clone()).ok()?;
        let settings = DecryptionSettings { sender_device_trust_requirement: TrustRequirement::Untrusted };
        let decrypted = self.block(self.machine().decrypt_room_event(&raw, &room, &settings)).ok()?;
        let inner: Value = serde_json::from_str(decrypted.event.json().get()).ok()?;
        let mut out = event.clone();
        out["type"] = inner.get("type").cloned().unwrap_or(Value::Null);
        out["content"] = inner.get("content").cloned().unwrap_or(Value::Null);
        // A relation (a thread, a reply, an edit) is outside the encryption, on the encrypted event itself.
        if let Some(relation) = event.pointer("/content/m.relates_to")
            && out["content"].get("m.relates_to").is_none()
            && out["content"].is_object()
        {
            out["content"]["m.relates_to"] = relation.clone();
        }
        Some(out)
    }

    /// Whether this device is verified: cross-signed by the person's own identity.
    pub fn verified(&self) -> bool {
        let (user, device) = (self.machine().user_id().to_owned(), self.machine().device_id().to_owned());
        self.block(self.machine().get_device(&user, &device, None)).ok().flatten().is_some_and(|d| d.is_cross_signed_by_owner())
    }

    /// Takes in the person's cross-signing keys, as kept in their secret storage.
    pub fn import_cross_signing(&self, export: CrossSigningKeyExport) -> Res<()> {
        self.block(self.machine().import_cross_signing_keys(export)).map(|_| ()).map_err(|e| format!("Your cross-signing keys could not be used: {e}"))
    }

    /// Keeps the backup's key, after checking it opens the backup the server has.
    pub fn use_backup_key(&self, key_base64: &str, version: &str, public_key: &str) -> Res<BackupDecryptionKey> {
        let key = BackupDecryptionKey::from_base64(key_base64).map_err(|_| "The key backup's key can't be read.".to_owned())?;
        let theirs = MegolmV1BackupKey::from_base64(public_key).map_err(|_| "The server's key backup can't be read.".to_owned())?;
        if key.megolm_v1_public_key().to_base64() != theirs.to_base64() {
            return Err("The key backup on the server was made with another key.".into());
        }
        self.block(self.machine().backup_machine().save_decryption_key(Some(key.clone()), Some(version.to_owned()))).map_err(said)?;
        Ok(key)
    }

    /// Takes in room keys read from the backup; answers how many were new.
    pub fn import_backup(&self, key: &BackupDecryptionKey, rooms: &Value) -> Res<usize> {
        let mut keys: BTreeMap<OwnedRoomId, BTreeMap<String, matrix_sdk_crypto::olm::BackedUpRoomKey>> = BTreeMap::new();
        for (room, data) in rooms.as_object().into_iter().flatten() {
            let Ok(room) = RoomId::parse(room) else { continue };
            for (session, backed) in data.get("sessions").and_then(Value::as_object).into_iter().flatten() {
                let Some(Ok(encrypted)) = backed.get("session_data").map(|d| serde_json::from_value(d.clone())) else { continue };
                if let Ok(key) = key.decrypt_session_data(encrypted) {
                    keys.entry(room.clone()).or_default().insert(session.clone(), key);
                }
            }
        }
        #[allow(deprecated)]
        let imported = self.block(self.machine().backup_machine().import_backed_up_room_keys(keys, |_, _| {})).map_err(said)?;
        Ok(imported.imported_count)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matrix::{Matrix, Session};
    use matrix_sdk_crypto::secret_storage::SecretStorageKey;
    use matrix_sdk_crypto::{CollectStrategy, EncryptionSettings};
    use ruma::events::secret::request::SecretName;
    use serde_json::json;
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};

    /// What the pretend homeserver keeps: each device's keys and inbox, the account's cross-signing keys, account
    /// data, the key backup, and each room's messages. Tokens name devices: `access-<device>`.
    #[derive(Default)]
    struct Home {
        devices: HashMap<String, Value>,
        one_time: HashMap<String, Vec<(String, Value)>>,
        inbox: HashMap<String, Vec<Value>>,
        signing: HashMap<&'static str, Value>,
        account: HashMap<String, Value>,
        backup: Option<Value>,
        backed_up: serde_json::Map<String, Value>,
        rooms: HashMap<String, Vec<Value>>,
        batch: u64,
    }

    const ME: &str = "@ana:x";

    fn merge_signatures(target: &mut Value, from: &Value) {
        for (user, sigs) in from.get("signatures").and_then(Value::as_object).into_iter().flatten() {
            for (id, sig) in sigs.as_object().into_iter().flatten() {
                target["signatures"][user][id] = sig.clone();
            }
        }
    }

    fn answer(home: &mut Home, method: &str, path: &str, query: &HashMap<String, String>, device: &str, body: &Value) -> (u16, Value) {
        let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
        match (method, parts.as_slice()) {
            ("GET", ["_matrix", "client", "versions"]) => (200, json!({ "versions": ["v1.11"] })),
            ("GET", [.., "account", "whoami"]) => (200, json!({ "user_id": ME, "device_id": device })),
            ("POST", [.., "keys", "upload"]) => {
                if let Some(keys) = body.get("device_keys") {
                    home.devices.insert(device.to_owned(), keys.clone());
                }
                let list = home.one_time.entry(device.to_owned()).or_default();
                for (id, key) in body.get("one_time_keys").and_then(Value::as_object).into_iter().flatten() {
                    list.push((id.clone(), key.clone()));
                }
                (200, json!({ "one_time_key_counts": { "signed_curve25519": list.len() } }))
            }
            ("POST", [.., "keys", "query"]) => {
                let mut out = json!({ "device_keys": { ME: home.devices }, "failures": {} });
                for (name, field) in [("master", "master_keys"), ("self_signing", "self_signing_keys"), ("user_signing", "user_signing_keys")] {
                    if let Some(k) = home.signing.get(name) {
                        out[field] = json!({ ME: k });
                    }
                }
                (200, out)
            }
            ("POST", [.., "keys", "device_signing", "upload"]) => {
                for (name, field) in [("master", "master_key"), ("self_signing", "self_signing_key"), ("user_signing", "user_signing_key")] {
                    if let Some(k) = body.get(field) {
                        home.signing.insert(name, k.clone());
                    }
                }
                (200, json!({}))
            }
            ("POST", [.., "keys", "signatures", "upload"]) => {
                for (id, signed) in body.get(ME).and_then(Value::as_object).into_iter().flatten() {
                    if let Some(d) = home.devices.get_mut(id) {
                        merge_signatures(d, signed);
                    } else if let Some(m) = home.signing.get_mut("master") {
                        merge_signatures(m, signed);
                    }
                }
                (200, json!({ "failures": {} }))
            }
            ("POST", [.., "keys", "claim"]) => {
                let mut out = json!({});
                for (dev, _) in body.pointer(&format!("/one_time_keys/{}", ME.replace('/', "~1"))).and_then(Value::as_object).into_iter().flatten() {
                    if let Some((id, key)) = home.one_time.get_mut(dev).and_then(Vec::pop) {
                        out[ME][dev][id] = key;
                    }
                }
                (200, json!({ "one_time_keys": out, "failures": {} }))
            }
            ("PUT", [.., "sendToDevice", kind, _]) => {
                for (dev, content) in body.pointer(&format!("/messages/{ME}")).and_then(Value::as_object).into_iter().flatten() {
                    home.inbox.entry(dev.clone()).or_default().push(json!({ "type": kind, "sender": ME, "content": content }));
                }
                (200, json!({}))
            }
            ("GET", [.., "sync"]) => {
                home.batch += 1;
                let events = home.inbox.remove(device).unwrap_or_default();
                let left = home.one_time.get(device).map_or(0, Vec::len);
                let rooms: serde_json::Map<String, Value> = home.rooms.keys().map(|r| (r.clone(), json!({
                    "summary": { "m.joined_member_count": 1 },
                    "state": { "events": [{ "type": "m.room.name", "state_key": "", "content": { "name": r } }, { "type": "m.room.encryption", "state_key": "", "content": { "algorithm": "m.megolm.v1.aes-sha2" } }] },
                }))).collect();
                (200, json!({ "next_batch": format!("s{}", home.batch), "to_device": { "events": events }, "device_lists": { "changed": [ME] }, "device_one_time_keys_count": { "signed_curve25519": left }, "rooms": { "join": rooms } }))
            }
            ("GET", [.., "user", _, "account_data", kind]) => match home.account.get(*kind) {
                Some(v) => (200, v.clone()),
                None => (404, json!({ "errcode": "M_NOT_FOUND", "error": "Account data not found" })),
            },
            ("PUT", [.., "user", _, "account_data", kind]) => {
                home.account.insert((*kind).to_owned(), body.clone());
                (200, json!({}))
            }
            ("POST", [.., "room_keys", "version"]) => {
                home.backup = Some(json!({ "version": "1", "algorithm": body["algorithm"], "auth_data": body["auth_data"], "count": 0, "etag": "0" }));
                (200, json!({ "version": "1" }))
            }
            ("GET", [.., "room_keys", "version"]) => match &home.backup {
                Some(b) => (200, b.clone()),
                None => (404, json!({ "errcode": "M_NOT_FOUND", "error": "No backup" })),
            },
            ("PUT", [.., "room_keys", "keys"]) => {
                for (room, data) in body.get("rooms").and_then(Value::as_object).into_iter().flatten() {
                    let entry = home.backed_up.entry(room.clone()).or_insert_with(|| json!({ "sessions": {} }));
                    for (sid, k) in data.get("sessions").and_then(Value::as_object).into_iter().flatten() {
                        entry["sessions"][sid] = k.clone();
                    }
                }
                (200, json!({ "count": home.backed_up.len(), "etag": "1" }))
            }
            ("GET", [.., "room_keys", "keys"]) if query.get("version").map(String::as_str) == Some("1") => (200, json!({ "rooms": home.backed_up })),
            ("GET", [.., "rooms", room, "messages"]) => (200, json!({ "chunk": home.rooms.get(*room).cloned().unwrap_or_default().into_iter().rev().collect::<Vec<_>>(), "state": [] })),
            _ => (404, json!({ "errcode": "M_UNRECOGNIZED", "error": path })),
        }
    }

    fn homeserver() -> (String, Arc<Mutex<Home>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let home: Arc<Mutex<Home>> = Arc::default();
        let h = home.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut s) = stream else { break };
                let mut data = Vec::new();
                let mut buf = [0u8; 65536];
                loop {
                    let n = s.read(&mut buf).unwrap_or(0);
                    data.extend_from_slice(&buf[..n]);
                    if let Some(end) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&data[..end]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                        if data.len() >= end + 4 + len {
                            break;
                        }
                    }
                    if n == 0 {
                        break;
                    }
                }
                let end = data.windows(4).position(|w| w == b"\r\n\r\n").unwrap_or(data.len());
                let head = String::from_utf8_lossy(&data[..end]).to_string();
                let body: Value = serde_json::from_slice(data.get(end + 4..).unwrap_or_default()).unwrap_or(Value::Null);
                let mut words = head.split_whitespace();
                let method = words.next().unwrap_or("").to_owned();
                let target = words.next().unwrap_or("").to_owned();
                let parsed = url::Url::parse(&format!("http://x{target}")).unwrap();
                let path = percent_encoding::percent_decode_str(parsed.path()).decode_utf8_lossy().to_string();
                let query: HashMap<String, String> = parsed.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
                let device = head.lines().find_map(|l| l.split_once(':').filter(|(k, _)| k.eq_ignore_ascii_case("authorization")).map(|(_, v)| v.trim().trim_start_matches("Bearer access-").to_owned())).unwrap_or_default();
                let (status, out) = answer(&mut h.lock().unwrap(), &method, &path, &query, &device, &body);
                let out = out.to_string();
                let _ = write!(s, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{out}", out.len());
            }
        });
        (url, home)
    }

    fn device(url: &str, name: &str, dir: &Path) -> (Session, Crypto) {
        let session = Session { homeserver: url.to_owned(), user: ME.into(), device: name.into(), access: format!("access-{name}"), refresh: String::new(), expires: 0, oauth: None };
        let crypto = Crypto::open(&dir.join(name), ME, name, &[7u8; 32]).unwrap();
        (session, crypto)
    }

    /// The person's other Matrix app (say, Element on their phone): it has cross-signing and secret storage set up,
    /// a key backup, and writes in two encrypted rooms.
    fn set_up_other_app(matrix: &Matrix, url: &str, dir: &Path) -> (Session, Crypto, String) {
        let (s, c) = device(url, "PHONE", dir);
        matrix.send_outgoing(&s, &c).unwrap();
        let boot = c.block(c.machine().bootstrap_cross_signing(false)).unwrap();
        let r = &boot.upload_signing_keys_req;
        matrix.call("POST", &format!("{url}/_matrix/client/v3/keys/device_signing/upload"), Some(&s.access), Some(&json!({ "master_key": r.master_key, "self_signing_key": r.self_signing_key, "user_signing_key": r.user_signing_key }))).unwrap();
        matrix.ruma(&s, boot.upload_signatures_req).unwrap();
        // Secret storage, opened by a recovery key, holding the cross-signing keys and the backup's key.
        let storage = SecretStorageKey::new();
        let id = storage.key_id().to_owned();
        let put = |kind: &str, v: Value| matrix.call("PUT", &format!("{url}/_matrix/client/v3/user/{ME}/account_data/{kind}"), Some(&s.access), Some(&v)).unwrap();
        put(&format!("m.secret_storage.key.{id}"), serde_json::to_value(storage.event_content()).unwrap());
        put("m.secret_storage.default_key", json!({ "key": id }));
        let export = c.block(c.machine().export_cross_signing_keys()).unwrap().unwrap();
        for (name, seed) in [(SecretName::CrossSigningMasterKey, export.master_key.clone()), (SecretName::CrossSigningSelfSigningKey, export.self_signing_key.clone()), (SecretName::CrossSigningUserSigningKey, export.user_signing_key.clone())] {
            let data = storage.encrypt(seed.unwrap().into_bytes(), &name);
            put(name.as_str(), json!({ "encrypted": { id.clone(): data } }));
        }
        let backup = BackupDecryptionKey::new();
        let public = backup.megolm_v1_public_key();
        matrix.call("POST", &format!("{url}/_matrix/client/v3/room_keys/version"), Some(&s.access), Some(&json!({ "algorithm": "m.megolm_backup.v1.curve25519-aes-sha2", "auth_data": { "public_key": public.to_base64() } }))).unwrap();
        public.set_version("1".into());
        c.block(c.machine().backup_machine().enable_backup_v1(public)).unwrap();
        let data = storage.encrypt(backup.to_base64().into_bytes(), &SecretName::from("m.megolm_backup.v1"));
        put("m.megolm_backup.v1", json!({ "encrypted": { id.clone(): data } }));
        (s, c, storage.to_base58())
    }

    /// The other app writes `text` in `room`, sharing the room's key with every device of the person's it knows.
    fn write(matrix: &Matrix, home: &Mutex<Home>, s: &Session, c: &Crypto, room: &str, id: &str, text: &str) {
        let user = UserId::parse(ME).unwrap();
        let room_id = RoomId::parse(room).unwrap();
        // Its own sync says the person's devices changed, so it asks which devices there are now.
        matrix.channels("phone", s, Some(c)).unwrap();
        if let Some((txn, claim)) = c.block(c.machine().get_missing_sessions([user.as_ref()].into_iter())).unwrap() {
            let response = matrix.ruma(s, claim).unwrap();
            c.sent(&txn, &response).unwrap();
        }
        let settings = EncryptionSettings { sharing_strategy: CollectStrategy::AllDevices, ..EncryptionSettings::default() };
        for r in c.block(c.machine().share_room_key(&room_id, [user.as_ref()].into_iter(), settings)).unwrap() {
            let q = ruma::api::client::to_device::send_event_to_device::v3::Request::new_raw(r.event_type.clone(), r.txn_id.clone(), r.messages.clone());
            let response = matrix.ruma(s, q).unwrap();
            c.sent(&r.txn_id, &response).unwrap();
        }
        let content = ruma::events::room::message::RoomMessageEventContent::text_plain(text);
        let encrypted = c.block(c.machine().encrypt_room_event(&room_id, content)).unwrap();
        home.lock().unwrap().rooms.entry(room.to_owned()).or_default().push(json!({ "type": "m.room.encrypted", "event_id": id, "sender": ME, "origin_server_ts": 1000, "content": encrypted.content.json() }));
    }

    fn back_up(matrix: &Matrix, s: &Session, c: &Crypto) {
        while let Some((txn, request)) = c.block(c.machine().backup_machine().backup()).unwrap() {
            let q = ruma::api::client::backup::add_backup_keys::v3::Request::new(request.version.clone(), request.rooms.clone());
            let response = matrix.ruma(s, q).unwrap();
            c.sent(&txn, &response).unwrap();
        }
    }

    #[test]
    fn a_recovery_key_verifies_this_device_and_opens_old_and_new_encrypted_messages() {
        let (url, home) = homeserver();
        let dir = tempfile::tempdir().unwrap();
        let matrix = Matrix::new();
        let (phone_s, phone, recovery) = set_up_other_app(&matrix, &url, dir.path());
        // Written before Mobius signed in: its key is only in the backup.
        write(&matrix, &home, &phone_s, &phone, "!old:x", "$old", "Before you came");
        back_up(&matrix, &phone_s, &phone);
        // Mobius signs in as a new device and looks at the rooms: they are encrypted, and it can't read them yet.
        let (s, c) = device(&url, "MOBIUS", dir.path());
        let rooms = matrix.channels("acc", &s, Some(&c)).unwrap();
        assert!(rooms.iter().all(|r| r["encrypted"] == true));
        assert!(!c.verified());
        // Written after: its key comes to this device as a message sent to it.
        write(&matrix, &home, &phone_s, &phone, "!new:x", "$new", "Now you are here");
        matrix.channels("acc", &s, Some(&c)).unwrap();
        assert!(matrix.history("acc", &s, "!new:x", None, None, 50, Some(&c)).unwrap().is_empty());
        // The wrong recovery key opens nothing.
        assert_eq!(matrix.recover(&s, &c, "EsTc 1234 5678").unwrap_err(), "That recovery key isn't right.");
        assert!(!c.verified());
        // The right one verifies this device, and brings the backup's keys.
        assert_eq!(matrix.recover(&s, &c, &recovery).unwrap(), 1);
        assert!(c.verified());
        let rooms = matrix.channels("acc", &s, Some(&c)).unwrap();
        assert!(rooms.iter().all(|r| r.get("encrypted").is_none()));
        let text = |room: &str| matrix.history("acc", &s, room, None, None, 50, Some(&c)).unwrap().iter().map(|m| m["text"].as_str().unwrap().to_owned()).collect::<Vec<_>>();
        assert_eq!(text("!old:x"), ["Before you came"]);
        assert_eq!(text("!new:x"), ["Now you are here"]);
        // The store is encrypted: opened with another key, it refuses.
        drop(c);
        assert!(Crypto::open(&dir.path().join("MOBIUS"), ME, "MOBIUS", &[8u8; 32]).is_err());
        let _ = home;
    }
}
