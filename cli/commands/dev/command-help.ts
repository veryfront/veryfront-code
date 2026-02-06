import type { CommandHelp } from "../../help/types.ts";

export const devHelp: CommandHelp = {
  name: "dev",
  description: "Start development server with hot module replacement",
  usage: "veryfront dev [options]",
  options: [
    {
      flag: "-p, --port <number>",
      description: "Port to run on",
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
    "veryfront dev --open",
    "veryfront dev --no-hmr",
  ],
};
