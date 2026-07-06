import type { CommandHelp } from "../../help/types.ts";

export const openHelp: CommandHelp = {
  name: "open",
  category: "project",
  description: "Open project URLs in the browser",
  usage: "veryfront open [options]",
  options: [
    {
      flag: "-p, --project-slug <slug>",
      description: "Project slug to open (overrides inferred project)",
    },
    { flag: "--env <name>", description: "Open a specific environment URL" },
    { flag: "--studio", description: "Open Veryfront Studio" },
    { flag: "--json", description: "Output URL as JSON instead of opening" },
  ],
  examples: [
    "veryfront open",
    "veryfront open -p my-project",
    "veryfront open --env staging",
    "veryfront open --studio",
    "veryfront open --json",
  ],
};
