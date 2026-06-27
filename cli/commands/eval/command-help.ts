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
      flag: "--report-dir <path>",
      description: "Write summary.json and results.jsonl artifacts to a directory",
    },
    {
      flag: "--junit <path>",
      description: "Write a JUnit XML report to a file",
    },
    {
      flag: "--baseline <path>",
      description: "Compare the eval report against a saved baseline report",
    },
    {
      flag: "--write-baseline <path>",
      description: "Write the eval report JSON as the next baseline",
    },
    {
      flag: "--export <ids>",
      description: "Export the report through registered eval exporters",
    },
    {
      flag: "--model <provider/model>",
      description: "Override the target agent model",
    },
    {
      flag: "--baseline-model <provider/model>",
      description: "Baseline model for model comparison runs",
    },
    {
      flag: "--candidate-model <provider/model>",
      description:
        "Candidate model to compare against --baseline-model; repeat for multiple candidates",
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
    "veryfront eval eval:deep-research --report-dir .veryfront/evals/deep-research",
    "veryfront eval eval:deep-research --report .veryfront/evals/deep-research/report.json --junit .veryfront/evals/deep-research/junit.xml",
    "veryfront eval deep-research --baseline .veryfront/evals/baseline.json --json",
    "veryfront eval deep-research --baseline-model anthropic/claude-sonnet-4-6 --candidate-model moonshotai/kimi-k2",
    "veryfront eval deep-research --export braintrust,langfuse --json",
    "veryfront eval deep-research --json",
  ],
};
