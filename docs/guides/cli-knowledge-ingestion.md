---
title: "CLI-first knowledge ingestion"
description: "Turn uploads and local documents into project knowledge files with one command."
order: 37
---

`veryfront knowledge ingest` is the primary CLI workflow for getting documents
into a project's knowledge base. It finds a source file, parses it, and writes
generated markdown back into the project.

Ingest one uploaded file:

```bash
veryfront knowledge ingest uploads/contracts/q1.pdf --json
```

Ingest an exact list of uploaded files:

```bash
veryfront knowledge ingest uploads/contracts/a.pdf uploads/contracts/b.pdf uploads/contracts/c.pdf --json
```

## Prerequisites

Authenticate with the CLI and set the target project:

```bash
export VERYFRONT_API_TOKEN=<TOKEN>
export VERYFRONT_PROJECT_SLUG=my-project
```

Or log in interactively:

```bash
veryfront login
```

`veryfront knowledge ingest` parses PDF, Office, EPUB, HTML, and RTF sources
through the built-in Kreuzberg document extension. Plain text, Markdown, JSON,
CSV, TSV, and common code files are converted directly by the CLI.

## Single-file examples

### Ingest a remote upload

Use `uploads/...` to reference a file from the project's remote uploads store:

```bash
veryfront knowledge ingest uploads/contracts/q1.pdf --json
```

### Ingest a local file

Use a local path to ingest a file that already exists on disk:

```bash
veryfront knowledge ingest ./contracts/q1.pdf --json
```

Inside a sandbox, use a local relative path when the upload is already present
in the workspace:

```bash
veryfront knowledge ingest ./uploads/contracts/q1.pdf --json
```

## Exact-file batch ingestion

To ingest a specific list of files without ingesting the entire folder:

```bash
veryfront knowledge ingest uploads/contracts/a.pdf uploads/contracts/b.pdf uploads/contracts/c.pdf --json
```

The command preserves input order in the JSON `ingested` array. Agent workflows
can match each output back to the original source path.

## Batch ingestion

To ingest every supported file under a remote uploads prefix:

```bash
veryfront knowledge ingest --path uploads/contracts --all --json
```

To recurse through a local directory:

```bash
veryfront knowledge ingest --path ./contracts --all --recursive --json
```

Each source document becomes its own markdown file in the project knowledge
tree.

Use `--path ... --all` only when you want everything under that uploads prefix
or local directory. For an exact file list, pass the file paths as positional
arguments instead.

## What the JSON output looks like

With `--json`, the command returns a machine-readable run result with
`ingested`, `skipped`, and `failed` arrays:

```json
{
  "kind": "knowledge_ingest",
  "version": 1,
  "metadata": {
    "requested_count": 1,
    "source_mode": "explicit_sources",
    "knowledge_path": "knowledge"
  },
  "summary": {
    "requested_count": 1,
    "ingested_count": 1,
    "skipped_count": 0,
    "failed_count": 0
  },
  "ingested": [
    {
      "source": "uploads/demo/notes.txt",
      "localSourcePath": "<LOCAL_SOURCE_PATH>",
      "outputPath": "<OUTPUT_PATH>",
      "remotePath": "knowledge/demo-notes.md",
      "slug": "demo-notes",
      "sourceType": "txt",
      "summary": "Converted document to markdown (87 chars).",
      "stats": {
        "characters": 87,
        "lines": 3
      },
      "warnings": []
    }
  ],
  "skipped": [],
  "failed": []
}
```

The exact `stats` shape varies by source type, but the top-level result fields
are stable.

## Path rules

The source path determines how the command behaves:

- `uploads/...` means a remote project upload
- `./uploads/...` means a local file or directory relative to the current
  working directory
- multiple explicit sources are passed as positional arguments:
  `veryfront knowledge ingest <source...> --json`

That distinction matters because `uploads/...` triggers the remote upload
download step, while local paths skip it.

## Supported file types

`veryfront knowledge ingest` supports these source formats:

- `pdf`
- `csv`
- `tsv`
- `docx`
- `xlsx`
- `xls`
- `pptx`
- `html`
- `htm`
- `txt`
- `json`
- `md`
- `mdx`

## Troubleshooting

### `Unknown command: knowledge`

Your installed CLI is older than the branch or release that added the command.
Update the CLI or run the current source tree directly with:

```bash
cd veryfront-code
deno run -A cli/main.ts knowledge ingest uploads/contracts/q1.pdf --json
```

### `Missing API token`

Set `VERYFRONT_API_TOKEN`, run `veryfront login`, or use a local CLI config with
a saved token.

### `Could not determine project slug`

Set `VERYFRONT_PROJECT_SLUG` or pass the project explicitly:

```bash
veryfront knowledge ingest uploads/contracts/q1.pdf --project my-project --json
```

### Document extraction errors

Use a supported document type and ensure the source file is readable. Rich
document formats use the built-in Kreuzberg extension, while text-like formats
are converted directly by the CLI.

## Verify it worked

After ingesting a source, the command writes one or more markdown files under
the project's `knowledge/` directory:

```bash
ls knowledge/
```

A working ingestion lists the new `knowledge/<name>.md` entry. Open the
generated markdown and confirm the parsed content matches the original.

For automation, capture the JSON output of the command directly:

```bash
veryfront knowledge ingest uploads/sample.pdf --json | jq '.ingested'
```

The `ingested` array names every file the command wrote. If the array is empty
or the command exited non-zero, check `skipped`, `failed`, and the command
output for the reason.
