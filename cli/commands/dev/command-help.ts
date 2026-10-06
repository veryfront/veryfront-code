import type { CommandHelp } from "../../help/types.ts";

export const devHelp: CommandHelp = {
  name: "dev",
  category: "development",
  description: "Start development server with hot module replacement",
  usage: "veryfront dev [options]",
  options: [
    {
      flag: "--port <number>",
      description: "TCP port from 1 to 65535; 0 selects a free port (also reads PORT env var)",
      default: "3000",
    },
    {
      flag: "--project <directory>",
      description: "Run a local project directory (defaults to the current directory)",
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
    "veryfront dev --project ./my-app",
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
    "free port. Open the URL the CLI prints to reach the running server.",
  ],
};
