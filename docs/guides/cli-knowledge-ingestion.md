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

Studio knowledge-ingest runs write generated files to their admitted preview branch.
Main-branch runs keep writing to main. The destination comes from the signed run
target, not ingestion task configuration. Select main or a preview branch for
knowledge ingestion. Environment-target runs fail before ingestion starts.

## Select the destination branch

CLI ingestion writes to main when `--branch` is omitted. Select an existing
preview branch with `--branch` or `-b`:

```bash
veryfront knowledge ingest ./contracts/q1.pdf --project my-project --branch review-contracts --json
```

The branch must already exist. An unknown branch fails instead of falling back
to main. The selector applies to every generated file, including documents and
companions imported with `--okf-bundle`:

```bash
veryfront knowledge ingest --path ./bundle --all --okf-bundle --project my-project -b review-contracts --json
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

## Import an OKF bundle

Preserve an existing bundle rather than converting its documents:

```bash
veryfront knowledge ingest --path ./bundle --all --okf-bundle
```

Bundle mode requires an explicit root and `--all`; it does not accept positional
sources. Documents retain their metadata, Markdown, links and relative paths,
including files in hidden directories. Document envelopes are validated before
upload. A root index envelope declares only `okf_version`; nested indexes contain no frontmatter. Referenced resource, source, computation, executor and attester companions are preserved
with their relative paths, regardless of filename extension. Unreferenced viewer
artifacts are excluded. Companion references are resolved relative to the
referencing document when that file exists. Leading-slash references resolve
from the bundle root. For legacy bundles whose nested documents use root
bundle paths without a leading slash, bundle mode preserves the existing root
file when no document-relative file exists; this compatibility behavior is for
byte-preserving ingestion and does not rewrite OKF graph semantics. Project pull
manages supported text file extensions; other referenced companion extensions can
still require branch file retrieval until source sync supports that extension. Referenced Markdown companions preserve their bytes even when their contents resemble malformed
YAML frontmatter. Successfully parsed OKF type or version declarations and reserved index/log files
retain document validation and classification. Unreferenced Markdown remains subject to document
diagnostics.
IDs, labels and descriptions in companion objects remain metadata;
only their `path` and `resource` fields reference files. The same rules apply to a bundle under `uploads/...`.

Documents and companions must be valid UTF-8 because project file uploads store text. Invalid
binary content produces an explicit ingestion failure rather than a corrupted
file or a silent skip. Ordinary conversion retains its informational `source`
field and records standardized provenance only when a usable absolute HTTP(S)
source URL is available.

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
    "knowledge_path": "knowledge",
    "okf_bundle": false,
    "pending_acceptance": []
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

`metadata.okf_bundle` is `true` when you use `--okf-bundle`; otherwise it is
`false`. `metadata.pending_acceptance` lists acceptance checks that the command
does not verify. It is empty for ordinary ingestion. In bundle mode, it contains
`job_retry_idempotence`, `derived_link_index`, `provider_file_flow`, and
`full_okf_import_export_roundtrip`. A successful ingestion result does not prove
that those checks passed.

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

Next, use [Project knowledge](./project-knowledge.md) to search the generated
paths and frontmatter, retrieve an exact Markdown document, or index the files
for semantic retrieval.
