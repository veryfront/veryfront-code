import type { CommandHelp } from "../../help/types.ts";

export const workerHelp: CommandHelp = {
  name: "worker",
  category: "ai",
  description: "Start workflow run worker",
  usage: "veryfront worker [options]",
  options: [
    {
      flag: "--redis-url <url>",
      description: "Redis connection URL",
      default: "redis://localhost:6379",
    },
    {
      flag: "-c, --concurrency <number>",
      description: "Maximum concurrent runs",
      default: "3",
    },
    {
      flag: "--poll-interval <ms>",
      description: "Poll interval in milliseconds",
      default: "5000",
    },
    {
      flag: "--stalled-threshold <ms>",
      description: "Time before a run is considered stalled",
      default: "60000",
    },
    {
      flag: "--entrypoint <path>",
      description: "Path to workflow run entrypoint script",
      default: "./workflow-run.ts",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront worker",
    "veryfront worker --redis-url redis://prod:6379 --concurrency 5",
    "veryfront worker --entrypoint ./src/runs/workflow-runner.ts --debug",
  ],
};
