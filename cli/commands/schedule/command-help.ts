import type { CommandHelp } from "../../help/types.ts";

export const scheduleHelp: CommandHelp = {
  name: "schedule",
  category: "ai",
  description: "List or run source-defined schedules",
  usage: "veryfront schedule <list|run> [options]",
  options: [
    {
      flag: "--input <file>",
      description: "JSON object file to override the schedule input (run only)",
    },
    {
      flag: "--remote",
      description:
        "Run the pushed schedule in Veryfront Cloud; uses explicit project references or package/directory inference when no module config exists, and cannot be combined with --input (run only)",
    },
    {
      flag: "-d, --dir <path>",
      description: "Project directory (default: current directory)",
    },
    {
      flag: "--json",
      description: "Output as JSON",
    },
    {
      flag: "--debug",
      description: "Enable debug logging (run only)",
    },
  ],
  examples: [
    "veryfront schedule list",
    "veryfront schedule list --json",
    "veryfront schedule run daily-triage",
    "veryfront schedule run daily-triage --input fixtures/priority-queue.json --json",
    "veryfront schedule run daily-triage --remote --json",
  ],
};
