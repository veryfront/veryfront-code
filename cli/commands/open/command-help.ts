import type { CommandHelp } from "../../help/types.ts";

export const openHelp: CommandHelp = {
  name: "open",
  category: "project",
  description: "Open project URLs in the browser",
  usage: "veryfront open [options]",
  options: [
    { flag: "--env <name>", description: "Open a specific environment URL" },
    { flag: "--studio", description: "Open Veryfront Studio" },
    { flag: "--json", description: "Output URL as JSON instead of opening" },
  ],
  examples: [
    "veryfront open",
    "veryfront open --env staging",
    "veryfront open --studio",
    "veryfront open --json",
  ],
};
