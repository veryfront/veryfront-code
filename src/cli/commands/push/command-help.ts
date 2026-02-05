import type { CommandHelp } from "../../help/types.ts";

export const pushHelp: CommandHelp = {
  name: "push",
  description: "Create a branch and upload local files to Veryfront",
  usage: "veryfront push [options]",
  options: [
    {
      flag: "-d, --dir <path>",
      description: "Source directory (default: current directory)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Branch name (default: cli/push-<timestamp>, use 'main' for direct push)",
    },
    {
      flag: "-f, --force",
      description: "Push without confirmation",
    },
    {
      flag: "--dry-run",
      description: "Show what would be uploaded without uploading",
    },
  ],
  examples: [
    "veryfront push",
    "veryfront push --dir ./my-project",
    "veryfront push --branch feature-header",
    "veryfront push --branch main             # Push directly to main",
    "veryfront push --dry-run",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
    "Creates a new branch for each push - merge in Studio",
    "Use --branch=main to push directly without creating a branch",
    "Uploads all files using their relative paths",
  ],
};
