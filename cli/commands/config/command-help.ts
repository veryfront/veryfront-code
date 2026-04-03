import type { CommandHelp } from "../../help/types.ts";

export const configHelp: CommandHelp = {
  name: "config",
  category: "project",
  description: "Show effective project configuration",
  usage: "veryfront config [options]",
  options: [
    { flag: "--json", description: "Output as JSON" },
  ],
  examples: [
    "veryfront config",
    "veryfront config --json",
  ],
};
