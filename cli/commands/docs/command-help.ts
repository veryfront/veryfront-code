import type { CommandHelp } from "../../help/types.ts";

export const docsHelp: CommandHelp = {
  name: "docs",
  category: "development",
  description: "Open the public Veryfront Code documentation",
  usage: "veryfront docs [--json]",
  options: [{
    flag: "--json",
    description: "Print the documentation URL as JSON without opening a browser",
  }],
  examples: ["veryfront docs", "veryfront docs --json"],
  notes: ["Works without a project or Veryfront account."],
};
