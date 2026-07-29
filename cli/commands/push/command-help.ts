import type { CommandHelp } from "../../help/types.ts";

export const pushHelp: CommandHelp = {
  name: "push",
  category: "deploy",
  description: "Push source to a cloud preview",
  usage: "veryfront push [options]",
  options: [
    {
      flag: "-d, --dir <path>",
      description: "Source directory (default: current directory)",
    },
    {
      flag: "-p, --project <slug>",
      description: "Project slug to push to (overrides inferred project)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Preview branch to update (default: main)",
    },
    {
      flag: "--dry-run",
      description: "Show what would be uploaded without uploading",
    },
    {
      flag: "--delete",
      description: "Delete remote files that are missing locally",
    },
    {
      flag: "-q, --quiet",
      description: "Suppress progress and summary output",
    },
  ],
  examples: [
    "veryfront push",
    "veryfront push --branch feature-header",
    "veryfront push --dry-run",
    "veryfront push --delete --dry-run",
  ],
  notes: [
    "Pushes main by default and prints its stable cloud preview URL",
    "Use --branch to create or update an isolated branch preview",
    "Preview branch names use lowercase letters, numbers, and hyphens",
    "By default, push uploads local files and preserves remote-only files",
    "Use --delete to remove remote files that are missing locally",
    "Run veryfront deploy when the preview is ready for an environment",
    ".vfignore excludes matching local files and preserves matching remote files",
    "--dry-run previews deletions only when --delete is present",
    "--dry-run never creates a project or branch, changes remote files, or writes a Push receipt",
  ],
};
