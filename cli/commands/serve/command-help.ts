import type { CommandHelp } from "../../help/types.ts";

export const serveHelp: CommandHelp = {
  name: "serve",
  aliases: ["preview"],
  category: "development",
  description: "Run the production HTTP server (headless)",
  usage: "veryfront serve [options]",
  options: [
    {
      flag: "--port <number>",
      description: "Port to run on",
      default: "3000",
    },
    {
      flag: "--hostname <host>",
      description: "Hostname to bind to",
      default: "0.0.0.0",
    },
  ],
  examples: [
    "veryfront serve",
    "veryfront serve --port 8080",
    "VF_CACHE_BACKEND=distributed veryfront serve",
  ],
};
