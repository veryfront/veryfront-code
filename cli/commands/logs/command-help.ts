import type { CommandHelp } from "../../help/types.ts";

export const logsHelp: CommandHelp = {
  name: "logs",
  category: "deploy",
  description: "View deployment logs",
  usage: "veryfront logs [options]",
  options: [
    {
      flag: "--env <name>",
      description: "Target environment",
      default: "production",
    },
    { flag: "--tail <n>", description: "Show last N log entries" },
    {
      flag: "--since <duration>",
      description: "Show logs since duration (e.g. 1h, 30m)",
    },
    { flag: "--filter <pattern>", description: "Filter log lines by pattern" },
    { flag: "--json", description: "Output each log entry as NDJSON" },
  ],
  examples: [
    "veryfront logs",
    "veryfront logs --tail 100",
    "veryfront logs --env staging",
    "veryfront logs --since 1h --filter ERROR",
  ],
};
