import ast
import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock


BACKEND = Path(__file__).resolve().parents[1] / "src-tauri/resources/backend.py"


class MediaWorkflowTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.output = self.root / "output"
        self.scratch = self.root / "scratch"
        self.output.mkdir()
        self.scratch.mkdir()
        self.video = Mock()
        self.load = Mock()
        tree = ast.parse(BACKEND.read_text(encoding="utf-8"))
        tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef)
                     and node.name in {"media_reference", "media_workflow_job"}]
        self.namespace = dict(re=re, Path=Path, OUTPUT_DIR=self.output,
                              TEMP_IMAGES=self.scratch, load_model=self.load,
                              generate_video=self.video,
                              image_context=lambda data: {"parent_image": data["parent_image"]})
        exec(compile(tree, str(BACKEND), "exec"), self.namespace)

    def test_only_studio_png_references_can_be_selected(self):
        reference = self.scratch / "fox.png"
        reference.write_bytes(b"test")
        media_reference = self.namespace["media_reference"]
        self.assertEqual(media_reference("fox.png"), reference)
        for value in ("../fox.png", "..\\\\fox.png", "fox.wav"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                media_reference(value)

    def test_video_job_reuses_image_and_does_not_repeat_saved_output(self):
        job = dict(id="a" * 32, kind="video", model="test/i2v", prompt="Motion",
                   parent_image="fox.png")
        name = "workflow_" + job["id"] + ".mp4"

        def save(prompt, reference, metadata, filename):
            self.assertEqual(reference, "fox.png")
            self.assertEqual(metadata, {"parent_image": "fox.png"})
            (self.output / filename).write_bytes(b"test-video")

        self.video.side_effect = save
        run = self.namespace["media_workflow_job"]
        self.assertEqual(run(job), {"name": name})
        self.assertEqual(run(job), {"name": name})
        self.video.assert_called_once()
        self.load.assert_called_once_with("test/i2v", "video")
