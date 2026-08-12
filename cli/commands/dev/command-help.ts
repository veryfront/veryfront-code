import type { CommandHelp } from "../../help/types.ts";

export const devHelp: CommandHelp = {
  name: "dev",
  category: "development",
  description: "Start development server with hot module replacement",
  usage: "veryfront dev [options]",
  options: [
    {
      flag: "--port <number>",
      description: "Port to run on (also reads PORT env var)",
      default: "3000",
    },
    {
      flag: "--no-hmr",
      description: "Disable hot module replacement",
    },
    {
      flag: "--open",
      description: "Open browser automatically",
    },
  ],
  examples: [
    "veryfront dev",
    "veryfront dev --port 8080",
    "PORT=3001 veryfront dev",
    "veryfront dev --open",
    "veryfront dev --no-hmr",
  ],
  notes: [
    "Port selection priority (highest to lowest):",
    "  1. --port / -p flag",
    "  2. PORT env var",
    "  3. VERYFRONT_PORT env var",
    "  4. Default: 3000",
    "",
    "When the requested port is taken, the server falls forward to the next",
    "free port and prints a warning naming both the requested and actual port.",
  ],
};
