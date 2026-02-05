import type { CommandHelp } from "../../help/types.ts";

export const cleanHelp: CommandHelp = {
  name: "clean",
  description: "Clean build artifacts and caches",
  usage: "veryfront clean [options]",
  options: [
    {
      flag: "--cache",
      description: "Clean cache only",
    },
    {
      flag: "--build",
      description: "Clean build output only",
    },
    {
      flag: "--all",
      description: "Clean everything (node_modules, .deno, .veryfront)",
    },
    {
      flag: "-f, --force",
      description: "Skip confirmation prompts",
    },
  ],
  examples: [
    "veryfront clean",
    "veryfront clean --cache",
    "veryfront clean --all",
    "veryfront clean --all --force",
  ],
  notes: ["The --all option requires confirmation unless --force is used"],
};
