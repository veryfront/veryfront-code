import type { CommandHelp } from "../../help/types.ts";

export const pullHelp: CommandHelp = {
  name: "pull",
  category: "deploy",
  description: "Download project files from Veryfront remote",
  usage: "veryfront pull [project-slug] [options]",
  options: [
    {
      flag: "-p, --project-slug <slug>",
      description: "Project slug to pull (overrides inferred project)",
    },
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
      description: "Skip confirmation for compatibility (prefer global --yes)",
    },
    {
      flag: "--dry-run",
      description: "Show what would be written or deleted without changing files",
    },
    {
      flag: "--prune",
      description: "Delete managed local files missing from the selected source",
    },
    {
      flag: "-q, --quiet",
      description: "Suppress progress and summary output",
    },
  ],
  examples: [
    "veryfront pull",
    "veryfront pull veryfront-based-38c7d03a",
    "veryfront pull -p veryfront-based-38c7d03a --dir ./veryfront-based",
    "veryfront pull --dir ./my-project",
    "veryfront pull --branch feature-header",
    "veryfront pull --env production",
    "veryfront pull --release v1.2.0",
    "veryfront pull --projects project-a,project-b,project-c",
    "veryfront pull --projects my-app --dir ./apps",
    "veryfront pull --branch studio-change --prune --dry-run",
    "veryfront pull --branch studio-change --prune --yes",
    "veryfront pull --dry-run",
    "veryfront pull --yes",
  ],
  notes: [
    "Requires VERYFRONT_API_TOKEN env var or veryfront.json config",
    "Project slug is inferred from package.json name or directory",
    "With --projects, each project is pulled into a subdirectory named after the slug",
    'Projects list can also be specified in veryfront.json: { "projects": ["slug1", "slug2"] }',
    "Priority order: --env > --release > --branch > main",
    "--prune applies a full managed-source snapshot; it does not perform a Git merge",
    "Mutating --prune requires a clean Git worktree; --yes and --force skip confirmation only",
    "--prune --dry-run can preview anywhere and never writes or deletes local files",
    "Only supported text files are managed; ignored, unsupported, and binary files remain unchanged",
    "Pull preserves remote bytes exactly, including line endings and a missing final newline",
    "Invalid, duplicate, reserved, or symlink-traversing remote paths fail before local writes",
    "A fetch failure causes no writes or pruning; a local write or delete failure exits with an error",
  ],
};
