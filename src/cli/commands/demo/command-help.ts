import type { CommandHelp } from "../../help/types.ts";

export const demoHelp: CommandHelp = {
  name: "demo",
  description: "Interactive guided tour of Veryfront CLI",
  usage: "veryfront demo [project-name] [options]",
  options: [
    { flag: "--auto", description: "Auto-advance through steps after 3 seconds" },
    {
      flag: "--login <method>",
      description: "Pre-select login method (google, github, microsoft, token)",
    },
  ],
  examples: [
    "veryfront demo                                 # Uses unique 'demo-{random}' name",
    "veryfront demo my-first-app                   # Specify project name",
    "veryfront demo --auto --login google          # Auto mode with Google login",
  ],
  notes: [
    "Walks through login, project creation, dev server, and deployment",
    "Press Enter to continue through each step",
    "Press Ctrl+C to exit at any time",
    "All commands execute for real - creates an actual project and deploys it",
    "Use --auto for automated demos or recordings",
  ],
};
