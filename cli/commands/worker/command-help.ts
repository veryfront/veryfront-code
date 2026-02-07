import type { CommandHelp } from "../../help/types.ts";

export const workerHelp: CommandHelp = {
  name: "worker",
  description: "Start workflow job worker",
  usage: "veryfront worker [options]",
  options: [
    {
      flag: "--redis-url <url>",
      description: "Redis connection URL",
      default: "redis://localhost:6379",
    },
    {
      flag: "-c, --concurrency <number>",
      description: "Maximum concurrent jobs",
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
      flag: "-e, --executor <type>",
      description: "Job executor type (process | k8s)",
      default: "process",
    },
    {
      flag: "--entrypoint <path>",
      description: "Path to job entrypoint script",
      default: "./workflow-job.ts",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront worker",
    "veryfront worker --redis-url redis://prod:6379 --concurrency 5",
    "veryfront worker --entrypoint ./src/jobs/workflow-runner.ts --debug",
  ],
};
