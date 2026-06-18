import type { CommandHelp } from "../../help/types.ts";

export const generateHelp: CommandHelp = {
  name: "generate",
  category: "development",
  description: "Generate code scaffolds",
  usage: "veryfront generate <type> [name]",
  options: [],
  examples: [
    "veryfront generate page about",
    "veryfront generate layout admin",
    "veryfront generate api users/[id]",
    "veryfront generate agent researcher",
    "veryfront generate tool search-docs",
    "veryfront generate workflow content-pipeline",
    "veryfront generate task sync-data",
    "veryfront generate resource docs",
    "veryfront generate skill code-review",
    "veryfront generate integration             # Interactive wizard",
    "veryfront generate integration twilio      # With name preset",
  ],
  notes: [
    "Types: page, api, layout, component, tool, agent, prompt, workflow, task, resource, skill, integration",
    "Integration type launches interactive wizard if name not provided",
  ],
};
