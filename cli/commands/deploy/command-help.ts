import type { CommandHelp } from "../../help/types.ts";

export const deployHelp: CommandHelp = {
  name: "deploy",
  category: "deploy",
  description: "Promote a branch to an environment",
  usage: "veryfront deploy [options]",
  options: [
    {
      flag: "-b, --branch <name>",
      description: "Branch to release from (default: latest verified push, otherwise main)",
    },
    {
      flag: "-e, --env, --environment <name>",
      description: "Environment to deploy to (default: production)",
    },
    {
      flag: "--release-name <name>",
      description: "Custom release name (auto-generated if omitted)",
    },
    {
      flag: "--dry-run",
      description: "Preview without executing",
    },
    {
      flag: "-q, --quiet",
      description: "Suppress progress and summary output",
    },
  ],
  examples: [
    "veryfront deploy",
    "veryfront deploy --environment staging",
    "veryfront deploy --branch feature-x --environment staging",
    "veryfront deploy --release-name v1.2.0",
    "veryfront deploy --dry-run",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN or an authenticated Veryfront login",
    "Creates or links a project when veryfront.json is not present",
    "Promotes the latest verified push when --branch is omitted",
    "Pushes main before the first deploy when no verified push exists",
    "Creates a new release from the resolved branch",
    "Verifies the target environment points to the created deployment before succeeding",
  ],
};
