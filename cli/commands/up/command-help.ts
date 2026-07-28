import type { CommandHelp } from "../../help/types.ts";

export const upHelp: CommandHelp = {
  name: "up",
  category: "deploy",
  description: "Create and publish the initial cloud preview",
  usage: "veryfront up [options]",
  options: [
    {
      flag: "-f, --force",
      description: "Accept the inferred project name",
    },
    {
      flag: "--dry-run",
      description: "Preview without executing",
    },
  ],
  examples: ["veryfront up", "veryfront up --dry-run", "veryfront up --force"],
  notes: [
    "Links or creates the project, pushes main, and provisions its preview",
    "Use veryfront push for subsequent preview updates",
    "Run veryfront deploy when the preview is ready for production",
  ],
};
