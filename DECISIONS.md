# BYOK Dictation Tool — Decision and Progress Log

Record decisions with alternatives, rationale, and revisit conditions. Append dated progress notes with task references and verification evidence; distinguish agreed decisions from verified implementation.

## Decisions — 2026-09-21

### D001 — Windows-only initial release

- **Decision:** Build and verify the initial release on Windows. Defer macOS.
- **Alternative:** Require Windows and macOS at launch.
- **Why:** Keep the first release focused and avoid blocking each capability on a second test environment.
- **Revisit when:** macOS work is scheduled and a test device is available. Verify hotkeys, capture, secure storage, insertion, overlay, permissions, and packaging before claiming support.

### D002 — Memory-only audio buffering

- **Decision:** Retain original audio in memory for API retries while the app remains running. Release it after successful finalization or explicit discard. Do not persist recordings to disk; app exit or crash loses pending audio.
- **Alternative:** Temporary-disk buffering with crash recovery.
- **Why:** Keep the first version smaller and avoid recordings left on disk.
- **Revisit when:** Long-session memory use or a need for crash recovery justifies changing the persistence policy.

### D003 — Hold-to-talk preferred

- **Decision:** Prefer hold-to-talk; use toggle-to-record as the initial fallback if the platform probe requires it.
- **Alternative:** Toggle-only interaction from the start.
- **Why:** Preserve the intended hold → speak → release interaction.
- **Revisit when:** The global keybinding probe establishes shortcut or key-up limitations.

## Decisions — 2026-09-22

### D004 — Tauri + TypeScript + Vite initial stack

- **Decision:** Build the Windows-first app with Tauri, TypeScript, and Vite. Keep OS-specific input and insertion behavior behind small platform interfaces for a later macOS port.
- **Alternative:** Electron + TypeScript + Vite, with a native component for global key release if hold-to-talk requires it.
- **Why:** Tauri's global-shortcut plugin exposes pressed and released events, allowing the first Windows keybinding probe without building an Electron-specific native component. The user intends to port to macOS later.
- **Revisit when:** The Windows probe shows unreliable key release or another required desktop capability cannot be implemented acceptably; reassess on a macOS test device before claiming macOS support.

## Progress

### 2026-09-21 — Task 0 decisions recorded

- Confirmed Windows-only release scope and memory-only audio buffering with the user.
- Updated TASKS.md to reflect those choices across capture, transcription, recovery, and release checks.
- Recorded the previously agreed hotkey preference; platform reliability remains unverified.
- Verification: reread the task list and log for consistent scope and recovery guarantees. No implementation or capability probes have run.
- Next: choose the initial stack and identify the Windows test environment, then run task 1.

### 2026-09-22 — Initial stack chosen (Task 0)

- The user chose Tauri + TypeScript + Vite after comparing Electron and Tauri for hold-to-talk and a later macOS port.
- Local inspection found Windows x64, version 25H2/build 26200, Node 22.14.0, npm 10.9.2, Rust/Cargo, Visual Studio 2022 Professional, Notepad, and VS Code. This is environment inventory, not a capability probe.
- Microphone availability remains unverified because audio-device enumeration returned Access denied. The C++ build workload and a browser input target also remain unverified.
- Next: confirm the Windows test devices and run Task 1's real key-down/key-up probe in Notepad and VS Code. Keep the toggle fallback until that probe establishes reliability.

### 2026-09-22 — Task 0 test environment confirmed

- Windows audio-endpoint inventory reports **Mic In (2- Elgato Wave:3)** with status OK. Chrome and Edge application paths are registered; Notepad and VS Code are also available.
- Task 0's scope, stack, verification access, and memory-only recovery guarantee are now explicit. Marked the remaining Task 0 device item complete in TASKS.md.
- Verification is an environment inventory only. Microphone capture, key-up reliability, and text insertion remain untested and are assigned to their capability probes.
- Next: Task 1, the real Windows global keybinding probe in Notepad and VS Code.
