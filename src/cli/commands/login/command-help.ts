import type { CommandHelp } from "../../help/types.ts";

export const loginHelp: CommandHelp = {
  name: "login",
  description: "Authenticate with Veryfront",
  usage: "veryfront login [options]",
  options: [
    {
      flag: "--google",
      description: "Login with Google OAuth",
    },
    {
      flag: "--github",
      description: "Login with GitHub OAuth",
    },
    {
      flag: "--microsoft",
      description: "Login with Microsoft OAuth",
    },
    {
      flag: "--token",
      description: "Enter API token manually",
    },
  ],
  examples: [
    "veryfront login",
    "veryfront login --google",
    "veryfront login --github",
    "veryfront login --microsoft",
    "veryfront login --token",
  ],
  notes: [
    "Without options, prompts for authentication method",
    "OAuth methods open browser for authentication",
    "Token is stored in ~/.config/veryfront/token",
  ],
};
