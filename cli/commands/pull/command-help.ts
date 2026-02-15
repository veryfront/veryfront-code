import type { CommandHelp } from "../../help/types.ts";

export const pullHelp: CommandHelp = {
  name: "pull",
  description: "Download project files from Veryfront remote",
  usage: "veryfront pull [options]",
  options: [
    {
      flag: "--projects <slugs>",
      description: "Comma-separated list of project slugs to pull",
    },
    {
      flag: "-d, --dir <path>",
      description: "Target directory (default: current directory)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Branch to pull from (default: main)",
    },
    {
      flag: "--env <name>",
      description: "Environment to pull from (e.g., production, staging)",
    },
    {
      flag: "--release <version>",
      description: "Release version to pull from (e.g., v1.2.0)",
    },
    {
      flag: "-f, --force",
      description: "Force overwrite without confirmation",
    },
    {
      flag: "--dry-run",
      description: "Show what would be written without writing",
    },
  ],
  examples: [
    "veryfront pull",
    "veryfront pull --dir ./my-project",
    "veryfront pull --branch feature-header",
    "veryfront pull --env production",
    "veryfront pull --release v1.2.0",
    "veryfront pull --projects project-a,project-b,project-c",
    "veryfront pull --projects my-app --dir ./apps",
    "veryfront pull --dry-run",
    "veryfront pull --force",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or veryfront.json config",
    "Project slug is inferred from package.json name or directory",
    "With --projects, each project is pulled into a subdirectory named after the slug",
    'Projects list can also be specified in veryfront.json: { "projects": ["slug1", "slug2"] }',
    "Priority order: --env > --release > --branch > main",
  ],
};
