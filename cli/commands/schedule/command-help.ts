import type { CommandHelp } from "../../help/types.ts";

export const scheduleHelp: CommandHelp = {
  name: "schedule",
  category: "ai",
  description: "Run a source-defined schedule locally",
  usage: "veryfront schedule run <id> [options]",
  options: [
    {
      flag: "--input <file>",
      description: "JSON input file to override the schedule input",
    },
    {
      flag: "--remote",
      description: "Run the pushed source schedule in the Veryfront cloud runtime",
    },
    {
      flag: "--json",
      description: "Output the run result as JSON",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront schedule run daily-triage",
    "veryfront schedule run daily-triage --input fixtures/priority-queue.json --json",
    "veryfront schedule run daily-triage --remote --json",
  ],
};
