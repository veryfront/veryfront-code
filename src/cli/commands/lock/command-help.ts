import type { CommandHelp } from "../../help/types.ts";

export const lockHelp: CommandHelp = {
  name: "lock",
  description: "Manage remote import lockfile for reproducible builds",
  usage: "veryfront lock [options]",
  options: [
    {
      flag: "-l, --list",
      description: "List all locked imports",
    },
    {
      flag: "-u, --update",
      description: "Update all locked imports to latest versions",
    },
    {
      flag: "--verify",
      description: "Verify integrity of locked imports",
    },
    {
      flag: "--clear",
      description: "Clear the lockfile",
    },
    {
      flag: "-f, --force",
      description: "Skip confirmation prompts",
    },
  ],
  examples: [
    "veryfront lock                # List locked imports",
    "veryfront lock --list",
    "veryfront lock --verify       # Check integrity",
    "veryfront lock --update       # Refresh all entries",
    "veryfront lock --clear        # Remove lockfile",
  ],
  notes: [
    "The lockfile (veryfront.lock) is created automatically during 'veryfront dev'",
    "Remote imports from esm.sh are locked with URL and integrity hash",
    "Commit veryfront.lock to version control for reproducible builds",
  ],
};
