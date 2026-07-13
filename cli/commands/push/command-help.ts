import type { CommandHelp } from "../../help/types.ts";

export const pushHelp: CommandHelp = {
  name: "push",
  category: "deploy",
  description: "Upload local source files to a Veryfront branch",
  usage: "veryfront push [options]",
  options: [
    {
      flag: "-d, --dir <path>",
      description: "Source directory (default: current directory)",
    },
    {
      flag: "-p, --project-slug <slug>",
      description: "Project slug to push to (overrides inferred project)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Branch name (default: cli/push-<timestamp>, use 'main' for direct push)",
    },
    {
      flag: "-f, --force",
      description: "Skip confirmation for compatibility (prefer global --yes)",
    },
    {
      flag: "--dry-run",
      description: "Show what would be uploaded without uploading",
    },
    {
      flag: "-q, --quiet",
      description: "Suppress progress and summary output",
    },
  ],
  examples: [
    "veryfront push",
    "veryfront push -p my-project",
    "veryfront push --dir ./my-project",
    "veryfront push --branch feature-header",
    "veryfront push --branch main             # Push directly to main",
    "veryfront push --branch main --yes       # Non-interactive CI push",
    "veryfront push --dry-run",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or veryfront.json config",
    "Without --branch, creates a timestamped branch that you can review in Studio",
    "Use --branch main to update the existing Veryfront main branch",
    "Uploads supported text source files using their relative paths",
    ".vfignore controls which supported files are excluded",
  ],
};
