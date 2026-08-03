import type { CommandHelp } from "../../help/types.ts";

export const whoamiHelp: CommandHelp = {
  name: "whoami",
  category: "auth",
  description: "Show the current authenticated identity",
  usage: "veryfront whoami",
  options: [],
  examples: ["veryfront whoami"],
  notes: [
    "Shows the authenticated user or API-key credential type",
    "Checks both environment variable and stored token",
  ],
};
