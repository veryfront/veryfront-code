import type { CommandHelp } from "../../help/types.ts";

export const envHelp: CommandHelp = {
  name: "env",
  category: "deploy",
  description: "Mint a short-lived token for a protected environment",
  usage: "veryfront env token --env <name> [options]",
  options: [
    {
      flag: "-e, --env, --environment <name>",
      description: "Environment the token can access",
    },
    {
      flag: "-p, --project <ref>",
      description: "Project slug or ID (default: the configured project)",
    },
    {
      flag: "-d, --dir <path>",
      description: "Project directory (default: current directory)",
    },
    {
      flag: "-j, --json",
      description: "Output a machine-readable JSON envelope",
    },
  ],
  examples: [
    "veryfront env token --env production",
    "veryfront env token --env staging --project my-app",
    "veryfront env token --env production --json",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN or an authenticated Veryfront login",
    "The token is bound to one project and environment and expires after the API-provided lifetime",
    "Human output contains only the credential. Capture it with command substitution instead of pasting it into another command",
  ],
};
