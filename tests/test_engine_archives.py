import ast
import io
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile


SOURCE = Path(__file__).resolve().parents[1] / "src-tauri/resources/llama_engine.py"


class EngineArchives(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.output = self.root / "engine"
        self.output.mkdir()
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name == "extract_verified_engine"]
        namespace = dict(tarfile=tarfile, zipfile=zipfile)
        exec(compile(tree, str(SOURCE), "exec"), namespace)
        self.extract = namespace["extract_verified_engine"]

    def make_tar(self, name):
        archive = self.root / "test.tar.gz"
        with tarfile.open(archive, "w:gz") as bundle:
            executable = tarfile.TarInfo(name)
            executable.mode = 0o755
            executable.size = 3
            bundle.addfile(executable, io.BytesIO(b"elf"))
        return archive

    def test_linux_archive_extracts_executable(self):
        self.extract(self.make_tar("llama/bin/llama-server"), self.output)
        target = self.output / "llama/bin/llama-server"
        self.assertEqual(target.read_bytes(), b"elf")
        if target.drive == "":
            self.assertTrue(target.stat().st_mode & 0o100)

    def test_tar_cannot_escape_engine_directory(self):
        with self.assertRaises(tarfile.FilterError):
            self.extract(self.make_tar("../escape"), self.output)
        self.assertFalse((self.root / "escape").exists())

    def test_zip_cannot_escape_engine_directory(self):
        archive = self.root / "test.zip"
        with zipfile.ZipFile(archive, "w") as bundle:
            bundle.writestr("../escape", b"test")
        with self.assertRaises(RuntimeError):
            self.extract(archive, self.output)
        self.assertFalse((self.root / "escape").exists())
