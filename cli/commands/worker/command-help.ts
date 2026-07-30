import type { CommandHelp } from "../../help/types.ts";

export const workerHelp: CommandHelp = {
  name: "worker",
  hidden: true,
  category: "ai",
  description: "Start workflow run worker",
  usage: "veryfront worker [options]",
  options: [
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
      flag: "--project-dir <path>",
      description: "Project containing the config and worker entrypoint",
      default: "current directory",
    },
  ],
  examples: [
    "veryfront worker --concurrency 5",
    "veryfront worker --project-dir ./my-app --entrypoint ./src/runs/workflow-runner.ts",
  ],
};
