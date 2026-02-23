import type { CommandHelp } from "../../help/types.ts";

export const taskHelp: CommandHelp = {
  name: "task",
  description: "Run a task from the tasks/ directory",
  usage: "veryfront task <name> [options]",
  options: [
    {
      flag: "--config <json>",
      description: "JSON config to pass to the task's ctx.config",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront task sync-data",
    'veryfront task send-report --config \'{"to": "team@example.com"}\'',
    "veryfront task cleanup --debug",
  ],
};
