import type { CommandHelp } from "../../help/types.ts";

export const workflowHelp: CommandHelp = {
  name: "workflow",
  description: "Run a workflow from the app/workflows directory",
  usage: "veryfront workflow run <id> [options]",
  options: [
    {
      flag: "--input <json>",
      description: "JSON input to pass to the workflow",
    },
    {
      flag: "--debug",
      description: "Enable debug logging",
    },
  ],
  examples: [
    "veryfront workflow run publish-site",
    'veryfront workflow run content-pipeline --input \'{"topic":"AI"}\'',
  ],
};
