export const knowledgeIngestPythonSource = String.raw`#!/usr/bin/env python3
import argparse
import csv
import json
import re
import subprocess
from datetime import date
from pathlib import Path
from typing import Any, Optional


def yaml_quote(value: Any) -> str:
    return json.dumps("" if value is None else str(value), ensure_ascii=False)


CODE_FENCE = chr(96) * 3
TEXT_FILE_EXTENSIONS = {
    ".c",
    ".cc",
    ".conf",
    ".cpp",
    ".cs",
    ".css",
    ".go",
    ".h",
    ".hpp",
    ".ini",
    ".java",
    ".js",
    ".jsonl",
    ".jsx",
    ".kt",
    ".less",
    ".lua",
    ".mjs",
    ".ndjson",
    ".php",
    ".pl",
    ".py",
    ".r",
    ".rb",
    ".rs",
    ".sass",
    ".scala",
    ".scss",
    ".sh",
    ".sql",
    ".swift",
    ".toml",
    ".ts",
    ".tsx",
    ".xml",
    ".yaml",
    ".yml",
    ".zsh",
}
TEXT_FILE_NAMES = {
    "dockerfile",
    "makefile",
    "readme",
    "license",
    "changelog",
}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "document"


def titleize_filename(path: Path) -> str:
    text = path.stem.replace("_", " ").replace("-", " ").strip()
    return text.title() or path.name


def clean_text(value: str) -> str:
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def table_to_markdown(rows: list[list[Any]]) -> str:
    if not rows:
        return ""

    normalized: list[list[str]] = []
    max_cols = 0
    for row in rows:
        normalized_row = [str(cell or "").replace("|", "\\|").replace("\n", " ").strip() for cell in row]
        max_cols = max(max_cols, len(normalized_row))
        normalized.append(normalized_row)

    if max_cols == 0:
        return ""

    for row in normalized:
        while len(row) < max_cols:
            row.append("")

    header = normalized[0]
    body = normalized[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * max_cols) + " |",
    ]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def build_frontmatter(source: str, source_type: str, description: str) -> str:
    return "\n".join([
        "---",
        f"source: {yaml_quote(source)}",
        f"source_type: {yaml_quote(source_type)}",
        f"added: {yaml_quote(date.today().isoformat())}",
        f"description: {yaml_quote(description)}",
        "---",
    ])


def metadata_int(metadata: dict[str, Any], *keys: str) -> Optional[int]:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def metadata_string_list(metadata: dict[str, Any], *keys: str) -> Optional[list[str]]:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, list) and all(isinstance(item, str) for item in value):
            return value
    return None


def build_kreuzberg_stats(source_type: str, content: str, metadata: dict[str, Any]):
    stats: dict[str, Any] = {
        "characters": len(content),
        "lines": len(content.splitlines()) if content else 0,
        "engine": "kreuzberg",
    }

    if isinstance(metadata.get("mime_type"), str):
        stats["mime_type"] = metadata["mime_type"]

    if source_type == "pdf":
        stats["pages"] = metadata_int(metadata, "page_count") or 0
        stats["tables"] = metadata_int(metadata, "table_count") or 0
    elif source_type in {"xlsx", "xls"}:
        stats["sheets"] = metadata_int(metadata, "sheet_count") or 0
        stats["rows"] = metadata_int(metadata, "row_count") or 0
        stats["sheet_names"] = metadata_string_list(metadata, "sheet_names") or []
    elif source_type == "docx":
        stats["paragraphs"] = metadata_int(metadata, "paragraph_count") or 0
        stats["tables"] = metadata_int(metadata, "table_count") or 0
    elif source_type == "pptx":
        stats["slides"] = metadata_int(metadata, "slide_count", "page_count") or 0
        stats["tables"] = metadata_int(metadata, "table_count") or 0
    elif source_type == "html":
        stats["tables"] = metadata_int(metadata, "table_count") or 0

    return stats


def parse_with_kreuzberg(path: str, source_type: str):
    warnings: list[str] = []
    completed = subprocess.run(
        [
            "kreuzberg",
            "extract",
            path,
            "--format",
            "json",
            "--output-format",
            "markdown",
        ],
        capture_output=True,
        text=True,
        check=False,
    )

    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or f"exit code {completed.returncode}"
        raise RuntimeError(f"kreuzberg extract failed: {detail}")

    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"kreuzberg extract returned invalid JSON: {error}") from error

    content = payload.get("content", "")
    if not isinstance(content, str):
        raise RuntimeError("kreuzberg extract did not return string content")

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    normalized_content = clean_text(content)
    stats = build_kreuzberg_stats(source_type, normalized_content, metadata)

    return normalized_content or "_No extractable text found in document._", stats, warnings


def prefer_kreuzberg(source_type: str, fallback_parser):
    def parser(path: str):
        try:
            return parse_with_kreuzberg(path, source_type)
        except FileNotFoundError as error:
            if getattr(error, "filename", "") == "kreuzberg":
                return fallback_parser(path)
            raise
        except RuntimeError as error:
            content, stats, warnings = fallback_parser(path)
            warnings.append(
                "kreuzberg extraction failed; fell back to the built-in parser: "
                + str(error)
            )
            return content, stats, warnings

    return parser


def parse_csv_like(path: str, delimiter: str = ","):
    warnings: list[str] = []
    with open(path, newline="", encoding="utf-8-sig") as file:
        reader = csv.reader(file, delimiter=delimiter)
        rows = list(reader)

    if not rows:
        return "_Empty file._", {"rows": 0, "columns": 0}, warnings

    header = rows[0]
    data = rows[1:]
    limited_rows = [header] + data[:200]
    parts = [
        f"**Rows:** {len(data)} | **Columns:** {len(header)}",
        "",
        table_to_markdown(limited_rows),
    ]
    if len(data) > 200:
        warnings.append(f"Truncated {len(data) - 200} rows from markdown output")
        parts.append(f"\n_...and {len(data) - 200} more rows (truncated)._")
    stats = {"rows": len(data), "columns": len(header)}
    return "\n".join(parts).strip(), stats, warnings


def parse_pdf(path: str):
    import pdfplumber

    warnings: list[str] = []
    sections: list[str] = []
    page_count = 0
    table_count = 0

    with pdfplumber.open(path) as pdf:
        for index, page in enumerate(pdf.pages, 1):
            page_count += 1
            text = (page.extract_text() or "").strip()
            tables = page.extract_tables() or []
            table_count += len(tables)

            parts = [f"## Page {index}"]
            if text:
                parts.append(text)

            for table_index, table in enumerate(tables, 1):
                if table:
                    parts.append(f"\n### Table {table_index}")
                    parts.append(table_to_markdown(table))

            sections.append("\n\n".join(parts).strip())

    content = "\n\n---\n\n".join(section for section in sections if section)
    stats = {"pages": page_count, "tables": table_count}
    return content or "_No extractable text found in PDF._", stats, warnings


def iter_docx_elements(document):
    from docx.oxml.ns import qn

    body = document.element.body
    for child in body:
        if child.tag == qn("w:p"):
            paragraph = next((p for p in document.paragraphs if p._element is child), None)
            if paragraph:
                yield {
                    "type": "paragraph",
                    "text": paragraph.text,
                    "style": paragraph.style.name if paragraph.style else None,
                }
        elif child.tag == qn("w:tbl"):
            table = next((t for t in document.tables if t._element is child), None)
            if table:
                rows = []
                for row in table.rows:
                    rows.append([cell.text.strip() for cell in row.cells])
                yield {"type": "table", "rows": rows}


def parse_docx(path: str):
    from docx import Document

    warnings: list[str] = []
    document = Document(path)
    parts: list[str] = []
    paragraph_count = 0
    table_count = 0

    for element in iter_docx_elements(document):
        if element["type"] == "paragraph":
            text = element["text"].strip()
            if not text:
                continue
            paragraph_count += 1
            style = element["style"] or ""
            if "Heading 1" in style:
                parts.append(f"# {text}")
            elif "Heading 2" in style:
                parts.append(f"## {text}")
            elif "Heading 3" in style:
                parts.append(f"### {text}")
            elif "List" in style:
                parts.append(f"- {text}")
            else:
                parts.append(text)
        elif element["type"] == "table":
            table_count += 1
            parts.append(table_to_markdown(element["rows"]))

    stats = {"paragraphs": paragraph_count, "tables": table_count}
    return "\n\n".join(part for part in parts if part).strip(), stats, warnings


def parse_excel(path: str):
    import pandas as pd

    warnings: list[str] = []
    workbook = pd.read_excel(path, sheet_name=None, dtype=str)
    parts: list[str] = []
    sheet_names: list[str] = []
    total_rows = 0

    for sheet_name, frame in workbook.items():
        sheet_names.append(sheet_name)
        frame = frame.fillna("")
        rows = frame.values.tolist()
        header = [str(column) for column in frame.columns.tolist()]
        total_rows += len(rows)
        parts.append(f"## Sheet: {sheet_name}")
        parts.append(f"**Rows:** {len(rows)} | **Columns:** {len(header)}")
        limited_rows = [header] + rows[:200]
        parts.append(table_to_markdown(limited_rows))
        if len(rows) > 200:
            warnings.append(f"Truncated {len(rows) - 200} rows from sheet {sheet_name}")
            parts.append(f"_...and {len(rows) - 200} more rows (truncated)._")

    stats = {"sheets": len(sheet_names), "rows": total_rows, "sheet_names": sheet_names}
    return "\n\n".join(part for part in parts if part).strip(), stats, warnings


def parse_pptx(path: str):
    from pptx import Presentation

    warnings: list[str] = []
    presentation = Presentation(path)
    parts: list[str] = []
    slide_count = 0
    table_count = 0

    for index, slide in enumerate(presentation.slides, 1):
        slide_count += 1
        texts: list[str] = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                for paragraph in shape.text_frame.paragraphs:
                    text = paragraph.text.strip()
                    if text:
                        texts.append(text)
            if getattr(shape, "has_table", False):
                table_count += 1
                rows = []
                for row in shape.table.rows:
                    rows.append([cell.text.strip() for cell in row.cells])
                texts.append(table_to_markdown(rows))
        if texts:
            parts.append(f"## Slide {index}")
            parts.append("\n\n".join(texts))

    stats = {"slides": slide_count, "tables": table_count}
    return "\n\n".join(parts).strip(), stats, warnings


def parse_html(path: str):
    from bs4 import BeautifulSoup

    warnings: list[str] = []
    with open(path, encoding="utf-8") as file:
        soup = BeautifulSoup(file.read(), "lxml")

    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    table_parts: list[str] = []
    for table_index, table in enumerate(soup.find_all("table"), 1):
        rows = []
        for row in table.find_all("tr"):
            rows.append([cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])])
        if rows:
            table_parts.append(f"### Table {table_index}")
            table_parts.append(table_to_markdown(rows))
        table.decompose()

    text = clean_text(soup.get_text("\n"))
    parts = [text] if text else []
    if table_parts:
        parts.extend(table_parts)

    stats = {"tables": len(table_parts) // 2, "characters": len(text)}
    return "\n\n".join(part for part in parts if part).strip(), stats, warnings


def parse_text(path: str):
    warnings: list[str] = []
    with open(path, encoding="utf-8") as file:
        text = clean_text(file.read())
    stats = {"characters": len(text), "lines": len(text.splitlines()) if text else 0}
    return text, stats, warnings


def parse_json(path: str):
    warnings: list[str] = []
    with open(path, encoding="utf-8") as file:
        data = json.load(file)

    if isinstance(data, list) and data and isinstance(data[0], dict):
        headers = list(data[0].keys())
        rows = [headers] + [[row.get(header, "") for header in headers] for row in data[:200]]
        content_parts = [
            f"**Records:** {len(data)} | **Fields:** {len(headers)}",
            "",
            table_to_markdown(rows),
        ]
        if len(data) > 200:
            warnings.append(f"Truncated {len(data) - 200} records from markdown output")
            content_parts.append(f"\n_...and {len(data) - 200} more records (truncated)._")
        stats = {"records": len(data), "fields": len(headers)}
        return "\n".join(content_parts).strip(), stats, warnings

    rendered = json.dumps(data, indent=2, ensure_ascii=False)
    stats = {"top_level_type": type(data).__name__}
    return f"{CODE_FENCE}json\n{rendered}\n{CODE_FENCE}", stats, warnings


def select_parser(path: Path):
    ext = path.suffix.lower()
    name = path.name.lower()
    if ext == ".pdf":
        return "pdf", prefer_kreuzberg("pdf", parse_pdf)
    if ext in {".csv", ".tsv"}:
        delimiter = "\t" if ext == ".tsv" else ","
        return ext.lstrip("."), lambda file_path: parse_csv_like(file_path, delimiter)
    if ext in {".xlsx", ".xls"}:
        source_type = ext.lstrip(".")
        return source_type, prefer_kreuzberg(source_type, parse_excel)
    if ext == ".docx":
        return "docx", prefer_kreuzberg("docx", parse_docx)
    if ext == ".pptx":
        return "pptx", prefer_kreuzberg("pptx", parse_pptx)
    if ext in {".html", ".htm"}:
        return "html", prefer_kreuzberg("html", parse_html)
    if ext in {".txt", ".md", ".mdx"}:
        return ext.lstrip("."), parse_text
    if ext == ".json":
        return "json", parse_json
    if ext in TEXT_FILE_EXTENSIONS:
        return ext.lstrip("."), parse_text
    if not ext and name in TEXT_FILE_NAMES:
        return "text", parse_text
    raise ValueError(f"Unsupported file type: {ext}")


def build_summary(source_type: str, stats: dict[str, Any]) -> str:
    if stats.get("engine") == "kreuzberg":
        return f"Converted {source_type.upper()} to markdown ({stats.get('characters', 0)} chars)."
    if source_type in {"csv", "tsv"}:
        return f"Parsed {stats.get('rows', 0)} rows across {stats.get('columns', 0)} columns."
    if source_type in {"xlsx", "xls"}:
        return f"Parsed {stats.get('sheets', 0)} sheet(s) with {stats.get('rows', 0)} total rows."
    if source_type == "pdf":
        return f"Extracted {stats.get('pages', 0)} page(s) and {stats.get('tables', 0)} table(s)."
    if source_type == "docx":
        return f"Extracted {stats.get('paragraphs', 0)} paragraphs and {stats.get('tables', 0)} tables."
    if source_type == "pptx":
        return f"Extracted {stats.get('slides', 0)} slide(s)."
    if source_type == "json":
        if "records" in stats:
            return f"Parsed {stats.get('records', 0)} record(s) across {stats.get('fields', 0)} fields."
        return f"Converted JSON ({stats.get('top_level_type', 'object')}) to markdown."
    if source_type == "html":
        return f"Converted HTML with {stats.get('tables', 0)} table(s) to markdown."
    return f"Converted document to markdown ({stats.get('characters', 0)} chars)."


def ingest_document_to_knowledge(file_path: str, output_dir: Optional[str] = None, description: Optional[str] = None, slug: Optional[str] = None, source_reference: Optional[str] = None):
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    output_root = Path(output_dir or "/workspace/knowledge")
    output_root.mkdir(parents=True, exist_ok=True)

    if not slug:
        slug = slugify(path.stem)

    source_type, parser = select_parser(path)
    content, stats, warnings = parser(str(path))
    content = clean_text(content)

    resolved_description = description or f"Parsed from {path.name}"
    title = titleize_filename(path)
    frontmatter = build_frontmatter(source_reference or path.name, source_type, resolved_description)
    markdown = f"{frontmatter}\n\n# {title}\n\n{content}\n"

    output_path = output_root / f"{slug}.md"
    output_path.write_text(markdown, encoding="utf-8")

    return {
        "success": True,
        "source_path": str(path),
        "source_filename": path.name,
        "source_type": source_type,
        "slug": slug,
        "sandbox_output_path": str(output_path),
        "suggested_project_path": f"knowledge/{slug}.md",
        "description": resolved_description,
        "title": title,
        "summary": build_summary(source_type, stats),
        "stats": stats,
        "warnings": warnings,
    }


def main():
    parser = argparse.ArgumentParser(description="Convert a local document into knowledge-base markdown")
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--output-json", required=True)
    args = parser.parse_args()

    try:
        payload = json.loads(Path(args.input_json).read_text(encoding="utf-8"))
        result = ingest_document_to_knowledge(
            file_path=payload["file_path"],
            output_dir=payload.get("output_dir"),
            description=payload.get("description"),
            slug=payload.get("slug"),
            source_reference=payload.get("source_reference"),
        )
    except ModuleNotFoundError as error:
        missing_package = error.name or "required package"
        raise SystemExit(
            "Missing Python package '"
            + missing_package
            + "'. Install knowledge parser dependencies with: "
            + "pip install pandas openpyxl xlrd pdfplumber python-docx python-pptx beautifulsoup4 lxml"
        )

    Path(args.output_json).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
`;
