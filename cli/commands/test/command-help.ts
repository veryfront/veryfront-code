import type { CommandHelp } from "../../help/types.ts";

export const testHelp: CommandHelp = {
  name: "test",
  category: "development",
  description: "Run tests with optional structured JSON output",
  usage: "veryfront test [filter] [options]",
  options: [
    { flag: "--json", description: "Output structured JSON results" },
    { flag: "--parallel", description: "Run tests in parallel" },
    { flag: "--filter <pattern>", description: "Filter tests by name" },
  ],
  examples: [
    "veryfront test",
    "veryfront test --json",
    "veryfront test --filter 'deploy' --json",
  ],
};
