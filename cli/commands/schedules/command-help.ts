import type { CommandHelp } from "../../help/types.ts";

export const schedulesHelp: CommandHelp = {
  name: "schedules",
  category: "ai",
  description: "List source-defined schedules",
  usage: "veryfront schedules [options]",
  options: [
    {
      flag: "--json",
      description: "Output discovered schedules and errors as JSON",
    },
  ],
  examples: [
    "veryfront schedules",
    "veryfront schedules --json",
  ],
};
