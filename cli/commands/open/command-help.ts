import type { CommandHelp } from "../../help/types.ts";

export const openHelp: CommandHelp = {
  name: "open",
  category: "project",
  description: "Open the Cloud dashboard, or the deployed site with --site",
  usage: "veryfront open [options]",
  options: [
    {
      flag: "-p, --project <slug>",
      description: "Project slug to open (overrides inferred project)",
    },
    {
      flag: "--env <name>",
      description: "Environment to open with --site; otherwise the Environments panel",
    },
    {
      flag: "--site",
      description: "Open the deployed site instead of a dashboard page (default env: production)",
    },
    { flag: "--studio", description: "Open Veryfront Studio" },
    { flag: "--json", description: "Output URL as JSON instead of opening" },
  ],
  examples: [
    "veryfront open",
    "veryfront open --project my-project",
    "veryfront open --env staging",
    "veryfront open --site",
    "veryfront open --site --env staging",
    "veryfront open --site --json",
    "veryfront open --studio",
    "veryfront open --json",
  ],
};
