from __future__ import annotations

import logging
import os
import re
import shutil
from io import BytesIO

from app.config import settings

logger = logging.getLogger(__name__)

# Multiple PSM passes; pick the cleanest result.
_OCR_PASSES = (
    "--oem 3 --psm 6 -c preserve_interword_spaces=1",  # uniform block
    "--oem 3 --psm 4 -c preserve_interword_spaces=1",  # single column
    "--oem 3 --psm 3 -c preserve_interword_spaces=1",  # fully automatic
)

# Frequent Vietnamese / medical OCR fixes (scan artifacts → đúng từ).
_OCR_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bV[eệ]sinh\b", re.I), "Vệ sinh"),
    (re.compile(r"\bvesinh\b", re.I), "vệ sinh"),
    (re.compile(r"\bkh[aả]u\s*trang\b", re.I), "khẩu trang"),
    (re.compile(r"\bgăng\s*tay\b", re.I), "găng tay"),
    (re.compile(r"\bb[eệ]nh\s*nh[aâ]n\b", re.I), "bệnh nhân"),
    (re.compile(r"\bngười\s*b[eệ]nh\b", re.I), "người bệnh"),
    (re.compile(r"\bH[OÔ]?\s*C[AÁ]\s*NH[AÂ]N\b", re.I), "HỘ CÁ NHÂN"),
    (re.compile(r"\bJONG\s*TIEN\b", re.I), "PHÒNG TIỆN"),
    (re.compile(r"\bPHONG\s*TIEN\b", re.I), "PHÒNG TIỆN"),
    (re.compile(r"\bTIEN\s*PHONG\b", re.I), "TIỆN PHÒNG"),
    (re.compile(r"\br[uủ]a\s*tay\b", re.I), "rửa tay"),
    (re.compile(r"\bkh[uử]tr[uủ]ng\b", re.I), "khử trùng"),
    (re.compile(r"\bti[eê]m\s*ch[uủ]ng\b", re.I), "tiêm chủng"),
    (re.compile(r"[ \t]{2,}"), " "),
    (re.compile(r"\n{3,}"), "\n\n"),
]


def _configure_tesseract() -> None:
    """Point pytesseract at a Homebrew binary when PATH is thin (e.g. IDE launches)."""
    import pytesseract

    current = getattr(pytesseract.pytesseract, "tesseract_cmd", None) or "tesseract"
    if shutil.which(current if current != "tesseract" else "tesseract"):
        return
    for candidate in (
        "/opt/homebrew/bin/tesseract",
        "/usr/local/bin/tesseract",
        "/usr/bin/tesseract",
    ):
        if shutil.which(candidate) or os.path.isfile(candidate):
            pytesseract.pytesseract.tesseract_cmd = candidate
            return


def ocr_available() -> bool:
    if not settings.ocr_enabled:
        return False
    try:
        import pytesseract
        from PIL import Image  # noqa: F401

        _configure_tesseract()
        pytesseract.get_tesseract_version()
        return True
    except Exception:  # noqa: BLE001
        return False


def _tesseract_lang(lang: str | None = None) -> str:
    # Prefer Vietnamese first for mixed Vi/En medical docs.
    requested = (lang or settings.ocr_lang or "vie+eng").strip()
    # Normalize eng+vie → vie+eng
    parts = [p for p in requested.replace(" ", "").split("+") if p]
    if "vie" in parts and "eng" in parts:
        parts = ["vie", "eng"] + [p for p in parts if p not in {"vie", "eng"}]
    try:
        import pytesseract

        _configure_tesseract()
        available = set(pytesseract.get_languages(config=""))
    except Exception:  # noqa: BLE001
        return "+".join(parts) if parts else "eng"

    kept = [p for p in parts if p in available]
    if kept:
        return "+".join(kept)
    if "vie" in available:
        return "vie"
    if "eng" in available:
        return "eng"
    return requested


def _resample():  # type: ignore[no-untyped-def]
    from PIL import Image as PILImage

    return getattr(getattr(PILImage, "Resampling", PILImage), "LANCZOS", PILImage.LANCZOS)


def _preprocess_variants(image):  # type: ignore[no-untyped-def]
    """Produce a few cleaned variants; OCR often works better on one of them."""
    from PIL import ImageEnhance, ImageFilter, ImageOps

    base = ImageOps.exif_transpose(image).convert("L")
    # Target ~2000px on short side for dense scanned pages
    min_side = min(base.size)
    if min_side < 2000:
        scale = 2000 / max(min_side, 1)
        # Cap extreme upscales for huge pages
        scale = min(scale, 3.0)
        base = base.resize(
            (max(1, int(base.width * scale)), max(1, int(base.height * scale))),
            resample=_resample(),
        )

    # Soft denoise then contrast
    soft = base.filter(ImageFilter.MedianFilter(size=3))
    soft = ImageOps.autocontrast(soft, cutoff=2)
    soft = ImageEnhance.Contrast(soft).enhance(1.45)
    soft = ImageEnhance.Sharpness(soft).enhance(1.35)

    # Binarized (helps faded ink / grey scans)
    binary = ImageOps.autocontrast(base, cutoff=1)
    binary = binary.point(lambda x: 255 if x > 160 else 0, mode="1").convert("L")
    binary = binary.filter(ImageFilter.MedianFilter(size=3))

    # Inverted if page looks dark-dominant (white text on dark)
    hist = base.histogram()
    dark = sum(hist[:96])
    light = sum(hist[160:])
    variants = [soft, binary]
    if dark > light * 1.2:
        variants.append(ImageOps.invert(soft))
    return variants


_KEYBOARD_NOISE = re.compile(
    r"(?i)\b(?:q\s*w\s*e\s*r\s*t\s*y|a\s*s\s*d\s*f|z\s*x\s*c\s*v|lock)\b"
)
_SPACED_LETTERS = re.compile(r"(?:(?<=\s)|^)(?:[A-Za-z]\s+){3,}[A-Za-z](?=\s|$)")
_SYMBOL_SOUP = re.compile(r"[£ˆ`´™®©¬¦|\\]{1,}")


def is_ocr_junk_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    letters = sum(
        ch.isalnum() or ("\u00c0" <= ch <= "\u024f") or ("\u1ea0" <= ch <= "\u1ef9")
        for ch in s
    )
    if letters < max(2, len(s) // 4):
        return True
    if _KEYBOARD_NOISE.search(s):
        return True
    # Many single letters separated by spaces → keyboard OCR trash
    tokens = s.split()
    if len(tokens) >= 4 and sum(1 for t in tokens if len(t) == 1) >= len(tokens) * 0.6:
        return True
    # Too few Vietnamese/Latin words vs punctuation
    words = re.findall(
        r"[A-Za-zÀ-ỹĐđ]{2,}",
        s,
    )
    if len(s) > 20 and len(words) <= 1 and not re.search(r"\d{1,2}[\.)]", s):
        return True
    return False


def clean_ocr_text(text: str) -> str:
    """Public cleaner used by OCR pipeline and mock/RAG display."""
    return _postprocess_text(text)


def _postprocess_text(text: str) -> str:
    text = text.replace("\x00", " ").replace("\r\n", "\n").replace("\r", "\n")
    text = _SYMBOL_SOUP.sub(" ", text)
    text = _SPACED_LETTERS.sub(" ", text)
    lines: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if not s:
            lines.append("")
            continue
        if is_ocr_junk_line(s):
            continue
        lines.append(s)
    text = "\n".join(lines)
    for pattern, repl in _OCR_FIXES:
        text = pattern.sub(repl, text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _score_ocr(text: str) -> float:
    if not text:
        return -1.0
    # Prefer more Vietnamese letters + words, fewer weird symbols
    vi = len(re.findall(r"[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđĐ]", text))
    words = len(re.findall(r"\w+", text, flags=re.UNICODE))
    junk = len(re.findall(r"[^\w\s.,;:!?()\[\]/%+\-–—\"'“”àáạảãăâèéêìíòóôơùúưỳýđĐÀÁẠẢÃĂÂÈÉÊÌÍÒÓÔƠÙÚƯỲÝ]", text))
    return words * 1.0 + vi * 2.0 - junk * 0.8 + min(len(text), 4000) * 0.01


def _ocr_image_variants(image, *, lang: str | None = None) -> str:  # type: ignore[no-untyped-def]
    import pytesseract

    _configure_tesseract()
    tess_lang = _tesseract_lang(lang)
    best_text = ""
    best_score = -1.0

    for prepared in _preprocess_variants(image):
        for config in _OCR_PASSES:
            try:
                # Confidence-aware path when possible
                data = pytesseract.image_to_data(
                    prepared,
                    lang=tess_lang,
                    config=config,
                    output_type=pytesseract.Output.DICT,
                )
                words: list[str] = []
                confs: list[float] = []
                n = len(data.get("text") or [])
                for i in range(n):
                    w = (data["text"][i] or "").strip()
                    try:
                        conf = float(data["conf"][i])
                    except Exception:  # noqa: BLE001
                        conf = -1.0
                    if not w or conf < 45:
                        continue
                    words.append(w)
                    confs.append(conf)
                if words:
                    # Reconstruct roughly by lines using block/line numbers
                    lines: dict[tuple[int, int], list[str]] = {}
                    for i in range(n):
                        w = (data["text"][i] or "").strip()
                        try:
                            conf = float(data["conf"][i])
                        except Exception:  # noqa: BLE001
                            conf = -1.0
                        if not w or conf < 45:
                            continue
                        key = (int(data["block_num"][i]), int(data["line_num"][i]))
                        lines.setdefault(key, []).append(w)
                    text = "\n".join(" ".join(parts) for _, parts in sorted(lines.items()))
                    avg_conf = sum(confs) / max(len(confs), 1)
                    score = _score_ocr(text) + avg_conf * 0.5
                else:
                    text = pytesseract.image_to_string(
                        prepared, lang=tess_lang, config=config
                    ) or ""
                    score = _score_ocr(text)
            except Exception:  # noqa: BLE001
                text = (
                    pytesseract.image_to_string(
                        prepared, lang=tess_lang, config=config
                    )
                    or ""
                )
                score = _score_ocr(text)

            text = _postprocess_text(text)
            score = _score_ocr(text)
            if score > best_score:
                best_score = score
                best_text = text

    return best_text


def _run_tesseract(image, *, lang: str | None = None) -> str:  # type: ignore[no-untyped-def]
    return _ocr_image_variants(image, lang=lang)


def image_to_text(data: bytes, *, lang: str | None = None) -> str:
    """OCR a raster image (PNG/JPEG/WEBP/TIFF) to plain text."""
    if not settings.ocr_enabled:
        raise ValueError("OCR is disabled")

    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise ValueError(
            "OCR dependencies missing. Install pillow and pytesseract, "
            "and ensure the Tesseract binary is on PATH."
        ) from exc

    _configure_tesseract()
    try:
        pytesseract.get_tesseract_version()
    except Exception as exc:  # noqa: BLE001
        raise ValueError(
            "Tesseract binary not found. On macOS: brew install tesseract tesseract-lang"
        ) from exc

    image = Image.open(BytesIO(data))
    return _run_tesseract(image, lang=lang)


def pdf_page_ocr_text(page, *, dpi: int | None = None) -> str:  # type: ignore[no-untyped-def]
    """OCR a PyMuPDF page when native text extract is empty or sparse."""
    if not settings.ocr_enabled:
        return ""

    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        logger.warning("OCR skipped: pillow/pytesseract not installed")
        return ""

    _configure_tesseract()
    try:
        pytesseract.get_tesseract_version()
    except Exception:  # noqa: BLE001
        logger.warning(
            "OCR skipped: Tesseract binary missing (brew install tesseract tesseract-lang)"
        )
        return ""

    render_dpi = dpi or settings.ocr_dpi
    try:
        pix = page.get_pixmap(dpi=render_dpi, alpha=False)
        mode = "RGB" if pix.n >= 3 else "L"
        img = Image.frombytes(mode, [pix.width, pix.height], pix.samples)
        if img.mode != "RGB" and pix.n >= 3:
            img = img.convert("RGB")
        return _run_tesseract(img)
    except Exception as exc:  # noqa: BLE001
        logger.warning("PDF page OCR failed: %s", exc)
        return ""
