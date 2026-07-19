import type { CommandHelp } from "../../help/types.ts";

export const evalHelp: CommandHelp = {
  name: "eval",
  category: "ai",
  description: "List, run, and export discovered eval definitions",
  usage: "veryfront eval [eval-id] [options]",
  options: [
    {
      flag: "-l, --list",
      description: "List discovered evals without running them",
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
      description: "Write summary.json, results.jsonl, and report.md artifacts to a directory",
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
      flag: "--baseline-pass-rate-drop-threshold <fraction>",
      description: "Allow this aggregate pass-rate drop before a baseline regression fails",
    },
    {
      flag: "--baseline-metric-pass-rate-drop-threshold <fraction>",
      description: "Allow this per-metric pass-rate drop before a baseline regression fails",
    },
    {
      flag: "--baseline-failed-delta-threshold <count>",
      description: "Allow this failed-result count increase before a baseline regression fails",
    },
    {
      flag: "--baseline-usage-increase-threshold <fraction>",
      description: "Fail when reported usage or cost increases beyond this baseline fraction",
    },
    {
      flag: "--baseline-latency-increase-threshold <fraction>",
      description: "Fail when p95 latency increases beyond this baseline fraction",
    },
    {
      flag: "--export <ids>",
      description: "Export the report through registered eval exporters",
    },
    {
      flag: "--require-export",
      description: "Fail the command when a selected eval export is missing or fails (for CI)",
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
      flag: "--comparison-policy <path>",
      description: "Read model comparison constraints and weighted objectives from JSON",
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
    "veryfront eval",
    "veryfront eval deep-research",
    "veryfront eval eval:deep-research --report-dir .veryfront/evals/deep-research",
    "veryfront eval eval:deep-research --report .veryfront/evals/deep-research/report.json --junit .veryfront/evals/deep-research/junit.xml",
    "veryfront eval deep-research --baseline .veryfront/evals/baseline.json --json",
    "veryfront eval deep-research --baseline-model anthropic/claude-sonnet-4-6 --candidate-model moonshotai/kimi-k2.6",
    "veryfront eval deep-research --baseline-model anthropic/claude-sonnet-4-6 --candidate-model moonshotai/kimi-k2.6 --comparison-policy evals/model-comparison.policy.json",
    "veryfront eval deep-research --export braintrust,langfuse --json",
    "VERYFRONT_EVAL_EXPORTERS=mlflow VERYFRONT_EVAL_EXPORT_REQUIRED=true veryfront eval",
    "MLFLOW_TRACKING_URI=https://mlflow.example.com veryfront eval",
    "veryfront eval deep-research --json",
  ],
};
