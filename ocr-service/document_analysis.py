"""Recover document reading order and tables without inventing missing values."""

import bisect
import csv
import io
import math
import re
from collections import defaultdict
from statistics import median

REVIEW_THRESHOLD = 70
HEADER_WORDS = (
    "time", "activity", "subject", "date", "day", "room", "location", "venue",
    "teacher", "instructor", "description", "period", "ម៉ោង", "ពេលវេលា",
    "មុខវិជ្ជា", "កាលបរិច្ឆេទ", "ថ្ងៃ", "សកម្មភាព", "ទីកន្លែង", "បន្ទប់", "គ្រូ",
)
TIME_HEADERS = ("time", "period", "ម៉ោង", "ពេលវេលា")
KHMER_DIGITS = str.maketrans("០១២៣៤៥៦៧៨៩", "0123456789")
TIME_PATTERN = re.compile(r"(?<![\d.])(?:[01]?\d|2[0-3])[:hH][0-5]\d(?!\d)|\b(?:1[0-2]|0?[1-9])\s*[ap]\.?m\.?\b", re.I)


def has_time(text):
    return bool(TIME_PATTERN.search(text.translate(KHMER_DIGITS)))


def box(words):
    return [min(w["x0"] for w in words), min(w["y0"] for w in words),
            max(w["x1"] for w in words), max(w["y1"] for w in words)]


def contains(bounds, word):
    return bounds[0] <= (word["x0"] + word["x1"]) / 2 <= bounds[2] and bounds[1] <= (word["y0"] + word["y1"]) / 2 <= bounds[3]


def visual_lines(words):
    """Use baselines, rather than OCR block order, to keep columns on the same row."""
    lines = []
    for word in sorted(words, key=lambda w: ((w["y0"] + w["y1"]) / 2, w["x0"])):
        center = (word["y0"] + word["y1"]) / 2
        height = max(1, word["y1"] - word["y0"])
        if lines:
            previous = lines[-1]
            baseline = median((w["y0"] + w["y1"]) / 2 for w in previous)
            tolerance = min(height, median(w["y1"] - w["y0"] for w in previous)) * 0.55
            if abs(center - baseline) <= max(2, tolerance):
                previous.append(word)
                continue
        lines.append([word])
    return [sorted(line, key=lambda w: w["x0"]) for line in lines]


def words_text(words):
    return "\n".join(" ".join(w["text"] for w in line) for line in visual_lines(words))


def cell(text, words=(), rowspan=1, colspan=1, inferred=False):
    scores = [w["confidence"] for w in words if w.get("confidence") is not None]
    return {
        "text": text or "", "rowspan": rowspan, "colspan": colspan,
        "confidence": round(sum(scores) / len(scores), 1) if scores else None,
        "needs_review": bool(text) and (inferred or any(score < REVIEW_THRESHOLD for score in scores)),
    }


def header_row_count(rows):
    for index, row in enumerate(rows[:3]):
        values = [c["text"].lower() for c in row if c and c["text"].strip()]
        if len(values) >= 2 and any(label in value for value in values for label in HEADER_WORDS):
            return index + 1
    return 0


def expanded_rows(table):
    """Only repeat values when the source explicitly contains a merged cell."""
    expanded = [[None] * table["columns"] for _ in table["rows"]]
    for r, row in enumerate(table["rows"]):
        for c, value in enumerate(row):
            if value is None:
                continue
            for rr in range(r, min(len(expanded), r + value["rowspan"])):
                for cc in range(c, min(table["columns"], c + value["colspan"])):
                    expanded[rr][cc] = value
    return expanded


def column_labels(table):
    expanded = expanded_rows(table)
    labels = []
    for c in range(table["columns"]):
        parts = []
        for row in expanded[:table["header_rows"]]:
            value = row[c]
            if value and value["text"] and value["colspan"] < table["columns"] and value["text"] not in parts:
                parts.append(value["text"])
        labels.append(" / ".join(parts) or f"Column {c + 1}")
    return labels


def finish_table(bounds, rows, columns, source, inferred=False):
    if len(rows) < 2 or columns < 2 or len(rows) * columns > 5000:
        return None
    if sum(any(c and c["text"].strip() for c in row) for row in rows) < 2:
        return None
    for row in rows:
        for value in row:
            if value is None:
                continue
            if source == "ocr" and not value["text"].strip():
                value["needs_review"] = True
                value["review_reason"] = "No text was recognized in this cell. Check the original."
            elif value["needs_review"]:
                value["review_reason"] = "Cell boundaries were inferred. Check the original." if inferred else "Some words have a low OCR score. Check the original."
    result = {"type": "table", "bbox": [round(v, 2) for v in bounds], "columns": columns,
              "rows": rows, "header_rows": header_row_count(rows), "source": source, "inferred": inferred}
    result["column_labels"] = column_labels(result)
    return result


def native_tables(page, words):
    tables = []
    for table in page.find_tables(strategy="lines", use_layout=False).tables[:50]:
        if table.row_count * table.col_count > 5000:
            continue
        extracted = table.extract()
        rectangles = [bounds for row in table.rows for bounds in row.cells if bounds]
        xs = sorted({round(value, 2) for rect in rectangles for value in (rect[0], rect[2])})
        ys = sorted({round(value, 2) for rect in rectangles for value in (rect[1], rect[3])})
        rows = []
        table_words = [w for w in words if contains(table.bbox, w)]
        for r, row in enumerate(table.rows):
            values = []
            for c, bounds in enumerate(row.cells):
                if bounds is None:
                    values.append(None)
                    continue
                column_span = max(1, sum(bounds[0] - 0.5 <= x < bounds[2] - 0.5 for x in xs))
                row_span = max(1, sum(bounds[1] - 0.5 <= y < bounds[3] - 0.5 for y in ys))
                text = extracted[r][c] or ""
                values.append(cell(text, [w for w in table_words if contains(bounds, w)], row_span, column_span))
            rows.append(values)
        bounds = list(table.bbox)
        if table.header.external and len(table.header.names) == table.col_count and any(table.header.names):
            rows.insert(0, [cell(name or "") for name in table.header.names])
            bounds[1] = min(bounds[1], table.header.bbox[1])
        result = finish_table(bounds, rows, table.col_count, "pdf_text")
        if result:
            tables.append(result)
    return tables


def parse_tsv(output, page_width, page_height, image_width, image_height):
    words = []
    for row in csv.DictReader(io.StringIO(output), delimiter="\t", quoting=csv.QUOTE_NONE):
        if row.get("level") != "5" or not (row.get("text") or "").strip():
            continue
        try:
            x, y, width, height = [float(row[key]) for key in ("left", "top", "width", "height")]
            score = float(row["conf"])
            if not all(math.isfinite(v) for v in (x, y, width, height, score)) or width <= 0 or height <= 0:
                continue
            if x < 0 or y < 0 or x + width > image_width + 2 or y + height > image_height + 2:
                continue
        except (KeyError, ValueError, TypeError):
            continue
        words.append({"x0": x * page_width / image_width, "y0": y * page_height / image_height,
                      "x1": (x + width) * page_width / image_width, "y1": (y + height) * page_height / image_height,
                      "text": row["text"].strip(), "confidence": max(0, min(100, score))})
        if len(words) > 100000:
            raise ValueError("Too many recognized words")
    return words


def line_segments(pixmap, page_width, page_height):
    """Find long dark grid rules using a small grayscale render, without extra dependencies."""
    width, height = pixmap.width, pixmap.height
    dark = pixmap.samples.translate(bytes(1 if value < 150 else 0 for value in range(256)))
    horizontal = re.compile(b"\x01{%d,}" % max(45, int(width * 0.15)))
    vertical = re.compile(b"\x01{%d,}" % max(35, int(height * 0.05)))
    segments = {"h": [], "v": []}
    for axis, count, pattern in (("h", height, horizontal), ("v", width, vertical)):
        raw = []
        for coordinate in range(count):
            data = dark[coordinate * width:(coordinate + 1) * width] if axis == "h" else dark[coordinate::width]
            for match in pattern.finditer(data):
                raw.append([coordinate, match.start(), match.end() - 1])
        for coordinate, start, end in raw:
            previous = next((s for s in reversed(segments[axis][-20:])
                             if coordinate - s[0] <= 3 and abs(s[1] - start) < 5 and abs(s[2] - end) < 5), None)
            if previous is not None:
                previous[0] = (previous[0] + coordinate) / 2
            else:
                segments[axis].append([coordinate, start, end])
        if len(segments[axis]) > 500:
            return [], []
    hs = [[y * page_height / height, x0 * page_width / width, x1 * page_width / width] for y, x0, x1 in segments["h"]]
    vs = [[x * page_width / width, y0 * page_height / height, y1 * page_height / height] for x, y0, y1 in segments["v"]]
    return hs, vs


def clustered(values, tolerance=2):
    groups = []
    for value in sorted(values):
        if groups and value - groups[-1][-1] <= tolerance:
            groups[-1].append(value)
        else:
            groups.append([value])
    return [sum(group) / len(group) for group in groups]


def prepare_ocr_image(page, pixmap):
    """Erase long table rules from a recognition copy; analyze geometry on the original."""
    import pymupdf

    scale = min(1.5, 1600 / max(page.rect.width, page.rect.height))
    gray = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False)
    hs, vs = line_segments(gray, page.rect.width, page.rect.height)
    if len(hs) < 3 or len(vs) < 3:
        return
    sx, sy = pixmap.width / page.rect.width, pixmap.height / page.rect.height
    for y, x0, x1 in hs:
        pixmap.set_rect(pymupdf.IRect(int(x0 * sx), int((y - 1.2) * sy), math.ceil(x1 * sx), math.ceil((y + 1.2) * sy)), (255, 255, 255))
    for x, y0, y1 in vs:
        pixmap.set_rect(pymupdf.IRect(int((x - 1.2) * sx), int(y0 * sy), math.ceil((x + 1.2) * sx), math.ceil(y1 * sy)), (255, 255, 255))


def scanned_tables(page, words):
    import pymupdf

    scale = min(1.5, 1600 / max(page.rect.width, page.rect.height))
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False)
    hs, vs = line_segments(pixmap, page.rect.width, page.rect.height)
    nodes = [("h", i) for i in range(len(hs))] + [("v", i) for i in range(len(vs))]
    neighbors = defaultdict(list)
    for hi, (y, x0, x1) in enumerate(hs):
        for vi, (x, y0, y1) in enumerate(vs):
            if x0 - 3 <= x <= x1 + 3 and y0 - 3 <= y <= y1 + 3:
                neighbors[("h", hi)].append(("v", vi))
                neighbors[("v", vi)].append(("h", hi))
    visited = set()
    tables = []
    for node in nodes:
        if node in visited:
            continue
        stack, component = [node], []
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            component.append(current)
            stack.extend(neighbors[current])
        horizontal = [hs[i] for axis, i in component if axis == "h"]
        vertical = [vs[i] for axis, i in component if axis == "v"]
        xs, ys = clustered(v[0] for v in vertical), clustered(h[0] for h in horizontal)
        if len(xs) < 3 or len(ys) < 3 or (len(xs) - 1) * (len(ys) - 1) > 5000:
            continue
        parents = list(range((len(xs) - 1) * (len(ys) - 1)))
        columns = len(xs) - 1

        def root(index):
            while parents[index] != index:
                parents[index] = parents[parents[index]]
                index = parents[index]
            return index

        def merge(a, b):
            parents[root(b)] = root(a)

        for r in range(len(ys) - 1):
            for c in range(columns):
                if c + 1 < columns and not any(abs(x - xs[c + 1]) < 3 and y0 <= ys[r] + 3 and y1 >= ys[r + 1] - 3 for x, y0, y1 in vertical):
                    merge(r * columns + c, r * columns + c + 1)
                if r + 1 < len(ys) - 1 and not any(abs(y - ys[r + 1]) < 3 and x0 <= xs[c] + 3 and x1 >= xs[c + 1] - 3 for y, x0, x1 in horizontal):
                    merge(r * columns + c, (r + 1) * columns + c)
        groups = defaultdict(list)
        for index in range(len(parents)):
            groups[root(index)].append(divmod(index, columns))
        rows = [[None] * columns for _ in range(len(ys) - 1)]
        bounds = [xs[0], ys[0], xs[-1], ys[-1]]
        buckets = defaultdict(list)
        for word in words:
            if contains(bounds, word):
                r = min(len(ys) - 2, max(0, bisect.bisect_right(ys, (word["y0"] + word["y1"]) / 2) - 1))
                c = min(columns - 1, max(0, bisect.bisect_right(xs, (word["x0"] + word["x1"]) / 2) - 1))
                buckets[root(r * columns + c)].append(word)
        for key, positions in groups.items():
            r0, c0 = min(r for r, c in positions), min(c for r, c in positions)
            r1, c1 = max(r for r, c in positions), max(c for r, c in positions)
            if len(positions) != (r1 - r0 + 1) * (c1 - c0 + 1):
                # A damaged rule must not create a falsely merged, nonrectangular cell.
                for r, c in positions:
                    cell_words = [w for w in buckets[key] if contains([xs[c], ys[r], xs[c + 1], ys[r + 1]], w)]
                    rows[r][c] = cell(words_text(cell_words), cell_words, inferred=True)
            else:
                rows[r0][c0] = cell(words_text(buckets[key]), buckets[key], r1 - r0 + 1, c1 - c0 + 1)
        result = finish_table(bounds, rows, columns, "ocr")
        if result:
            tables.append(result)
    return tables[:50]


def inferred_schedule(words, source):
    """Conservatively infer an unruled timetable, and mark every inferred cell for review."""
    lines = visual_lines(words)
    candidates = []
    for line in lines:
        runs = [[]]
        threshold = max(12, median(w["y1"] - w["y0"] for w in line) * 1.2)
        for word in line:
            if runs[-1] and word["x0"] - runs[-1][-1]["x1"] > threshold:
                runs.append([])
            runs[-1].append(word)
        if len(runs) >= 2:
            candidates.append((line, runs))
    timed = [(line, runs) for line, runs in candidates if has_time(words_text(runs[0]))]
    if len(timed) < 2:
        return []
    # Keep distinct tables apart instead of connecting schedules across a page.
    groups = []
    for entry in timed:
        previous_bottom = box(groups[-1][-1][0])[3] if groups else -math.inf
        repeated_header = any(previous_bottom < box(line)[1] < box(entry[0])[1]
                              and any(label in words_text(line).lower() for label in HEADER_WORDS)
                              for line, _ in candidates)
        if groups and not repeated_header and box(entry[0])[1] - previous_bottom < 70:
            groups[-1].append(entry)
        else:
            groups.append([entry])
    tables = []
    for group in groups:
        if len(group) < 2:
            continue
        first = box(group[0][0])
        headers = [(line, runs) for line, runs in candidates if 0 <= first[1] - box(line)[3] < 50
                   and any(label in words_text(line).lower() for label in HEADER_WORDS)]
        selected = ([headers[-1]] if headers else []) + group
        starts = clustered(run[0]["x0"] for _, runs in selected for run in runs)
        starts = [x for x in starts if sum(any(abs(run[0]["x0"] - x) < 7 for run in runs) for _, runs in selected) >= 2
                  or (headers and any(abs(run[0]["x0"] - x) < 7 for run in headers[-1][1]))]
        if not 2 <= len(starts) <= 12:
            continue
        bounds = box([w for line, _ in selected for w in line])
        anchors = [box(line)[1] for line, _ in selected]
        buckets = [[[] for _ in starts] for _ in selected]
        for word in words:
            if contains(bounds, word):
                r = max(0, min(len(selected) - 1, bisect.bisect_right(anchors, word["y0"] + 2) - 1))
                c = max(0, min(len(starts) - 1, bisect.bisect_right(starts, word["x0"] + 5) - 1))
                buckets[r][c].append(word)
        rows = [[cell(words_text(bucket), bucket, inferred=True) for bucket in row] for row in buckets]
        result = finish_table(bounds, rows, len(starts), source, inferred=True)
        if result:
            tables.append(result)
    return tables


def page_result(number, words, tables, source):
    remaining = [w for w in words if not any(contains(t["bbox"], w) for t in tables)]
    blocks = [{"type": "text", "text": words_text(line), "bbox": [round(v, 2) for v in box(line)], "source": source} for line in visual_lines(remaining)]
    for index, table in enumerate(sorted(tables, key=lambda t: (t["bbox"][1], t["bbox"][0])), 1):
        table["id"] = f"p{number}-t{index}"
    blocks.extend(tables)
    return {"number": number, "blocks": sorted(blocks, key=lambda b: (b["bbox"][1], b["bbox"][0]))}


def analyze_native_page(page, number):
    raw = page.get_text("words", sort=True)
    if sum(len(w[4]) for w in raw) < 10:
        return None
    # A small title above a scanned table is not a complete native text layer.
    if len(raw) < 50 and any((image["bbox"][2] - image["bbox"][0]) * (image["bbox"][3] - image["bbox"][1]) > page.rect.get_area() * 0.25 for image in page.get_image_info()):
        return None
    words = [{"x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3], "text": w[4], "confidence": None} for w in raw]
    tables = native_tables(page, words)
    remaining = [w for w in words if not any(contains(t["bbox"], w) for t in tables)]
    tables.extend(inferred_schedule(remaining, "pdf_text"))
    return page_result(number, words, tables, "pdf_text")


def analyze_scanned_page(page, number, output, image_width, image_height):
    words = parse_tsv(output, page.rect.width, page.rect.height, image_width, image_height)
    tables = scanned_tables(page, words)
    remaining = [w for w in words if not any(contains(t["bbox"], w) for t in tables)]
    tables.extend(inferred_schedule(remaining, "ocr"))
    return page_result(number, words, tables, "ocr")


def build_analysis(pages):
    schedule = []
    reading = []
    tables_count = review_count = 0
    for page in pages:
        reading.append(f"Page {page['number']}")
        context = []
        for block in page["blocks"]:
            if block["type"] == "text":
                reading.append(block["text"])
                context.append(block["text"])
                continue
            tables_count += 1
            labels = block["column_labels"]
            expanded = expanded_rows(block)
            review_count += sum(bool(c and c["needs_review"]) for row in block["rows"] for c in row)
            reading.append(f"Table {tables_count}")
            time_columns = [i for i, label in enumerate(labels) if any(header in label.lower() for header in TIME_HEADERS)]
            for index, row in enumerate(expanded):
                if index < block["header_rows"]:
                    continue
                values = [{"label": labels[c], "text": value["text"] if value else ""} for c, value in enumerate(row)]
                blank_label = "(no text recognized)" if block["source"] == "ocr" else "(empty)"
                reading.append("; ".join(f"{value['label']}: {value['text'] or blank_label}" for value in values))
                times = [row[c]["text"] for c in time_columns if row[c] and row[c]["text"].strip()]
                if not times:
                    times = [value["text"] for value in values if has_time(value["text"])]
                if times:
                    schedule.append({"page": page["number"], "table_id": block["id"], "row": index + 1,
                                     "time": times[0], "values": values,
                                     "context": "\n".join(context[-6:]), "source": block["source"],
                                     "needs_review": any(c and c["needs_review"] for c in row)})
            context = []
    return {"version": 1, "pages": pages, "schedule": schedule,
            "summary": {"pages": len(pages), "tables": tables_count, "schedule_entries": len(schedule), "review_cells": review_count},
            "reading_text": "\n\n".join(reading)}
