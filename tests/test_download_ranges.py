import ast
import hashlib
import re
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import urlsplit


BACKEND = Path(__file__).resolve().parents[1] / "src-tauri/resources/backend.py"


class RangeTests(unittest.TestCase):
    def setUp(self):
        self.http = Mock()
        self.addCleanup(self.http.reset_mock)
        namespace = dict(
            hashlib=hashlib, re=re, time=time, requests=self.http,
            urlsplit=urlsplit, TRANSFER_LIMIT=SimpleNamespace(),
        )
        # The backend starts its IPC loop when loaded. Load only the download functions.
        tree = ast.parse(BACKEND.read_text(encoding="utf-8"))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {"download_resumable", "file_sha256"}]
        exec(compile(tree, str(BACKEND), "exec"), namespace)
        self.download = namespace["download_resumable"]
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.part = Path(self.directory.name) / "model.part"
        self.output = Path(self.directory.name) / "model.bin"
        self.expected = b"abcdefghij"

    def response(self, start, end, chunks):
        result = Mock()
        result.__enter__ = Mock(return_value=result)
        result.__exit__ = Mock(return_value=False)
        result.status_code = 206
        result.headers = {"Content-Range": f"bytes {start}-{end}/10"}
        result.iter_content.return_value = iter(chunks)
        return result

    def run_download(self):
        self.download("https://example.test/model", self.part, self.output, 10,
                      hashlib.sha256(self.expected).hexdigest(), lambda *_: None)

    def test_follows_bounded_ranges_from_partial(self):
        self.part.write_bytes(b"abc")
        self.http.get.side_effect = [
            self.response(3, 5, [b"def"]),
            self.response(6, 9, [b"ghij"]),
        ]
        self.run_download()
        self.assertEqual(self.output.read_bytes(), self.expected)
        self.assertEqual([call.kwargs["headers"]["Range"] for call in self.http.get.call_args_list],
                         ["bytes=3-", "bytes=6-"])

    def test_wrong_end_keeps_existing_prefix(self):
        self.part.write_bytes(b"abc")
        self.http.get.return_value = self.response(3, 10, [b"defghij"])
        with self.assertRaisesRegex(RuntimeError, "invalid range"):
            self.run_download()
        self.assertEqual(self.part.read_bytes(), b"abc")
        self.assertFalse(self.output.exists())

    def test_extra_data_does_not_get_appended(self):
        self.part.write_bytes(b"abc")
        self.http.get.return_value = self.response(3, 4, [b"def"])
        with self.assertRaisesRegex(RuntimeError, "more data"):
            self.run_download()
        self.assertEqual(self.part.read_bytes(), b"abc")

    def test_bounded_initial_response_is_supported(self):
        self.http.get.side_effect = [
            self.response(0, 4, [b"abcde"]), self.response(5, 9, [b"fghij"]),
        ]
        self.run_download()
        self.assertEqual(self.output.read_bytes(), self.expected)


if __name__ == "__main__":
    unittest.main()
