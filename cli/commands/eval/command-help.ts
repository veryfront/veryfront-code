import type { CommandHelp } from "../../help/types.ts";

export const evalHelp: CommandHelp = {
  name: "eval",
  category: "ai",
  description: "Discover and run eval definitions",
  usage: "veryfront eval [eval-id] [options]",
  options: [
    {
      flag: "-l, --list",
      description: "List discovered evals",
    },
    {
      flag: "--dataset-base <path>",
      description: "Base directory for JSON and JSONL datasets",
    },
    {
      flag: "--report <path>",
      description: "Write the raw eval report JSON to a file",
    },
    {
      flag: "--junit <path>",
      description: "Write a JUnit XML report to a file",
    },
    {
      flag: "--model <provider/model>",
      description: "Override the target agent model",
    },
    {
      flag: "--max-output-tokens <count>",
      description: "Limit target agent output tokens",
    },
    {
      flag: "--debug",
      description: "Show discovery warnings",
    },
  ],
  examples: [
    "veryfront eval --list",
    "veryfront eval deep-research",
    "veryfront eval eval:deep-research --report .veryfront/evals/deep-research.json --junit .veryfront/evals/deep-research.xml",
    "veryfront eval deep-research --json",
  ],
};
