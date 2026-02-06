import type { CommandHelp } from "../../help/types.ts";

export const mergeHelp: CommandHelp = {
  name: "merge",
  description: "Merge a branch into main (or another branch)",
  usage: "veryfront merge <branch> [options]",
  options: [
    {
      flag: "--into <branch>",
      description: "Target branch to merge into (default: main)",
    },
    {
      flag: "-f, --force",
      description: "Merge without confirmation",
    },
    {
      flag: "--dry-run",
      description: "Preview merge without executing",
    },
  ],
  examples: [
    "veryfront merge feature-login",
    "veryfront merge hotfix --into staging",
    "veryfront merge feature-header --dry-run",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or .veryfrontrc config",
    "Use --dry-run to preview which files would be merged",
    "Conflicts are reported but must be resolved in Studio",
  ],
};
