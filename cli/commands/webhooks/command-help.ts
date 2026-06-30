import type { CommandHelp } from "../../help/types.ts";

export const webhooksHelp: CommandHelp = {
  name: "webhooks",
  category: "ai",
  description: "List source-defined webhooks",
  usage: "veryfront webhooks [options]",
  options: [
    {
      flag: "--json",
      description: "Output discovered webhooks and errors as JSON",
    },
  ],
  examples: [
    "veryfront webhooks",
    "veryfront webhooks --json",
  ],
};
