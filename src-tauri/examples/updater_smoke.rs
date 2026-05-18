// Offline smoke test for the auto-updater signing chain.
//
// Validates the link between the public key embedded in tauri.conf.json and
// the signature file produced by `tauri build` (with createUpdaterArtifacts:
// true). If this passes, the runtime updater plugin will accept the bundle
// when it downloads it from GitHub Releases. Use:
//   cargo run --example updater_smoke -- \
//     "../updater_smoke_test/Linear.Board.app.tar.gz" \
//     "../updater_smoke_test/Linear.Board.app.tar.gz.sig" \
//     "../updater_smoke_test/pubkey.txt"
//
// The pubkey.txt file should contain the same base64 minisign blob that we
// pasted into `plugins.updater.pubkey` in tauri.conf.json.
//
// What it does:
//   1. base64-decodes pubkey.txt -> minisign public key bytes
//   2. reads the .sig file (base64-decoded minisign signature)
//   3. computes the signature over the .tar.gz content using minisign-verify
//   4. prints OK / FAIL — exit 0 on success, non-zero on failure
//
// A successful smoke proves the entire chain (private key in ~/.tauri/ →
// tauri build → .sig → public key in tauri.conf.json) is wired correctly.

use std::env;
use std::fs;
use std::process::ExitCode;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use minisign_verify::{PublicKey, Signature};

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 4 {
        eprintln!(
            "usage: cargo run --example updater_smoke -- <bundle.tar.gz> <sig.file> <pubkey.txt>"
        );
        return ExitCode::from(2);
    }
    let bundle_path = &args[1];
    let sig_path = &args[2];
    let pub_path = &args[3];

    println!("bundle: {bundle_path}");
    println!("sig:    {sig_path}");
    println!("pubkey: {pub_path}");

    let bundle = match fs::read(bundle_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("FAIL: read bundle: {e}");
            return ExitCode::from(1);
        }
    };
    println!("bundle bytes: {}", bundle.len());

    let sig_b64 = match fs::read_to_string(sig_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("FAIL: read sig: {e}");
            return ExitCode::from(1);
        }
    };

    // The .sig file written by tauri-cli is itself base64; we decode once to
    // get the minisign-formatted "untrusted comment + signature" text.
    let sig_bytes = match B64.decode(sig_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("FAIL: base64-decode sig: {e}");
            return ExitCode::from(1);
        }
    };
    let sig_str = match std::str::from_utf8(&sig_bytes) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("FAIL: sig bytes not utf-8: {e}");
            return ExitCode::from(1);
        }
    };
    let signature = match Signature::decode(sig_str) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("FAIL: minisign decode signature: {e}");
            return ExitCode::from(1);
        }
    };

    // Same trick on the pubkey: tauri's `signer generate` writes the .pub as
    // a single-line base64 blob that decodes to "untrusted comment + key".
    let pub_b64 = match fs::read_to_string(pub_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("FAIL: read pubkey: {e}");
            return ExitCode::from(1);
        }
    };
    let pub_bytes = match B64.decode(pub_b64.trim()) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("FAIL: base64-decode pubkey: {e}");
            return ExitCode::from(1);
        }
    };
    let pub_str = match std::str::from_utf8(&pub_bytes) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("FAIL: pubkey bytes not utf-8: {e}");
            return ExitCode::from(1);
        }
    };
    let pubkey = match PublicKey::decode(pub_str) {
        Ok(k) => k,
        Err(e) => {
            eprintln!("FAIL: minisign decode pubkey: {e}");
            return ExitCode::from(1);
        }
    };

    match pubkey.verify(&bundle, &signature, false) {
        Ok(()) => {
            println!("OK: signature valid for the supplied bundle + pubkey pair");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("FAIL: signature verification: {e}");
            ExitCode::from(1)
        }
    }
}
