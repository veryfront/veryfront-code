import type { CommandHelp } from "../../help/types.ts";

export const logoutHelp: CommandHelp = {
  name: "logout",
  description: "Clear stored authentication credentials",
  usage: "veryfront logout",
  options: [],
  examples: ["veryfront logout"],
  notes: [
    "Removes token from ~/.config/veryfront/token",
    "Does not affect VERYFRONT_API_TOKEN environment variable",
  ],
};
