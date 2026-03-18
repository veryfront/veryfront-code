---
title: "CLI-First Knowledge Ingestion"
description: "Turn uploads and local documents into project knowledge files with one command."
order: 20
---

# CLI-First Knowledge Ingestion

`veryfront knowledge ingest` is the primary CLI workflow for getting documents into a project's knowledge base.

Before this flow, agents often had to stitch together several low-level steps by hand:

1. Find an uploaded file
2. Download it into the workspace
3. Run parser code manually
4. Save the generated markdown back into the project

Now the happy path is one command:

```bash
veryfront knowledge ingest uploads/contracts/q1.pdf --json
```

That also works for an exact list of uploaded files:

```bash
veryfront knowledge ingest uploads/contracts/a.pdf uploads/contracts/b.pdf uploads/contracts/c.pdf --json
```

The command handles the orchestration for you:

- Resolves whether the input is a remote upload or a local file
- Pulls remote uploads into the workspace when needed
- Parses supported documents into markdown
- Writes the resulting `knowledge/*.md` file back into the project

## Why this matters

This flow is especially useful for agent workflows and demos:

- A user drops one or more files into `uploads/`
- A knowledge agent starts a sandbox
- The agent runs `veryfront knowledge ingest ...`
- The parsed markdown lands in the project's knowledge base

That keeps knowledge ingestion predictable, scriptable, and much easier to explain than ad-hoc parser scripts.

## Prerequisites

Authenticate with the CLI and make sure the target project is known:

```bash
export VERYFRONT_API_TOKEN=vf_your_api_key
export VERYFRONT_PROJECT_SLUG=my-project
```

Or log in interactively:

```bash
veryfront login
```

`veryfront knowledge ingest` requires `python3`.

Inside the Veryfront sandbox image, the embedded parser prefers `kreuzberg` for PDF, Office, and HTML extraction.

If you are running outside the Veryfront sandbox image and do not have `kreuzberg` installed, non-text formats fall back to the parser dependencies:

```bash
pip install pandas openpyxl xlrd pdfplumber python-docx python-pptx beautifulsoup4 lxml
```

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

Inside a sandbox, `/workspace/uploads/...` is also treated as a local file path:

```bash
veryfront knowledge ingest /workspace/uploads/contracts/q1.pdf --json
```

## Exact-file batch ingestion

To ingest a specific list of files without ingesting the entire folder:

```bash
veryfront knowledge ingest uploads/contracts/a.pdf uploads/contracts/b.pdf uploads/contracts/c.pdf --json
```

The command preserves input order in the JSON result array, so agent workflows can match each output back to the original source path.

## Batch ingestion

To ingest every supported file under a remote uploads prefix:

```bash
veryfront knowledge ingest --path uploads/contracts --all --json
```

To recurse through a local directory:

```bash
veryfront knowledge ingest --path ./contracts --all --recursive --json
```

Each source document becomes its own markdown file in the project knowledge tree.

Use `--path ... --all` only when you want everything under that uploads prefix or local directory. For an exact file list, pass the file paths as positional arguments instead.

## What the JSON output looks like

With `--json`, the command returns a machine-readable summary for each ingested file:

```json
[
  {
    "source": "uploads/demo/notes.txt",
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
]
```

This is useful for agent pipelines that want to confirm exactly what was created.

## Path rules

The source path determines how the command behaves:

- `uploads/...` means a remote project upload
- `./uploads/...` means a local file or directory relative to the current working directory
- `/workspace/uploads/...` means a local file inside the sandbox workspace
- multiple explicit sources are passed as positional arguments: `veryfront knowledge ingest <source...> --json`

That distinction matters because `uploads/...` triggers the remote upload download step, while local paths skip it.

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

## Low-level commands still exist

If you need finer control, the lower-level building blocks are still available:

```bash
veryfront uploads list
veryfront uploads pull uploads/contracts/q1.pdf --output /tmp/q1.pdf
veryfront files get knowledge/demo-notes.md
veryfront files put knowledge/demo-notes.md --from ./demo-notes.md
```

But for most agent-facing knowledge ingestion, `veryfront knowledge ingest` should be the default.

## Troubleshooting

### `Unknown command: knowledge`

Your installed CLI is older than the branch or release that added the command. Update the CLI or run the current source tree directly with:

```bash
cd veryfront-code
deno run -A cli/main.ts knowledge ingest uploads/contracts/q1.pdf --json
```

### `Missing API token`

Set `VERYFRONT_API_TOKEN`, run `veryfront login`, or make sure your local CLI config already has a saved token.

### `Could not determine project slug`

Set `VERYFRONT_PROJECT_SLUG` or pass the project explicitly:

```bash
veryfront knowledge ingest uploads/contracts/q1.pdf --project my-project --json
```

### Python package errors

Install the parser packages listed above, or run the command inside the Veryfront sandbox image where the knowledge-ingestion stack is already available.

### `kreuzberg` is not installed

Inside the sandbox image, `kreuzberg` is preinstalled. Outside the sandbox, the command falls back to the Python parser stack for supported formats, so install the parser packages above if you do not want to install `kreuzberg` locally.

## Recommended agent flow

For agent prompts and system instructions, this is the simplest reliable pattern:

1. Prefer `veryfront knowledge ingest` for adding documents to knowledge
2. Use `uploads/...` for files that came from the project's upload store
3. Use local paths only when the file is already present in the workspace
4. Fall back to `uploads` and `files` CRUD commands only when you need manual control

## Next

- [Sandbox](./sandbox.md) — run CLI workflows inside isolated workspaces
- [Agents](./agents.md) — build agent workflows that can call tools and shell commands
- [Workflows](./workflows.md) — orchestrate repeatable multi-step automation

## Related

- [`veryfront/cli`](../reference/cli.md) — CLI entry point reference
