import type { CommandHelp } from "../../help/types.ts";

export const scheduleHelp: CommandHelp = {
  name: "schedule",
  category: "ai",
  description: "List or run source-defined schedules",
  usage: "veryfront schedule <list|run> [options]",
  options: [
    {
      flag: "--input <file>",
      description: "JSON input file to override the schedule input (run only)",
    },
    {
      flag: "--remote",
      description:
        "Run the pushed source schedule in the Veryfront cloud runtime; cannot be combined with --input (run only)",
    },
    {
      flag: "--json",
      description: "Output as JSON",
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
