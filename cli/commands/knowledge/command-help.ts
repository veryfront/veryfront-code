import type { CommandHelp } from "../../help/types.ts";

export const knowledgeHelp: CommandHelp = {
  name: "knowledge",
  description: "Ingest documents into the project knowledge base",
  usage: "veryfront knowledge ingest <source> [options]",
  options: [
    {
      flag: "--project, -p <slug>",
      description: "Project slug override (otherwise inferred from env/config)",
    },
    {
      flag: "--path <prefix>",
      description: "Upload prefix or local directory used with --all",
    },
    {
      flag: "--all",
      description: "Ingest all files under the given --path prefix or directory",
    },
    {
      flag: "--recursive",
      description: "Recurse into subdirectories for local directory ingestion",
    },
    {
      flag: "--json, -j",
      description: "Output machine-readable JSON",
    },
  ],
  examples: [
    "veryfront knowledge ingest uploads/contracts/q1.pdf --json",
    "veryfront knowledge ingest /workspace/uploads/q1.pdf --json",
    "veryfront knowledge ingest --path uploads/ --all --json",
  ],
  notes: [
    "Primary subcommand: ingest",
    "`uploads/...` means a remote project upload; use `./uploads/...` or `/workspace/uploads/...` to force a local file",
    "`ingest` orchestrates upload resolution, parsing, and project file writes",
    "Requires python3; non-text formats also require the supported parser packages unless you run inside the Veryfront sandbox",
  ],
};
