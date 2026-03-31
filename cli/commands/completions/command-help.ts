import type { CommandHelp } from "../../help/types.ts";

export const completionsHelp: CommandHelp = {
  name: "completions",
  category: "development",
  description: "Generate shell completion scripts",
  usage: "veryfront completions <shell>",
  options: [],
  examples: [
    "veryfront completions bash",
    "veryfront completions zsh",
    "veryfront completions fish",
    'eval "$(veryfront completions bash)"',
  ],
};
