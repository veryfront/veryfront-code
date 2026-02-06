import type { CommandHelp } from "../../help/types.ts";

export const analyzeChunksHelp: CommandHelp = {
  name: "analyze-chunks",
  description: "Analyze bundle chunks and sizes",
  usage: "veryfront analyze-chunks [options]",
  options: [
    {
      flag: "-o, --output <file>",
      description: "Output analysis to file",
    },
  ],
  examples: [
    "veryfront analyze-chunks",
    "veryfront analyze-chunks --output bundle-analysis.json",
  ],
};
