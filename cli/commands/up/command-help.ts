import type { CommandHelp } from "../../help/types.ts";

export const upHelp: CommandHelp = {
  name: "up",
  description: "Deploy your app with one command (login, create, push, deploy)",
  usage: "veryfront up [options]",
  options: [
    {
      flag: "-f, --force",
      description: "Skip interactive prompts",
    },
    {
      flag: "--dry-run",
      description: "Preview without executing",
    },
  ],
  examples: ["veryfront up", "veryfront up --dry-run", "veryfront up --force"],
  notes: [
    "This is the default command when running 'veryfront' without arguments",
    "Automatically handles: authentication, project creation, push, and deploy",
    "Opens browser for login if not authenticated",
    "Creates a new project if code exists but no veryfront.json",
  ],
};
