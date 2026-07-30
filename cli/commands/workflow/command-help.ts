import type { CommandHelp } from "../../help/types.ts";

export const workflowHelp: CommandHelp = {
  name: "workflow",
  category: "ai",
  description: "Run a workflow from the workflows directory",
  usage: "veryfront workflow run <id> [options]",
  options: [
    {
      flag: "--input <json>",
      description: "JSON input to pass to the workflow",
    },
    {
      flag: "--backend <memory|distributed>",
      description: "Workflow state backend; distributed requires an activated provider extension",
      default: "memory",
    },
  ],
  examples: [
    "veryfront workflow run publish-site",
    'veryfront workflow run content-pipeline --input \'{"topic":"AI"}\'',
    "veryfront workflow run publish-site --backend distributed",
  ],
};
