import type { CommandHelp } from "../../help/types.ts";

export const routesHelp: CommandHelp = {
  name: "routes",
  description: "List all discovered routes in your application",
  usage: "veryfront routes [options]",
  options: [
    {
      flag: "-j, --json",
      description: "Output as JSON",
    },
  ],
  examples: ["veryfront routes", "veryfront routes --json"],
};
