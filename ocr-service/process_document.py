"""Render a private document and emit OCR progress as newline-delimited JSON."""

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_TEXT_CHARACTERS = 2_000_000
LANGUAGES = ("khm+eng", "khm", "eng")


class OcrError(Exception):
    """An error that can be shown to the document owner."""


def emit(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=True), flush=True)


def find_tesseract(executable):
    found = shutil.which(executable)
    if found:
        return found
    if executable == "tesseract" and os.name == "nt":
        candidate = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Tesseract-OCR/tesseract.exe"
        if candidate.is_file():
            return str(candidate)
    raise OcrError("Text recognition is unavailable. Please contact your administrator.")


def recognize(path, language, tesseract="tesseract", tessdata=None, max_pages=25, page_timeout=60, mode="text"):
    import pymupdf

    if language not in LANGUAGES:
        raise OcrError("Choose Khmer, English, or Khmer and English.")
    if mode not in ("text", "structured"):
        raise OcrError("Choose plain text or tables and schedules.")
    source = Path(path)
    if not source.is_file():
        raise OcrError("The original file is no longer available.")
    if source.stat().st_size > MAX_FILE_BYTES:
        raise OcrError("Text recognition supports files up to 10 MB.")

    executable = find_tesseract(tesseract)
    data_options = ["--tessdata-dir", str(tessdata)] if tessdata else []
    available = subprocess.run(
        [executable, *data_options, "--list-langs"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )
    if available.returncode != 0 or not set(language.split("+")).issubset(set(available.stdout.splitlines())):
        raise OcrError("Recognition for this language is unavailable. Please contact your administrator.")

    # PyMuPDF identifies extensionless uploads by their contents.
    with pymupdf.open(source) as document:
        if document.needs_pass:
            raise OcrError("This PDF is password protected. Upload an unlocked copy.")
        with source.open("rb") as input_file:
            signature = input_file.read(8)
        if not document.is_pdf and not (signature.startswith(b"\x89PNG\r\n\x1a\n") or signature.startswith(b"\xff\xd8\xff")):
            raise OcrError("Text recognition supports PDF, PNG, and JPEG files.")
        if not 1 <= document.page_count <= max_pages:
            raise OcrError(f"Text recognition supports documents with 1 to {max_pages} pages.")

        emit("started", pages=document.page_count)
        texts = []
        analyzed_pages = []
        total_characters = 0
        with tempfile.TemporaryDirectory(prefix="khmerdocs-ocr-") as temporary:
            image_path = Path(temporary) / "page.png"
            for index, page in enumerate(document):
                if page.rotation:
                    page.remove_rotation()
                if mode == "structured":
                    from document_analysis import analyze_native_page, analyze_scanned_page, build_analysis, prepare_ocr_image

                    native = analyze_native_page(page, index + 1)
                    if native is not None:
                        analyzed_pages.append(native)
                        emit("page", page=index + 1, pages=document.page_count)
                        continue
                area = page.rect.width * page.rect.height
                if not math.isfinite(area) or area <= 0:
                    raise OcrError("A page in this document could not be read.")
                scale = min(300 / 72, math.sqrt(MAX_PIXELS / area))
                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csRGB, alpha=False)
                if mode == "structured":
                    prepare_ocr_image(page, pixmap)
                pixmap.save(image_path)
                image_width, image_height = pixmap.width, pixmap.height
                del pixmap
                result = subprocess.run(
                    [executable, str(image_path), "stdout", *data_options, "-l", language, "--oem", "1", "--psm", "11" if mode == "structured" else "3", *(["-c", "tessedit_create_tsv=1", "-c", "tessedit_create_txt=0"] if mode == "structured" else [])],
                    capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=page_timeout,
                    env={**os.environ, "OMP_THREAD_LIMIT": "2"},
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                if result.returncode != 0:
                    raise OcrError("A page could not be recognized. Try a clearer or smaller document.")
                if mode == "structured":
                    analyzed_pages.append(analyze_scanned_page(page, index + 1, result.stdout, image_width, image_height))
                    text = build_analysis([analyzed_pages[-1]])["reading_text"]
                else:
                    text = result.stdout.replace("\x0c", "").strip()
                total_characters += len(text)
                if total_characters > MAX_TEXT_CHARACTERS:
                    raise OcrError("The extracted text is too large. Split the document into smaller files.")
                texts.append(text)
                emit("page", page=index + 1, pages=document.page_count)
        if mode == "structured":
            analysis = build_analysis(analyzed_pages)
            if len(analysis["reading_text"]) > MAX_TEXT_CHARACTERS:
                raise OcrError("The extracted text is too large. Split the document into smaller files.")
            return {"text": analysis["reading_text"], "pages": document.page_count, "analysis": analysis}
        return {"text": "\n\n".join(texts), "pages": document.page_count}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path")
    parser.add_argument("--language", choices=LANGUAGES, default="khm+eng")
    parser.add_argument("--tesseract", default="tesseract")
    parser.add_argument("--tessdata")
    parser.add_argument("--max-pages", type=int, default=25)
    parser.add_argument("--page-timeout", type=int, default=60)
    parser.add_argument("--mode", choices=("text", "structured"), default="text")
    arguments = parser.parse_args()
    local_data = Path(__file__).parent / ".runtime/tessdata"
    tessdata = arguments.tessdata or (local_data if (local_data / "khm.traineddata").is_file() else None)
    try:
        result = recognize(
            arguments.path, arguments.language, arguments.tesseract, tessdata,
            arguments.max_pages, arguments.page_timeout, arguments.mode,
        )
        emit("completed", **result)
        return 0
    except OcrError as error:
        emit("error", message=str(error))
    except subprocess.TimeoutExpired:
        emit("error", message="Recognition took too long. Split the document into smaller files and try again.")
    except ImportError:
        emit("error", message="Text recognition is unavailable. Please contact your administrator.")
    except Exception:
        emit("error", message="This file could not be read. Upload a valid PDF, PNG, or JPEG and try again.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
