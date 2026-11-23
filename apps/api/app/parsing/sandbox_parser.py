"""Isolated document text extractor.

Run as a separate process (`python -I sandbox_parser.py <file> <mime>`) with a timeout and, on
Linux, CPU/memory limits. It never executes macros or embedded content: PDFs are read with pypdf
(text only), spreadsheets with openpyxl in read-only/data-only mode (formulas are not evaluated,
VBA is never loaded). Output is JSON on stdout. A crash or hang here cannot take down the API.
"""
import csv
import io
import json
import sys

MAX_CHARS = 60_000


def _limits():
    try:
        import resource  # Linux/macOS only

        resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CPU, (25, 25))
        resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))
    except Exception:  # nosec B110 - resource limits are best-effort (unsupported on Windows)
        pass


def pdf_text(path):
    from pypdf import PdfReader

    reader = PdfReader(path)
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            return {"text": "", "pages": 0, "error": "encrypted_pdf"}
    pages = len(reader.pages)
    if pages > 50:
        return {"text": "", "pages": pages, "error": "too_many_pages"}
    parts = []
    has_js = False
    try:
        root = reader.trailer["/Root"]
        has_js = "/OpenAction" in root or "/AA" in root or "/JavaScript" in str(root.get("/Names", ""))
    except Exception:  # nosec B110 - active-content probe is informational only
        pass
    for page in reader.pages:
        try:
            parts.append(page.extract_text() or "")
        except Exception:
            parts.append("")
        if sum(len(p) for p in parts) > MAX_CHARS:
            break
    return {"text": "\n".join(parts)[:MAX_CHARS], "pages": pages, "active_content": has_js}


def xlsx_text(path):
    from openpyxl import load_workbook

    wb = load_workbook(path, read_only=True, data_only=True, keep_vba=False, keep_links=False)
    lines = []
    for ws in wb.worksheets[:10]:
        lines.append(f"# Sheet: {ws.title}")
        for row in ws.iter_rows(max_row=500, values_only=True):
            cells = ["" if v is None else str(v) for v in row[:40]]
            if any(cells):
                lines.append("\t".join(cells))
            if sum(len(x) for x in lines) > MAX_CHARS:
                break
    return {"text": "\n".join(lines)[:MAX_CHARS], "pages": len(wb.worksheets)}


def csv_text(path):
    with open(path, encoding="utf-8", errors="replace") as fh:
        rows = list(csv.reader(io.StringIO(fh.read(MAX_CHARS))))
    return {"text": "\n".join("\t".join(r[:40]) for r in rows[:1000]), "pages": 1}


def main():
    _limits()
    path, mime = sys.argv[1], sys.argv[2]
    try:
        if mime == "application/pdf":
            out = pdf_text(path)
        elif mime.endswith("spreadsheetml.sheet"):
            out = xlsx_text(path)
        elif mime == "text/csv":
            out = csv_text(path)
        else:
            out = {"text": "", "pages": 1}
    except Exception as exc:  # report the class only; no document content in errors
        out = {"text": "", "pages": 0, "error": exc.__class__.__name__}
    sys.stdout.write(json.dumps(out))


if __name__ == "__main__":
    main()
