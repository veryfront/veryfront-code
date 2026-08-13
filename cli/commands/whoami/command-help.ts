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
    "Exits 0 when a credential validates and 1 when none does, so scripts can gate on it",
  ],
};
