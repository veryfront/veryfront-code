import type { CommandHelp } from "../../help/types.ts";

export const deployHelp: CommandHelp = {
  name: "deploy",
  description: "Create a release and deploy to an environment",
  usage: "veryfront deploy [options]",
  options: [
    {
      flag: "-b, --branch <name>",
      description: "Branch to release from (default: main)",
    },
    {
      flag: "--env <name>",
      description: "Environment to deploy to (default: production)",
    },
    {
      flag: "--release-name <name>",
      description: "Custom release name (auto-generated if omitted)",
    },
    {
      flag: "-f, --force",
      description: "Deploy without confirmation",
    },
    {
      flag: "--dry-run",
      description: "Preview without executing",
    },
  ],
  examples: [
    "veryfront deploy",
    "veryfront deploy --env staging",
    "veryfront deploy --branch feature-x --env preview",
    "veryfront deploy --release-name v1.2.0",
    "veryfront deploy --dry-run",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or veryfront.json config",
    "Creates a new release from the specified branch",
    "Deploys the release to the target environment",
  ],
};
