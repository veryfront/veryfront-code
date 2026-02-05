import type { CommandHelp } from "../../help/types.ts";

export const whoamiHelp: CommandHelp = {
  name: "whoami",
  description: "Show current authenticated user",
  usage: "veryfront whoami",
  options: [],
  examples: ["veryfront whoami"],
  notes: [
    "Shows email and name of authenticated user",
    "Checks both environment variable and stored token",
  ],
};
