import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("key_audit", Path(__file__).with_name("audit-key-leaks.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_openai_token_shapes_and_invalid_fixture_allowlist(self):
        for prefix in (b"sk-", b"sk-proj-", b"sk-svcacct-"):
            self.assertTrue(audit.matching_kinds(prefix + b"A" * 48))
        for fixture in audit.FIXTURES:
            self.assertFalse(audit.matching_kinds(fixture + b"adjacent_binary_string"))

    def test_exact_saved_key_wins_even_for_a_fixture_shaped_value(self):
        key = bytearray(audit.FIXTURES[-1])
        self.assertIn("saved", audit.matching_kinds(key, [("saved", key)]))

    def test_utf16_and_chunk_boundary_saved_key_detection(self):
        value = "local-test-marker".encode("utf-16-le")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.bin"
            path.write_bytes(b"x" * (audit.CHUNK_BYTES - 4) + value + b"tail")
            self.assertIn("saved-wide", audit.scan_file(path, [("saved-wide", value)]))

    def test_output_labels_redact_values(self):
        marker = b"sk-proj-" + b"B" * 48
        label = audit.safe_label("path/" + marker.decode(), [("saved", marker)])
        self.assertNotIn(marker.decode(), label)
        self.assertIn("[REDACTED]", label)


if __name__ == "__main__":
    unittest.main()
