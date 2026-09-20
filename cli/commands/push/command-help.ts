import type { CommandHelp } from "../../help/types.ts";

export const pushHelp: CommandHelp = {
  name: "push",
  category: "deploy",
  description: "Push source to a cloud preview",
  usage: "veryfront push [options]",
  options: [
    {
      flag: "-d, --dir <path>",
      description: "Source directory (default: current directory)",
    },
    {
      flag: "-p, --project <slug>",
      description: "Project slug to push to (overrides inferred project)",
    },
    {
      flag: "-b, --branch <name>",
      description: "Preview branch to update (default: main)",
    },
    {
      flag: "--dry-run",
      description: "Show planned uploads and deletions without changing remote files",
    },
    {
      flag: "--prune",
      description: "Delete managed remote files that are missing locally",
    },
    {
      flag: "-f, --force",
      description: "Intentionally overwrite remote changes and bypass concurrency guards",
    },
    {
      flag: "-q, --quiet",
      description: "Suppress progress and summary output",
    },
    {
      flag: "--no-adopt-pins",
      description: "Never reconcile a server-written dependency pin set into local package.json",
    },
    {
      flag: "--adopt-new-deps",
      description: "Accept resolved dependencies package.json does not declare, without asking",
    },
  ],
  examples: [
    "veryfront push",
    "veryfront push --branch feature-header",
    "veryfront push --dry-run",
    "veryfront push --prune --dry-run",
  ],
  notes: [
    "Pushes main by default and prints its stable cloud preview URL",
    "Use --branch to create or update an isolated branch preview",
    "Preview branch names use lowercase letters, numbers, and hyphens",
    "By default, push uploads local files and preserves remote-only files",
    "Push rejects files changed remotely since the last pull or push",
    "Dependency versions the platform resolved into package.json are adopted locally and reported",
    "A resolved dependency package.json never declared is only written after you confirm it",
    "Run pull and reconcile changes with Git before retrying a rejected push",
    "Use --force only when you intend to overwrite remote changes",
    "Use --prune to remove managed remote files that are missing locally",
    "Run veryfront deploy when the preview is ready for an environment",
    ".vfignore excludes matching local files and preserves matching remote files",
    "Files Git ignores (.gitignore, .git/info/exclude, core.excludesFile) are not uploaded",
    "Add a .vfignore negation such as !dist to upload a path Git ignores",
    "With --prune, remote .env, .env.*, .veryfront, and .git paths are always removed",
    "--dry-run previews deletions only when --prune is present",
    "--dry-run never creates a project or branch, changes remote files, or writes a Push receipt",
  ],
};
