import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import pymupdf

from process_document import MAX_FILE_BYTES, MAX_PIXELS, OcrError, main, recognize


class DocumentOcrTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)

    def pdf(self, pages=1, encrypted=False, large=False):
        path = self.directory / "document.pdf"
        with pymupdf.open() as document:
            for _ in range(pages):
                page = document.new_page(width=4000 if large else 595, height=4000 if large else 842)
                page.insert_text((50, 60), "KhmerDocs OCR sample", fontsize=20)
            options = {"encryption": pymupdf.PDF_ENCRYPT_AES_256, "owner_pw": "owner", "user_pw": "secret"} if encrypted else {}
            document.save(path, **options)
        return path

    @staticmethod
    def successful_process(command, **kwargs):
        output = "Available languages:\neng\nkhm\n" if "--list-langs" in command else "សួស្តីកម្ពុជា\nEnglish text\n"
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")

    def test_renders_every_pdf_page_and_preserves_unicode(self):
        path = self.pdf(pages=2)
        output = io.StringIO()
        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=self.successful_process), contextlib.redirect_stdout(output):
            result = recognize(path, "khm+eng")

        self.assertEqual({"text": "សួស្តីកម្ពុជា\nEnglish text\n\nសួស្តីកម្ពុជា\nEnglish text", "pages": 2}, result)
        events = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual([{"event": "started", "pages": 2}, {"event": "page", "page": 1, "pages": 2}, {"event": "page", "page": 2, "pages": 2}], events)

    def test_accepts_extensionless_png_uploads(self):
        with pymupdf.open(self.pdf()) as document:
            image = document[0].get_pixmap()
            path = self.directory / "private-upload"
            path.write_bytes(image.tobytes("png"))
        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=self.successful_process), contextlib.redirect_stdout(io.StringIO()):
            result = recognize(path, "eng")
        self.assertEqual(1, result["pages"])

    def test_limits_rendered_pixels_and_cleans_temporary_images(self):
        path = self.pdf(large=True)
        images = []

        def process(command, **kwargs):
            if "--list-langs" not in command:
                image_path = Path(command[1])
                images.append(image_path)
                image = pymupdf.Pixmap(image_path)
                self.assertLessEqual(image.width * image.height, MAX_PIXELS + 10000)
            return self.successful_process(command, **kwargs)

        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=process), contextlib.redirect_stdout(io.StringIO()):
            recognize(path, "eng")
        self.assertEqual(1, len(images))
        self.assertFalse(images[0].exists())

    def test_rejects_password_protected_pdfs(self):
        path = self.pdf(encrypted=True)
        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=self.successful_process):
            with self.assertRaisesRegex(OcrError, "password protected"):
                recognize(path, "eng")

    def test_rejects_documents_over_the_page_limit(self):
        path = self.pdf(pages=26)
        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=self.successful_process):
            with self.assertRaisesRegex(OcrError, "1 to 25 pages"):
                recognize(path, "eng")

    def test_rejects_files_over_ten_megabytes(self):
        path = self.directory / "oversized.pdf"
        with path.open("wb") as output:
            output.truncate(MAX_FILE_BYTES + 1)
        with self.assertRaisesRegex(OcrError, "up to 10 MB"):
            recognize(path, "eng")

    def test_rejects_missing_files(self):
        with self.assertRaisesRegex(OcrError, "no longer available"):
            recognize(self.directory / "missing.pdf", "eng")

    def test_rejects_languages_outside_the_allowlist(self):
        with self.assertRaisesRegex(OcrError, "Choose Khmer"):
            recognize(self.directory / "missing.pdf", "eng --psm 0")

    def test_reports_unavailable_language_models(self):
        path = self.pdf()
        with patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", return_value=subprocess.CompletedProcess([], 0, stdout="eng\n", stderr="")):
            with self.assertRaisesRegex(OcrError, "this language is unavailable"):
                recognize(path, "khm")

    def test_cli_returns_a_safe_error_for_unreadable_files(self):
        path = self.directory / "broken.pdf"
        path.write_text("Not a PDF", encoding="utf-8")
        output = io.StringIO()
        with patch("sys.argv", ["process_document.py", str(path)]), patch("process_document.find_tesseract", return_value="tesseract"), patch("process_document.subprocess.run", side_effect=self.successful_process), contextlib.redirect_stdout(output):
            exit_code = main()
        self.assertEqual(1, exit_code)
        error = json.loads(output.getvalue())
        self.assertEqual("error", error["event"])
        self.assertNotIn(str(path), error["message"])

    def test_cli_converts_page_timeouts_into_actionable_errors(self):
        output = io.StringIO()
        with patch("sys.argv", ["process_document.py", "sample.pdf"]), patch("process_document.recognize", side_effect=subprocess.TimeoutExpired("tesseract", 60)), contextlib.redirect_stdout(output):
            exit_code = main()
        self.assertEqual(1, exit_code)
        self.assertIn("Split the document", json.loads(output.getvalue())["message"])

    def test_real_engine_recognizes_khmer_and_english(self):
        if os.environ.get("RUN_OCR_INTEGRATION") != "1":
            self.skipTest("Set RUN_OCR_INTEGRATION=1 to run the real engine.")
        font = Path(os.environ.get("OCR_TEST_KHMER_FONT", "C:/Windows/Fonts/KhmerOS.ttf"))
        if not font.is_file():
            self.skipTest("Set OCR_TEST_KHMER_FONT to an installed Khmer font.")
        path = self.directory / "bilingual.pdf"
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_htmlbox(
                pymupdf.Rect(40, 40, 550, 300),
                f'<style>@font-face {{font-family: khmer; src: url({font.name});}} body {{font-family: khmer; font-size: 26px;}}</style><p>ព្រះរាជាណាចក្រកម្ពុជា</p><p>KhmerDocs OCR sample 2026</p>',
                archive=pymupdf.Archive(str(font.parent)),
            )
            document.save(path)
        local_data = Path(__file__).resolve().parents[1] / ".runtime/tessdata"
        with contextlib.redirect_stdout(io.StringIO()):
            result = recognize(path, "khm+eng", tessdata=local_data if local_data.is_dir() else None)
        self.assertRegex(result["text"], r"[\u1780-\u17ff]")
        self.assertIn("KhmerDocs OCR sample 2026", result["text"])


if __name__ == "__main__":
    unittest.main()
