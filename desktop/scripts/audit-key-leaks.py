"""Scan local files/builds and every Git object. Never print secret values.

--check-saved-key compares against this app's Windows credential in memory only.
No API requests are made, and no credential is exported or changed on disk.
"""
import argparse
import ctypes
import os
from pathlib import Path
import re
import subprocess
import sys

TARGET = "com.jingxuan-zhang.yapyap/openai-api-key"
KEY_PATTERN = re.compile(rb"sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}")
# Invalid test markers can concatenate with adjacent strings in native binaries.
# Exact saved-key matching is independent of this fixture allowlist.
FIXTURES = (
    b"sk-fixture-only",
    b"sk-disposable-credential-fixture",
    b"sk-replacement-fixture",
    b"sk-disposable-invalid-validation-fixture",
    b"sk-disposable-invalid-transcription-fixture",
)
CHUNK_BYTES = 1024 * 1024
OVERLAP_BYTES = 8192  # Larger than a maximum-size Windows secret in UTF-16.


def matching_kinds(data, needles=()):
    kinds = set()
    for name, needle in needles:
        if needle and needle in data:
            kinds.add(name)
    for match in KEY_PATTERN.finditer(data):
        if not match.group().startswith(FIXTURES):
            kinds.add("OpenAI key pattern")
    return kinds


def safe_label(label, needles):
    data = str(label).encode("utf-8", errors="replace")
    for _, needle in needles:
        if needle:
            data = data.replace(needle, b"[REDACTED]")
    return KEY_PATTERN.sub(b"[REDACTED]", data).decode("utf-8", errors="replace")


def read_saved_key():
    if os.name != "nt":
        raise RuntimeError("Saved-key comparison requires Windows")
    from ctypes import wintypes

    class Credential(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD), ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR), ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
            ("Persist", wintypes.DWORD), ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p), ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                              ctypes.POINTER(ctypes.POINTER(Credential))]
    api.CredReadW.restype = wintypes.BOOL
    api.CredFree.argtypes = [ctypes.c_void_p]
    api.CredFree.restype = None
    pointer = ctypes.POINTER(Credential)()
    if not api.CredReadW(TARGET, 1, 0, ctypes.byref(pointer)):
        if ctypes.get_last_error() == 1168:  # ERROR_NOT_FOUND
            return None
        raise RuntimeError("Saved credential could not be read")
    try:
        credential = pointer.contents
        size = credential.CredentialBlobSize
        if not credential.CredentialBlob or not 0 < size <= 2560:
            raise RuntimeError("Saved credential could not be compared")
        saved = bytearray(size)
        ctypes.memmove((ctypes.c_ubyte * size).from_buffer(saved), credential.CredentialBlob, size)
        return saved
    finally:
        credential = pointer.contents
        if credential.CredentialBlob and credential.CredentialBlobSize:
            ctypes.memset(credential.CredentialBlob, 0, credential.CredentialBlobSize)
        api.CredFree(pointer)


def directory_files(root):
    # Include ignored .env files, logs, and frontend dist output. Skip dependency
    # and compiler caches; select the app's native build outputs separately.
    for directory, children, files in os.walk(root, followlinks=False):
        children[:] = [name for name in children
                       if name not in {".git", "node_modules", "target", "__pycache__"}
                       and not (Path(directory) / name).is_symlink()]
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink():
                yield path
def files_to_check(root):
    yield from directory_files(root)
    target = root / "desktop" / "src-tauri" / "target"
    for mode in ("debug", "release"):
        output = target / mode
        if output.exists():
            for path in output.iterdir():
                if path.is_file() and not path.is_symlink() and path.suffix.lower() in {
                    ".exe", ".dll", ".pdb", ".lib", ".rlib"
                }:
                    yield path
        bundles = output / "bundle"
        if bundles.exists():
            for path in bundles.rglob("*"):
                if path.is_file() and not path.is_symlink():
                    yield path


def open_shared_read(path):
    if os.name != "nt":
        return path.open("rb")
    # Match Windows readers that allow a running app to keep its cache open.
    # This is read-only and does not change the application's existing handles.
    import msvcrt
    from ctypes import wintypes

    api = ctypes.WinDLL("kernel32", use_last_error=True)
    api.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                               ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
                               wintypes.HANDLE]
    api.CreateFileW.restype = wintypes.HANDLE
    api.CloseHandle.argtypes = [wintypes.HANDLE]
    api.CloseHandle.restype = wintypes.BOOL
    handle = api.CreateFileW(str(path), 0x80000000, 0x7, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise OSError("File could not be opened for comparison")
    try:
        descriptor = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except Exception:
        api.CloseHandle(handle)
        raise
    return os.fdopen(descriptor, "rb")


def scan_file(path, needles):
    found = set()
    carry = b""
    if path.stat().st_size == 0:
        return found
    with open_shared_read(path) as source:
        while chunk := source.read(CHUNK_BYTES):
            data = carry + chunk
            found.update(matching_kinds(data, needles))
            carry = data[-OVERLAP_BYTES:]
    return found


def scan_git(root, needles):
    findings = []
    objects = 0
    # Includes commits/tags/tree names and unreachable local objects, not just HEAD.
    with subprocess.Popen(
        ["git", "cat-file", "--batch-all-objects", "--batch"], cwd=root,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
    ) as process:
        while header := process.stdout.readline():
            object_id, kind, size = header.split()
            remaining = int(size)
            carry = b""
            found = set()
            while remaining:
                chunk = process.stdout.read(min(CHUNK_BYTES, remaining))
                if not chunk:
                    raise RuntimeError("Incomplete Git object read")
                remaining -= len(chunk)
                data = carry + chunk
                found.update(matching_kinds(data, needles))
                carry = data[-OVERLAP_BYTES:]
            if process.stdout.read(1) != b"\n":
                raise RuntimeError("Invalid Git object boundary")
            objects += 1
            if found:
                findings.append((f"Git {kind.decode()} {object_id.decode()}", found))
        if process.wait() != 0:
            raise RuntimeError("Git history scan did not complete")
    return objects, findings


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-saved-key", action="store_true")
    parser.add_argument("--check-app-data", action="store_true",
                        help="Also scan this app's local Windows WebView/profile data")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    needles = []
    try:
        if args.check_saved_key:
            saved = read_saved_key()
            if saved is None:
                print("Saved-key comparison: no saved credential found.")
            else:
                wide = bytearray()
                for byte in saved:
                    wide.extend((byte, 0))
                needles = [("saved key UTF-8", saved), ("saved key UTF-16", wide)]
                print("Saved-key comparison: enabled; values will not be printed.")
        findings = []
        errors = []
        file_count = 0
        paths = list(files_to_check(root))
        if args.check_app_data:
            if os.name != "nt":
                raise RuntimeError("App data comparison requires Windows")
            app_data = Path(os.environ["LOCALAPPDATA"]) / "com.jingxuan-zhang.yapyap"
            if app_data.exists():
                paths.extend(directory_files(app_data))
                print("App-owned local data comparison: enabled.")
            else:
                print("App-owned local data comparison: directory not found.")
        for path in paths:
            label = path.relative_to(root) if path.is_relative_to(root) else "app-data/" + str(path.relative_to(app_data))
            try:
                found = scan_file(path, needles)
                file_count += 1
                if found:
                    findings.append((label, found))
            except OSError:
                errors.append(label)
        object_count, history_findings = scan_git(root, needles)
        findings.extend(history_findings)
        print(f"Scanned {file_count} files/build outputs and {object_count} local Git objects.")
        for label, kinds in findings:
            print(f"FINDING: {safe_label(label, needles)} ({', '.join(sorted(kinds))})")
        for label in errors:
            print(f"UNREADABLE: {safe_label(label, needles)}")
        if errors:
            print("Audit incomplete: some files could not be read.")
            return 2
        if findings:
            print("Possible key exposure found. Secret values were not printed.")
            return 1
        print("No matching key exposures found in the checked locations.")
        return 0
    except Exception:
        # Raw exceptions can include data. Report no secret-bearing exception text.
        print("Audit failed; not all locations were checked. No secret values were printed.")
        return 2
    finally:
        for _, needle in needles:
            needle[:] = b"\0" * len(needle)


if __name__ == "__main__":
    sys.exit(main())
