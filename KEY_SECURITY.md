# API-key handling and leak checks

## Storage and use

YapYap stores the user's key only in Windows Credential Manager at `app.byokdictation.hotkeyprobe/openai-api-key`. This original target remains stable across the YapYap rename so existing saved keys remain available. No raw-key getter is registered as a Tauri command. The UI gets saved-key presence and fixed operation results, clears the input before invoking Save, and displays only explicitly recognized error codes. Unknown IPC errors are not rendered or logged.

Rust uses the key in the Authorization header for HTTPS requests and the live WebSocket to the fixed `api.openai.com` host. Certificate verification remains enabled and redirects are disabled. Provider failure bodies are not returned to the UI. Credential reads and explicitly owned temporary secret buffers are wiped on drop; WinHTTP headers reserve their entire allocation before the secret is copied, including any Content-Type header. The streaming client's Authorization HeaderValue is marked sensitive so its debug representation is redacted; third-party handshake/header/TLS allocations are not guaranteed to be wiped.

This does not guarantee erasure of all WebView, IPC, HTTP/WebSocket library, TLS, or OS memory copies. The key necessarily exists briefly in memory during entry and use. Other software operating with the same Windows user's credentials can generally access this generic Windows credential. This audit does not cover other applications, the user's clipboard, or whole-machine memory dumps.

## Repeatable local audit

From the repository root:

```powershell
python desktop/scripts/audit-key-leaks.py --check-saved-key --check-app-data
```

The script compares the app's saved key, in UTF-8 and UTF-16, entirely in memory. It makes no API calls and prints no key values. It scans repository files (including ignored environment files and logs), frontend build output, the app's native build outputs, this app's local WebView/profile directory, and all local Git objects, including unreachable objects and commit messages. Dependency/compiler caches and filesystem links are excluded. Windows files are opened read-only with sharing enabled so running WebView caches can be checked. Findings print location and category only, with secret-looking labels redacted. Failed reads make the audit incomplete rather than reporting success.

Without the two flags, the scanner checks repository/build files and Git objects for OpenAI-shaped tokens without reading a credential or app profile. Deliberately invalid fixtures are explicitly allowlisted; an exact match to the saved key always reports a finding, independently of that allowlist. `.env` files and common private-key file types are ignored by Git; ignore rules do not prevent a deliberate forced add.

Regression checks:

```powershell
python desktop/scripts/test-audit-key-leaks.py
```

From `desktop/`:

```powershell
node --experimental-strip-types --test scripts/api-key-privacy.test.mjs
```

From `desktop/src-tauri/`:

```powershell
cargo test --lib openai::tests::secret_headers_reserve_the_full_buffer_before_copying_the_key -- --exact
```

## 2026-10-01 audit

- The final saved-key comparison was enabled in the user's Windows context. The scan checked 441 files/build outputs, including the running app's local data, and 242 local Git objects. No matching key exposures were found, and every selected file was readable. The only initial pattern finding was a deliberately invalid transcription-test fixture.
- Code review found no key logging, frontend secret storage, raw-key IPC getter, credential in request URLs, or forwarding of provider failure bodies.
- Hardened input clearing against synchronous IPC exceptions and restricted UI error mapping to owned entries in the allowlist.
- Fixed an HTTP-header reallocation introduced by the developing transcription path, which could have left an extra secret copy in an old freed allocation. The complete buffer is now reserved before key insertion.
- Added scanner, redaction, input-clearing, and header-allocation regression checks. These checks use disposable fixtures and do not invoke the user's API key.
