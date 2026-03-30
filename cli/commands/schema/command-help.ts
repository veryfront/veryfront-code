import type { CommandHelp } from "../../help/types.ts";

export const schemaHelp: CommandHelp = {
  name: "schema",
  category: "development",
  description: "Show CLI command schema for agent discovery",
  usage: "veryfront schema [command] [options]",
  options: [
    { flag: "--json", description: "Output as JSON (default for this command)" },
    { flag: "--category <cat>", description: "Filter commands by category" },
  ],
  examples: [
    "veryfront schema --json",
    "veryfront schema deploy --json",
    "veryfront schema --category ai --json",
  ],
};
