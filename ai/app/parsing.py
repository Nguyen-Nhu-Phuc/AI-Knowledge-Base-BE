from __future__ import annotations

import re
from dataclasses import dataclass
from io import BytesIO

import fitz  # PyMuPDF
from docx import Document as DocxDocument

from app.ocr import image_to_text, ocr_available, pdf_page_ocr_text


@dataclass
class ParsedPage:
    page: int | None
    text: str


IMAGE_MIME = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/tiff",
    "image/tif",
}


def _clean_text(text: str) -> str:
    text = text.replace("\x00", " ")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def _extract_native_text(page: fitz.Page) -> str:
    """Best-effort selectable-text extract (no OCR)."""
    strategies = (
        lambda: page.get_text("text") or "",
        lambda: page.get_text("blocks") or "",
        lambda: page.get_text("dict"),
    )
    best = ""
    for strategy in strategies:
        try:
            raw = strategy()
        except Exception:  # noqa: BLE001
            continue
        cleaned = ""
        if isinstance(raw, str):
            cleaned = _clean_text(raw)
        elif isinstance(raw, (list, tuple)):
            parts = []
            for block in raw:
                if (
                    isinstance(block, (list, tuple))
                    and len(block) >= 5
                    and isinstance(block[4], str)
                ):
                    parts.append(block[4])
            cleaned = _clean_text("\n".join(parts))
        elif isinstance(raw, dict):
            parts: list[str] = []
            for block in raw.get("blocks") or []:
                for line in block.get("lines") or []:
                    spans = line.get("spans") or []
                    line_text = "".join(str(s.get("text") or "") for s in spans)
                    if line_text.strip():
                        parts.append(line_text)
            cleaned = _clean_text("\n".join(parts))
        if len(cleaned) > len(best):
            best = cleaned
    return best


def _page_has_images(page: fitz.Page) -> bool:
    try:
        if page.get_images(full=True):
            return True
    except Exception:  # noqa: BLE001
        pass
    try:
        # Scanned pages often are one full-page pixmap / form-xobject
        if page.get_drawings():
            # drawings alone are not enough; check coverage via rawdict images
            raw = page.get_text("rawdict") or {}
            for block in raw.get("blocks") or []:
                if block.get("type") == 1:  # image block
                    return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _needs_ocr(page: fitz.Page, native: str) -> bool:
    """OCR when there is no/little text, or page looks image-heavy (hybrid scan)."""
    from app.config import settings as cfg

    if not native.strip():
        return True
    # Sparse extract (headers/page numbers / broken text layer) → try OCR
    if len(native) < cfg.ocr_min_native_chars:
        return True
    # Very sparse text on a large page even if above the char floor
    try:
        area = abs(page.rect.width * page.rect.height) or 1.0
        chars_per_area = len(native) / area
        if chars_per_area < 0.002 and _page_has_images(page):
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _pick_better_text(native: str, ocr: str) -> tuple[str, bool]:
    """Prefer the longer, denser extraction so partial native text does not win."""
    n = _clean_text(native)
    o = _clean_text(ocr)
    if not o:
        return n, False
    if not n:
        return o, True
    # OCR wins when it recovers substantially more content
    if len(o) >= max(len(n) * 1.25, len(n) + 40):
        return o, True
    # Merge unique OCR lines that native missed (keep reading order via OCR body)
    if len(o) > len(n):
        return o, True
    return n, False


def _page_text(page: fitz.Page) -> tuple[str, bool]:
    """Return (text, used_ocr) for one PDF page."""
    native = _extract_native_text(page)
    if _needs_ocr(page, native):
        ocr = pdf_page_ocr_text(page)
        return _pick_better_text(native, ocr)
    return native, False


def parse_pdf(data: bytes) -> tuple[str, list[ParsedPage], int, str]:
    doc = fitz.open(stream=data, filetype="pdf")
    try:
        pages: list[ParsedPage] = []
        parts: list[str] = []
        used_ocr = False
        for i, page in enumerate(doc, start=1):
            cleaned, page_ocr = _page_text(page)
            if page_ocr:
                used_ocr = True
            if cleaned:
                pages.append(ParsedPage(page=i, text=cleaned))
                parts.append(f"[Page {i}]\n{cleaned}")
        full = _clean_text("\n\n".join(parts))
        parser = "pymupdf+ocr" if used_ocr else "pymupdf"
        return full, pages, doc.page_count, parser
    finally:
        doc.close()


def parse_docx(data: bytes) -> tuple[str, list[ParsedPage], int | None]:
    document = DocxDocument(BytesIO(data))
    paras = [_clean_text(p.text) for p in document.paragraphs if p.text and p.text.strip()]

    for section in document.sections:
        for header_footer in (section.header, section.footer):
            for p in header_footer.paragraphs:
                cleaned = _clean_text(p.text)
                if cleaned:
                    paras.append(cleaned)

    for table in document.tables:
        for row in table.rows:
            cells = [_clean_text(c.text) for c in row.cells if c.text and c.text.strip()]
            if cells:
                paras.append(" | ".join(cells))

    full = _clean_text("\n\n".join(paras))
    pages = [ParsedPage(page=None, text=full)] if full else []
    return full, pages, None


def parse_plain(data: bytes) -> tuple[str, list[ParsedPage], int | None]:
    text = ""
    for encoding in ("utf-8-sig", "utf-8", "utf-16", "utf-16-le", "cp1258", "cp1252", "latin-1"):
        try:
            candidate = _clean_text(data.decode(encoding))
        except UnicodeDecodeError:
            continue
        if candidate:
            text = candidate
            break
    pages = [ParsedPage(page=None, text=text)] if text else []
    return text, pages, None


def parse_image(data: bytes) -> tuple[str, list[ParsedPage], int | None]:
    text = _clean_text(image_to_text(data))
    pages = [ParsedPage(page=None, text=text)] if text else []
    return text, pages, None


def parse_xlsx(data: bytes) -> tuple[str, list[ParsedPage], int | None]:
    """Turn workbook sheets into readable text rows for RAG."""
    try:
        from openpyxl import load_workbook
    except ImportError as exc:
        raise ValueError(
            "XLSX support requires openpyxl. pip install openpyxl"
        ) from exc

    wb = load_workbook(BytesIO(data), read_only=True, data_only=True)
    pages: list[ParsedPage] = []
    parts: list[str] = []
    try:
        for sheet in wb.worksheets:
            rows_out: list[str] = []
            headers: list[str] = []
            for i, row in enumerate(sheet.iter_rows(values_only=True)):
                cells = [
                    _clean_text(str(c)) if c is not None else ""
                    for c in row
                ]
                # Drop fully empty rows
                if not any(cells):
                    continue
                if i == 0 and any(cells):
                    headers = cells
                    rows_out.append(" | ".join(h for h in headers if h))
                    continue
                if headers and len(headers) == len(cells):
                    pairs = [
                        f"{headers[j]}: {cells[j]}"
                        for j in range(len(cells))
                        if cells[j]
                    ]
                    if pairs:
                        rows_out.append(" · ".join(pairs))
                else:
                    rows_out.append(" | ".join(c for c in cells if c))
            body = _clean_text("\n".join(rows_out))
            if body:
                title = sheet.title or "Sheet"
                pages.append(ParsedPage(page=None, text=body))
                parts.append(f"[Sheet {title}]\n{body}")
    finally:
        wb.close()

    full = _clean_text("\n\n".join(parts))
    return full, pages, len(pages) or None


def parse_document(data: bytes, mime_type: str, filename: str) -> dict:
    name = (filename or "").lower()
    mime = (mime_type or "").lower()

    if mime == "application/pdf" or name.endswith(".pdf"):
        full, pages, page_count, parser = parse_pdf(data)
        kind = "pdf"
    elif (
        mime
        == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or name.endswith(".docx")
    ):
        full, pages, page_count = parse_docx(data)
        parser = "python-docx"
        kind = "docx"
    elif (
        mime
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        or name.endswith(".xlsx")
    ):
        full, pages, page_count = parse_xlsx(data)
        parser = "openpyxl"
        kind = "xlsx"
    elif mime in {"text/plain", "text/markdown", "text/x-markdown"} or name.endswith(
        (".txt", ".md", ".markdown")
    ):
        full, pages, page_count = parse_plain(data)
        parser = "plain"
        kind = "text"
    elif mime in IMAGE_MIME or name.endswith(
        (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff")
    ):
        full, pages, page_count = parse_image(data)
        parser = "ocr"
        kind = "image"
    else:
        raise ValueError(f"Unsupported mime/filename: {mime_type} / {filename}")

    if not full:
        if kind == "pdf":
            if not ocr_available():
                raise ValueError(
                    "PDF has no selectable text (likely scanned). "
                    "OCR is not ready — install Tesseract "
                    "(`brew install tesseract tesseract-lang`), restart the AI service, "
                    "then Reprocess. Or upload a text PDF/DOCX/TXT/MD."
                )
            raise ValueError(
                "No extractable text found even with OCR. "
                "Check scan quality/language, or upload a text PDF/DOCX/TXT/MD, then Reprocess."
            )
        if kind == "image":
            if not ocr_available():
                raise ValueError(
                    "OCR is not ready — install Tesseract "
                    "(`brew install tesseract tesseract-lang`), restart the AI service, "
                    "then Reprocess."
                )
            raise ValueError(
                "OCR found no text in this image. Check image quality/language, then Reprocess."
            )
        if kind == "docx":
            raise ValueError(
                "No extractable text found in DOCX (empty or image-only). "
                "Add text content or upload TXT/MD, then Reprocess."
            )
        if kind == "xlsx":
            raise ValueError(
                "No extractable cells found in XLSX (empty workbook). "
                "Add sheet data, then Reprocess."
            )
        raise ValueError(
            "No extractable text found in document. "
            "Check the file is not empty, then Reprocess."
        )

    return {
        "text": full,
        "page_count": page_count,
        "parser": parser,
        "pages": [{"page": p.page, "text": p.text} for p in pages],
    }
