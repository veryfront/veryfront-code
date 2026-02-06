import type { CommandHelp } from "../../help/types.ts";

export const serveHelp: CommandHelp = {
  name: "serve",
  description: "Start production server",
  usage: "veryfront serve [options]",
  options: [
    {
      flag: "-p, --port <number>",
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
    "VERYFRONT_USE_REDIS_CACHE=1 veryfront serve",
  ],
};
