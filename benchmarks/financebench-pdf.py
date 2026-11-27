"""Extract full FinanceBench PDFs as Markdown with addressable source lines."""
import re
import unicodedata

import pymupdf


def clean(text):
    return " ".join(unicodedata.normalize("NFKC", text).replace("\u00ad", "").split())


def numeric_cells(cells):
    return len(cells) > 1 and any(re.search(r"\d|^[($%—–-]+$", c) for c in cells[1:])


def heading(line, bold):
    if len(line) > 150 or len(line.split()) > 19 or line.endswith((".", ";", ",")):
        return 0
    if re.match(r"^PART\s+[IVX]+\b", line, re.I):
        return 1
    if re.match(r"^ITEM\s+\d+[A-Z]?\b", line, re.I):
        return 2
    if any(c.isalpha() for c in line) and (line.isupper() or line.casefold() in bold):
        return 3
    return 0


def extract(pdf):
    source, pages, units = [], [], []
    length = 0

    def emit(text):
        nonlocal length
        source.append(text)
        length += len(text)

    with pymupdf.open(pdf) as doc:
        for page in doc:
            if source:
                emit("\n\n")
            page_start, start_units = length, len(units)
            styles = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_PRESERVE_IMAGES)
            bold = {clean(" ".join(s["text"] for s in line["spans"])).casefold()
                    for block in styles["blocks"] for line in block.get("lines", [])
                    if all(s["flags"] & 16 for s in line["spans"] if s["text"].strip())}
            physical = page.get_text("text", sort=True).splitlines()
            rows = []
            gap = True
            for i, raw in enumerate(physical):
                text = clean(raw)
                if not text:
                    gap = True
                    continue
                if (i < 5 and text.casefold() == "table of contents") or (
                        (i < 2 or i >= len(physical)-3) and re.fullmatch(r"(?:[A-Z]-)?\d{1,3}", text)):
                    continue
                cells = [clean(c) for c in re.split(r"\s{3,}", raw.strip())]
                rows.append((text, cells, gap))
                gap = False
            table = [numeric_cells(c) for _, c, _ in rows]
            for i, (_, cells, _) in enumerate(rows):
                if len(cells) > 1 and ((i and table[i-1]) or (i+1 < len(rows) and table[i+1])):
                    table[i] = True
            last_type = ""
            for i, (text, cells, gap) in enumerate(rows):
                is_table = table[i]
                depth = 0 if is_table else heading(text, bold)
                kind = "table" if is_table else "heading" if depth else "text"
                separator = "\n\n" if (last_type != kind or gap or depth) else " "
                if kind == last_type == "table":
                    separator = "\n"
                if last_type:
                    emit(separator)
                if is_table:
                    emit("| ")
                    text = " | ".join(c.replace("|", "\\|") for c in cells)
                elif depth:
                    emit("#" * depth + " ")
                start = length
                emit(text)
                units.append([start, length, kind])
                if is_table:
                    emit(" |")
                    if last_type != "table":
                        emit("\n| " + " | ".join("---" for _ in cells) + " |")
                last_type = kind
            pages.append([page_start, length, start_units, len(units)])
    return {"source": "".join(source), "pages": pages, "units": units}
