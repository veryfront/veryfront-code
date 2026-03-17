import type { CommandHelp } from "../../help/types.ts";

export const filesHelp: CommandHelp = {
  name: "files",
  description: "List, read, write, and delete project files",
  usage: "veryfront files <command> [options]",
  options: [
    {
      flag: "--project, -p <slug>",
      description: "Project slug override (otherwise inferred from env/config)",
    },
    {
      flag: "--path <prefix>",
      description: "Prefix filter for files list",
    },
    {
      flag: "--from <path>",
      description: "Local file to upload with files put",
    },
    {
      flag: "--output, -o <path>",
      description: "Write files get output to a local file instead of stdout",
    },
    {
      flag: "--json, -j",
      description: "Output machine-readable JSON",
    },
  ],
  examples: [
    "veryfront files list --path knowledge/ --json",
    "veryfront files get knowledge/q1-report.md",
    "veryfront files put knowledge/q1-report.md --from /workspace/knowledge/q1-report.md",
    "veryfront files delete knowledge/q1-report.md",
  ],
  notes: [
    "Subcommands: list, get, put, delete",
    "Uses the project files API, not the uploads store",
    "Designed for precise sandbox writes where `veryfront push` would be too broad",
  ],
};
