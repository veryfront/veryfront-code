import type { CommandHelp } from "../../help/types.ts";

export const buildHelp: CommandHelp = {
  name: "build",
  description: "Build your application for production",
  usage: "veryfront build [options]",
  options: [
    {
      flag: "-o, --output <dir>",
      description: "Output directory",
      default: ".veryfront/output",
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
      flag: "--no-ssg",
      description: "Disable static generation",
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
  examples: [
    "veryfront build",
    "veryfront build --output dist",
    "veryfront build --no-ssg",
    "veryfront build --preset embedded  # writes dist/embedded/*",
    "veryfront build --include /docs --exclude /api",
    "veryfront build --dry-run",
  ],
};
