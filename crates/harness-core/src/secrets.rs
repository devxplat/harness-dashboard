//! At-rest encryption for opt-in integration tokens (AES-256-GCM).
//!
//! The key lives in a file beside the database (`~/.claude/harness-dashboard.secret.key`,
//! 0600 on unix), so a stolen DB alone does not expose tokens. Pure and offline —
//! no network — so it belongs in core, shared by the GitHub and Google integrations.

use crate::error::{CoreError, Result};
use crate::paths;
use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use std::path::{Path, PathBuf};

fn key_path() -> PathBuf {
    paths::claude_dir().join("harness-dashboard.secret.key")
}

fn rng(buf: &mut [u8]) -> Result<()> {
    getrandom::getrandom(buf).map_err(|e| CoreError::Other(format!("rng error: {e}")))
}

/// Load the 32-byte key from the key file, creating it (with a fresh random key)
/// on first use.
fn load_or_create_key() -> Result<[u8; 32]> {
    let path = key_path();
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(bytes) = B64.decode(text.trim()) {
            if bytes.len() == 32 {
                let mut k = [0u8; 32];
                k.copy_from_slice(&bytes);
                return Ok(k);
            }
        }
    }
    let mut k = [0u8; 32];
    rng(&mut k)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&path, B64.encode(k))?;
    restrict_perms(&path);
    Ok(k)
}

#[cfg(unix)]
fn restrict_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict_perms(_path: &Path) {}

fn encrypt_with(key: &[u8; 32], plaintext: &str) -> Result<String> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut nonce = [0u8; 12];
    rng(&mut nonce)?;
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|e| CoreError::Other(format!("encrypt error: {e}")))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(B64.encode(out))
}

fn decrypt_with(key: &[u8; 32], token: &str) -> Result<String> {
    let raw = B64
        .decode(token.trim())
        .map_err(|e| CoreError::Other(format!("base64 error: {e}")))?;
    if raw.len() < 12 {
        return Err(CoreError::Other("ciphertext too short".into()));
    }
    let (nonce, ct) = raw.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let pt = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|e| CoreError::Other(format!("decrypt error: {e}")))?;
    String::from_utf8(pt).map_err(|e| CoreError::Other(format!("utf8 error: {e}")))
}

/// Encrypt a token for storage in the `settings` table (base64 of nonce‖ciphertext).
pub fn encrypt(plaintext: &str) -> Result<String> {
    encrypt_with(&load_or_create_key()?, plaintext)
}

/// Decrypt a token previously produced by [`encrypt`].
pub fn decrypt(token: &str) -> Result<String> {
    decrypt_with(&load_or_create_key()?, token)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_with_a_fixed_key() {
        let key = [7u8; 32];
        let ct = encrypt_with(&key, "ghp_secrettoken").unwrap();
        assert_ne!(ct, "ghp_secrettoken", "stored form is not plaintext");
        assert_eq!(decrypt_with(&key, &ct).unwrap(), "ghp_secrettoken");
    }

    #[test]
    fn wrong_key_fails_to_decrypt() {
        let ct = encrypt_with(&[1u8; 32], "hello").unwrap();
        assert!(decrypt_with(&[2u8; 32], &ct).is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert!(decrypt_with(&[0u8; 32], "not-base64!!").is_err());
        assert!(decrypt_with(&[0u8; 32], "QQ==").is_err()); // too short
    }
}
