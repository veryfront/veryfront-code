import type { CommandHelp } from "../../help/types.ts";

export const uploadsHelp: CommandHelp = {
  name: "uploads",
  description: "List, pull, upload, and delete project uploads",
  usage: "veryfront uploads <command> [options]",
  options: [
    {
      flag: "--project, -p <slug>",
      description: "Project slug override (otherwise inferred from env/config)",
    },
    {
      flag: "--path <prefix>",
      description: "Folder prefix to scope list/pull operations",
    },
    {
      flag: "--all",
      description: "Pull all file uploads under the given --path prefix",
    },
    {
      flag: "--from <path>",
      description: "Local file used by uploads put",
    },
    {
      flag: "--output-dir <dir>",
      description: "Directory to write downloaded uploads into",
      default: "./uploads",
    },
    {
      flag: "--json, -j",
      description: "Output machine-readable JSON",
    },
  ],
  examples: [
    "veryfront uploads list --json",
    "veryfront uploads pull contracts/q1.pdf --output-dir /workspace/uploads",
    "veryfront uploads put contracts/q1.pdf --from /workspace/uploads/q1.pdf",
    "veryfront uploads delete contracts/q1.pdf",
  ],
  notes: [
    "Subcommands: list, pull, put, delete",
    "Uses the project uploads store, not project source files",
    "`put` reuses the same upload path for create/update semantics",
  ],
};
