import type { CommandHelp } from "../../help/types.ts";

export const loginHelp: CommandHelp = {
  name: "login",
  category: "auth",
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
    "Without options, a valid session returns immediately. Use an explicit method to sign in again",
    "OAuth methods open browser for authentication",
    "Token is stored in ~/.config/veryfront/token",
    "Exits 1 when no credential was obtained, so scripts can gate on it",
  ],
};
