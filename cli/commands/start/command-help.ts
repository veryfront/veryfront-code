import type { CommandHelp } from "../../help/types.ts";

export const startHelp: CommandHelp = {
  name: "start",
  description: "Start development dashboard with proxy and MCP integration",
  usage: "veryfront start [options]",
  options: [
    {
      flag: "-p, --port <number>",
      description: "Port to run on",
      default: "8080",
    },
    {
      flag: "--mcp-port <number>",
      description: "MCP server port",
      default: "9999",
    },
    {
      flag: "--project <path>",
      description: "Path to a Veryfront project directory",
    },
    {
      flag: "--headless, --no-tui",
      description: "Run without terminal UI (for coding agents)",
    },
  ],
  examples: [
    "veryfront start",
    "veryfront start --port 9000",
    "veryfront start --project ./my-app",
    "veryfront start --headless",
  ],
};
