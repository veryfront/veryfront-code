import type { CommandHelp } from "../../help/types.ts";

export const extensionHelp: CommandHelp = {
  name: "extension",
  category: "development",
  description: "Scaffold and validate veryfront extensions",
  usage: "veryfront extension <init|validate> [args]",
  examples: [
    "veryfront extension init my-cache              # Scaffold a new extension",
    "veryfront extension validate extensions/my-cache   # Validate an extension",
  ],
  notes: [
    "'init <name>' creates extensions/<name>/ with a typed factory and tests",
    "'validate <path>' loads the extension and reports shape issues",
    "Names must be lowercase alphanumeric with hyphens (e.g. 'my-cache')",
  ],
};
