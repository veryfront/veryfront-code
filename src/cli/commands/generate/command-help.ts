import type { CommandHelp } from "../../help/types.ts";

export const generateHelp: CommandHelp = {
  name: "generate",
  description: "Generate code scaffolds",
  usage: "veryfront generate <type> [name]",
  options: [],
  examples: [
    "veryfront generate page about",
    "veryfront generate layout admin",
    "veryfront generate api users/[id]",
    "veryfront generate provider auth",
    "veryfront generate integration             # Interactive wizard",
    "veryfront generate integration twilio      # With name preset",
  ],
  notes: [
    "Types: page, layout, provider, api, integration",
    "Integration type launches interactive wizard if name not provided",
  ],
};
