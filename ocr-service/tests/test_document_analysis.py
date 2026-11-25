import contextlib
import csv
import io
import os
from pathlib import Path
import tempfile
import unittest

import pymupdf

from document_analysis import analyze_native_page, analyze_scanned_page, build_analysis, expanded_rows, has_time, inferred_schedule, parse_tsv
from process_document import recognize


class DocumentAnalysisTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)

    def schedule(self, merged=False):
        document = pymupdf.open()
        self.addCleanup(document.close)
        page = document.new_page()
        page.insert_text((40, 60), "Training schedule - 26 November 2026", fontsize=15)
        xs, ys = [40, 170, 410, 550], [100, 140, 200, 260]
        for x in xs:
            page.draw_line((x, ys[0]), (x, ys[-1]))
        for y in ys:
            page.draw_line((xs[1] if merged and y == 200 else xs[0], y), (xs[-1], y))
        rows = [["Time", "Activity", "Room"],
                ["08:00 - 09:00" if not merged else "08:00 - 10:00", "Registration\nBring your badge", "A"],
                ["09:00 - 10:00" if not merged else "", "Workshop", ""]]
        for r, row in enumerate(rows):
            for c, text in enumerate(row):
                if text:
                    page.insert_text((xs[c] + 8, ys[r] + 21), text, fontsize=11)
        page.insert_text((40, 300), "End of schedule. Keep the original for reference.", fontsize=11)
        return document, page

    @staticmethod
    def table(result):
        return next(block for block in result["blocks"] if block["type"] == "table")

    def test_native_pdf_keeps_rows_headers_wrapping_and_empty_cells(self):
        _, page = self.schedule()
        result = analyze_native_page(page, 1)
        table = self.table(result)

        self.assertEqual(["Time", "Activity", "Room"], table["column_labels"])
        self.assertEqual("08:00 - 09:00", table["rows"][1][0]["text"])
        self.assertEqual("Registration\nBring your badge", table["rows"][1][1]["text"])
        self.assertEqual("", table["rows"][2][2]["text"])
        self.assertIsNone(table["rows"][1][0]["confidence"])
        self.assertFalse(table["rows"][1][0]["needs_review"])
        self.assertEqual("pdf_text", table["source"])
        self.assertTrue(result["blocks"][0]["text"].startswith("Training schedule"))
        self.assertTrue(result["blocks"][-1]["text"].startswith("End of schedule"))

    def test_merged_time_is_associated_only_with_rows_it_spans(self):
        _, page = self.schedule(merged=True)
        table = self.table(analyze_native_page(page, 1))

        self.assertEqual(2, table["rows"][1][0]["rowspan"])
        self.assertIsNone(table["rows"][2][0])
        analysis = build_analysis([{"number": 1, "blocks": [table]}])
        self.assertEqual(["08:00 - 10:00", "08:00 - 10:00"], [entry["time"] for entry in analysis["schedule"]])
        self.assertEqual("Workshop", analysis["schedule"][1]["values"][1]["text"])

    def test_merged_title_keeps_column_span_and_does_not_replace_real_headers(self):
        document = pymupdf.open()
        self.addCleanup(document.close)
        page = document.new_page()
        xs, ys = [40, 170, 410, 550], [80, 120, 160, 200]
        for index, x in enumerate(xs):
            page.draw_line((x, ys[0] if index in (0, 3) else ys[1]), (x, ys[-1]))
        for y in ys:
            page.draw_line((xs[0], y), (xs[-1], y))
        page.insert_text((50, 104), 'School timetable', fontsize=12)
        for r, values in enumerate([['Time', 'Activity', 'Room'], ['08:00', 'Class', 'A']]):
            for c, value in enumerate(values):
                page.insert_text((xs[c] + 10, ys[r + 1] + 24), value, fontsize=12)
        table = self.table(analyze_native_page(page, 1))
        self.assertEqual(3, table['rows'][0][0]['colspan'])
        self.assertIsNone(table['rows'][0][1])
        self.assertEqual(2, table['header_rows'])
        self.assertEqual(['Time', 'Activity', 'Room'], table['column_labels'])

    def test_schedule_context_keeps_the_source_date_without_guessing_missing_values(self):
        _, page = self.schedule()
        analysis = build_analysis([analyze_native_page(page, 1)])
        self.assertIn('26 November 2026', analysis['schedule'][0]['context'])
        self.assertEqual('', analysis['schedule'][1]['values'][2]['text'])
        self.assertEqual('09:00 - 10:00', analysis['schedule'][1]['time'])

    def test_reading_order_uses_headers_and_each_row_in_source_order(self):
        _, page = self.schedule()
        analysis = build_analysis([analyze_native_page(page, 1)])
        self.assertEqual({"pages": 1, "tables": 1, "schedule_entries": 2, "review_cells": 0}, analysis["summary"])
        self.assertIn("Time: 08:00 - 09:00; Activity: Registration\nBring your badge; Room: A", analysis["reading_text"])
        self.assertIn("Time: 09:00 - 10:00; Activity: Workshop; Room: (empty)", analysis["reading_text"])
        self.assertLess(analysis["reading_text"].index("Registration"), analysis["reading_text"].index("Workshop"))

    def test_scanned_grid_uses_word_positions_instead_of_ocr_block_order(self):
        _, page = self.schedule(merged=True)
        pixmap = page.get_pixmap(dpi=150)
        image = pymupdf.open(stream=pixmap.tobytes("png"), filetype="png")
        self.addCleanup(image.close)
        output = io.StringIO()
        writer = csv.writer(output, delimiter="\t")
        writer.writerow(["level", "left", "top", "width", "height", "conf", "text"])
        # Deliberately reverse OCR order; coordinates must still recover the right cells.
        for word in reversed(page.get_text("words")):
            x0, y0, x1, y1, text = word[:5]
            sx, sy = pixmap.width / page.rect.width, pixmap.height / page.rect.height
            writer.writerow([5, x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy, 40 if text == "Registration" else 98, text])
        result = analyze_scanned_page(image[0], 1, output.getvalue(), pixmap.width, pixmap.height)
        table = self.table(result)

        self.assertEqual("ocr", table["source"])
        self.assertEqual("08:00 - 10:00", table["rows"][1][0]["text"])
        self.assertEqual(2, table["rows"][1][0]["rowspan"])
        self.assertTrue(table["rows"][1][1]["needs_review"])
        self.assertEqual("Workshop", table["rows"][2][1]["text"])
        self.assertEqual("", table["rows"][2][2]["text"])
        self.assertTrue(table["rows"][2][2]["needs_review"])
        self.assertIn("No text was recognized", table["rows"][2][2]["review_reason"])

    def test_borderless_schedule_is_marked_as_inferred_without_filling_empty_cells(self):
        words = []
        for y, values in [(40, [(40, "Time"), (170, "Activity"), (410, "Room")]),
                          (70, [(40, "08:00"), (170, "Registration"), (410, "A")]),
                          (85, [(170, "Check-in")]),
                          (110, [(40, "09:00"), (170, "Workshop")])]:
            for x, text in values:
                words.append({"x0": x, "y0": y, "x1": x + len(text) * 5, "y1": y + 10, "text": text, "confidence": 99})
        table = inferred_schedule(words, "ocr")[0]
        self.assertTrue(table["inferred"])
        self.assertEqual("Registration\nCheck-in", table["rows"][1][1]["text"])
        self.assertEqual("", table["rows"][2][2]["text"])
        self.assertTrue(table["rows"][1][0]["needs_review"])

    def test_khmer_digits_are_detected_without_rewriting_the_time(self):
        self.assertTrue(has_time("ម៉ោង ៨:៣០ - ៩:៣០"))
        self.assertFalse(has_time("12.05.2026"))
        self.assertFalse(has_time("Meeting room 2026"))

    def test_repeated_headers_separate_borderless_schedules(self):
        words = []
        for y, first, second in [(40, 'Time', 'Activity'), (70, '08:00', 'First'), (100, '09:00', 'Second'),
                                  (130, 'Time', 'Activity'), (160, '10:00', 'Third'), (190, '11:00', 'Fourth')]:
            for x, text in [(40, first), (200, second)]:
                words.append({'x0': x, 'y0': y, 'x1': x + len(text) * 5, 'y1': y + 10, 'text': text, 'confidence': None})
        tables = inferred_schedule(words, 'pdf_text')
        self.assertEqual(2, len(tables))
        self.assertEqual('First', tables[0]['rows'][1][1]['text'])
        self.assertEqual('Third', tables[1]['rows'][1][1]['text'])

    def test_plain_paragraphs_are_not_invented_as_tables(self):
        document = pymupdf.open()
        self.addCleanup(document.close)
        page = document.new_page()
        page.insert_text((40, 60), "This is a normal paragraph.\nIt has no schedule or table.", fontsize=12)
        analysis = build_analysis([analyze_native_page(page, 1)])
        self.assertEqual(0, analysis["summary"]["tables"])
        self.assertEqual([], analysis["schedule"])
        self.assertIn("normal paragraph", analysis["reading_text"])

    def test_tsv_ignores_nonword_and_invalid_coordinates(self):
        output = "level\tleft\ttop\twidth\theight\tconf\ttext\n4\t0\t0\t1\t1\t98\tblock\n5\t-5\t0\t10\t10\t98\toutside\n5\t1\t2\t10\t10\t32\t08:00\n"
        words = parse_tsv(output, 100, 100, 100, 100)
        self.assertEqual(["08:00"], [word["text"] for word in words])
        self.assertEqual(32, words[0]["confidence"])

    def test_real_engine_preserves_scanned_schedule_associations(self):
        if os.environ.get("RUN_OCR_INTEGRATION") != "1":
            self.skipTest("Set RUN_OCR_INTEGRATION=1 to run the real engine.")
        _, page = self.schedule()
        path = self.directory / "schedule.png"
        page.get_pixmap(dpi=200).save(path)
        local_data = Path(__file__).resolve().parents[1] / ".runtime/tessdata"
        with contextlib.redirect_stdout(io.StringIO()):
            result = recognize(path, "eng", tessdata=local_data if local_data.is_dir() else None, mode="structured")
        table = self.table(result["analysis"]["pages"][0])
        self.assertIn("08:00", table["rows"][1][0]["text"])
        self.assertIn("Registration", table["rows"][1][1]["text"])
        self.assertIn("09:00", table["rows"][2][0]["text"])
        self.assertIn("Workshop", table["rows"][2][1]["text"])
        self.assertEqual(2, result["analysis"]["summary"]["schedule_entries"])


if __name__ == "__main__":
    unittest.main()
