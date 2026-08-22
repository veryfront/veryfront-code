import type { CommandHelp } from "../../help/types.ts";

export const deployHelp: CommandHelp = {
  name: "deploy",
  category: "deploy",
  description: "Promote a branch to an environment",
  usage: "veryfront deploy [options]",
  options: [
    {
      flag: "-p, --project <slug>",
      description: "Project to deploy (default: the project this directory is linked to)",
    },
    {
      flag: "-d, --dir <path>",
      description: "Project directory (default: current directory)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Branch to release from (default: main)",
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
    "veryfront deploy --project my-app --environment production",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN or an authenticated Veryfront login",
    "Creates or links a project when veryfront.json is not present",
    "Promotes main when --branch is omitted",
    "Pushes main before the first deploy when no verified push exists",
    "With --project, promotes only: the working directory is never pushed, so the selected project directory's push receipt must already name that project",
    "Creates a new release from the resolved branch",
    "Verifies the target environment points to the created deployment before succeeding",
    "Probes a protected environment with a short-lived environment access token exchanged for the API key, and warns when only the access gate answered, so the app itself was never observed serving",
  ],
};
