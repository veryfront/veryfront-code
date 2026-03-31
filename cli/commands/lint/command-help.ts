import type { CommandHelp } from "../../help/types.ts";

export const lintHelp: CommandHelp = {
  name: "lint",
  category: "development",
  description: "Run linter with optional structured JSON output",
  usage: "veryfront lint [options]",
  options: [
    { flag: "--json", description: "Output structured JSON results" },
  ],
  examples: [
    "veryfront lint",
    "veryfront lint --json",
  ],
};
