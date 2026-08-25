import type { CommandHelp } from "../../help/types.ts";

export const buildHelp: CommandHelp = {
  name: "build",
  category: "development",
  description: "Build your application for production",
  usage: "veryfront build [options]",
  options: [
    {
      flag: "-o, --output <dir>",
      description: "Output directory (also configurable via build.outDir)",
      default: "dist",
    },
    {
      flag: "--no-compress",
      description: "Disable compression",
    },
    {
      flag: "--no-split",
      description: "Disable code splitting",
    },
    {
      flag: "--ssg",
      description: "Enable static generation (default; also configurable via build.ssg)",
    },
    {
      flag: "--no-ssg",
      description: "Disable static generation (the build fails if it would emit no pages)",
    },
    {
      flag: "--include <paths>",
      description: "Include specific paths in SSG",
    },
    {
      flag: "--exclude <paths>",
      description: "Exclude paths from SSG",
    },
    {
      flag: "--dry-run",
      description: "Preview what will be built",
    },
    {
      flag: "--preset <name>",
      description: "Select build preset (e.g. embedded)",
    },
  ],
  notes: [
    "--preset embedded emits a single bundle, so of the build flags it honours only -o/--output and build.outDir. Global flags such as --json, --verbose and --quiet are unaffected.",
    "It rejects --dry-run, --split/--no-split, --compress/--no-compress, --prefetch, --ssg/--no-ssg, --include and --exclude rather than ignoring them.",
  ],
  examples: [
    "veryfront build",
    "veryfront build --output dist",
    "veryfront build --ssg",
    "veryfront build --preset embedded  # writes dist/embedded/*",
    "veryfront build --ssg --include /docs --exclude /api",
    "veryfront build --dry-run",
  ],
};
