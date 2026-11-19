//! Emoji verification for Matrix: this device and another of the person's devices (Element on their phone, say) show
//! the same seven emoji, the person says they match on both, and each device trusts the other. Then the other device
//! sends this one the person's cross-signing keys and key backup key, and the backup's room keys are read.
use std::sync::PoisonError;

use matrix_sdk_crypto::types::requests::OutgoingVerificationRequest;
use matrix_sdk_crypto::{Sas, Verification};
use ruma::events::key::verification::VerificationMethod;
use ruma::events::key::verification::cancel::CancelCode;
use ruma::events::secret::request::SecretName;
use serde_json::{Value, json};

use crate::matrix::{Matrix, Session};
use crate::matrix_crypto::Crypto;

type Res<T> = Result<T, String>;

fn flow(c: &Crypto) -> Option<(String, u8)> {
    c.verifying.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

fn set_flow(c: &Crypto, to: Option<(String, u8)>) {
    *c.verifying.lock().unwrap_or_else(PoisonError::into_inner) = to;
}

fn store_failed(e: impl std::fmt::Display) -> String {
    format!("Verification failed: {e}")
}

impl Matrix {
    pub(crate) fn send_verification(&self, s: &Session, c: &Crypto, request: OutgoingVerificationRequest) -> Res<()> {
        use ruma::api::client::{message, to_device};
        match request {
            OutgoingVerificationRequest::ToDevice(r) => {
                let q = to_device::send_event_to_device::v3::Request::new_raw(r.event_type.clone(), r.txn_id.clone(), r.messages.clone());
                c.sent(&r.txn_id, &self.ruma(s, q)?)
            }
            OutgoingVerificationRequest::InRoom(r) => {
                let q = message::send_message_event::v3::Request::new(r.room_id.clone(), r.txn_id.clone(), &*r.content).map_err(|e| e.to_string())?;
                c.sent(&r.txn_id, &self.ruma(s, q)?)
            }
        }
    }

    fn sas(c: &Crypto, flow: &str) -> Option<Box<Sas>> {
        match c.machine().get_verification(c.machine().user_id(), flow) {
            Some(Verification::SasV1(sas)) => Some(sas),
            _ => None,
        }
    }

    /// Asks the person's other devices to verify this one. They show a prompt; the person accepts on one of them.
    pub fn verify_start(&self, s: &Session, c: &Crypto) -> Res<()> {
        self.verify_cancel(s, c);
        self.send_outgoing(s, c)?;
        let me = c.machine().user_id().to_owned();
        let identity = c.block(c.machine().get_identity(&me, None)).map_err(store_failed)?.and_then(|i| i.own());
        let identity = identity.ok_or("This account has no cross-signing set up. Set it up in another Matrix app (such as Element) first, or use your recovery key.")?;
        let (request, outgoing) = c.block(identity.request_verification_with_methods(vec![VerificationMethod::SasV1])).map_err(store_failed)?;
        self.send_verification(s, c, outgoing)?;
        set_flow(c, Some((request.flow_id().as_str().to_owned(), 0)));
        Ok(())
    }

    /// Moves the verification on with what the other device sent, and says where it is:
    /// `waiting` (for the other device to accept), `starting`, `compare` (with `emoji`), `confirmed` (this side said
    /// they match; waiting for the other), `finishing` (verified each other; the secrets are on their way), `done`
    /// (with `verified` and `keys`, how many room keys came from the backup), or `cancelled` (with `reason`).
    pub fn verify_check(&self, account: &str, s: &Session, c: &Crypto) -> Res<Value> {
        let Some((id, rounds)) = flow(c) else { return Ok(json!({ "state": "idle" })) };
        // The sync takes in what the other device sent, and sends this one's answers.
        self.channels(account, s, Some(c))?;
        self.send_outgoing(s, c)?;
        // Past the emoji: the verification itself may already be forgotten by the machine.
        if rounds > 0 {
            return self.verify_finish(s, c, &id, rounds);
        }
        let me = c.machine().user_id().to_owned();
        let Some(request) = c.machine().get_verification_request(&me, &id) else {
            set_flow(c, None);
            return Ok(json!({ "state": "cancelled", "reason": "The verification ended." }));
        };
        if let Some(info) = request.cancel_info() {
            set_flow(c, None);
            let reason = if info.cancelled_by_us() { "Verification was cancelled." } else { "The other device cancelled the verification." };
            return Ok(json!({ "state": "cancelled", "reason": reason }));
        }
        if let Some(sas) = Self::sas(c, &id) {
            if sas.is_done() {
                return self.verify_finish(s, c, &id, rounds);
            }
            if sas.have_we_confirmed() {
                return Ok(json!({ "state": "confirmed" }));
            }
            if let Some(emoji) = sas.emoji() {
                let emoji: Vec<Value> = emoji.iter().map(|e| json!({ "symbol": e.symbol, "name": e.description })).collect();
                return Ok(json!({ "state": "compare", "emoji": emoji }));
            }
            return Ok(json!({ "state": "starting" }));
        }
        if request.is_ready() {
            if let Some((_, outgoing)) = c.block(request.start_sas()).map_err(store_failed)? {
                self.send_verification(s, c, outgoing)?;
            }
            return Ok(json!({ "state": "starting" }));
        }
        Ok(json!({ "state": "waiting" }))
    }

    /// The person says whether the emoji match on both devices. If not, the verification is cancelled: someone may
    /// be in between.
    pub fn verify_confirm(&self, s: &Session, c: &Crypto, matches: bool) -> Res<()> {
        let (id, _) = flow(c).ok_or("No verification is under way.")?;
        let sas = Self::sas(c, &id).ok_or("The emoji aren't ready yet.")?;
        if !matches {
            if let Some(outgoing) = sas.cancel_with_code(CancelCode::MismatchedSas) {
                self.send_verification(s, c, outgoing)?;
            }
            set_flow(c, None);
            return Ok(());
        }
        let (outgoing, signatures) = c.block(sas.confirm()).map_err(store_failed)?;
        for o in outgoing {
            self.send_verification(s, c, o)?;
        }
        if let Some(signatures) = signatures {
            self.ruma(s, signatures)?;
        }
        Ok(())
    }

    /// Stops a verification under way, telling the other device.
    pub fn verify_cancel(&self, s: &Session, c: &Crypto) {
        let Some((id, _)) = flow(c) else { return };
        set_flow(c, None);
        let me = c.machine().user_id().to_owned();
        let outgoing = match Self::sas(c, &id) {
            Some(sas) => sas.cancel(),
            None => c.machine().get_verification_request(&me, &id).and_then(|r| r.cancel()),
        };
        if let Some(o) = outgoing {
            let _ = self.send_verification(s, c, o);
        }
    }

    /// After both devices said the emoji match: asks the other device for the person's secrets once, then signs
    /// this device with the cross-signing keys as they arrive, and reads the key backup with its key.
    fn verify_finish(&self, s: &Session, c: &Crypto, id: &str, rounds: u8) -> Res<Value> {
        if rounds == 0 {
            c.block(c.machine().query_missing_secrets_from_other_sessions()).map_err(store_failed)?;
            self.send_outgoing(s, c)?;
            set_flow(c, Some((id.to_owned(), 1)));
            return Ok(json!({ "state": "finishing" }));
        }
        let status = c.block(c.machine().cross_signing_status());
        if !c.verified() && status.has_self_signing {
            let device = c.block(c.machine().get_device(c.machine().user_id(), c.machine().device_id(), None)).map_err(store_failed)?;
            if let Some(device) = device {
                self.ruma(s, c.block(device.verify()).map_err(|e| format!("This device could not be signed: {e}"))?)?;
            }
        }
        // Read this device's keys back, with the signatures the other device or this one made.
        let (txn, query) = c.machine().query_keys_for_users([c.machine().user_id()]);
        let mut q = ruma::api::client::keys::get_keys::v3::Request::new();
        q.device_keys = query.device_keys;
        c.sent(&txn, &self.ruma(s, q)?)?;
        let backup_keys: Vec<String> = c.block(c.machine().store().get_secrets_from_inbox(&SecretName::RecoveryKey)).map_err(store_failed)?.iter().map(|k| k.as_str().to_owned()).collect();
        let mut keys = 0;
        for key in &backup_keys {
            if let Ok(n) = self.restore_backup(s, c, key) {
                keys = n;
                break;
            }
        }
        if !backup_keys.is_empty() {
            c.block(c.machine().store().delete_secrets_from_inbox(&SecretName::RecoveryKey)).map_err(store_failed)?;
        }
        let verified = c.verified();
        let has_backup = c.block(c.machine().backup_machine().backup_version()).is_some();
        // An account without a key backup sends no backup key: after a few checks, verified is done.
        if verified && (has_backup || !backup_keys.is_empty() || rounds >= 5) {
            set_flow(c, None);
            return Ok(json!({ "state": "done", "verified": true, "keys": keys }));
        }
        set_flow(c, Some((id.to_owned(), rounds.saturating_add(1))));
        Ok(json!({ "state": "finishing" }))
    }
}
