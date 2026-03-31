import type { ParsedArgs } from "#cli/shared/types";
import {
  generateBashCompletions,
  generateFishCompletions,
  generateZshCompletions,
} from "./command.ts";

export async function handleCompletionsCommand(
  args: ParsedArgs,
): Promise<void> {
  const shell = args._[1] as string | undefined;

  switch (shell) {
    case "bash":
      console.log(generateBashCompletions());
      break;
    case "zsh":
      console.log(generateZshCompletions());
      break;
    case "fish":
      console.log(generateFishCompletions());
      break;
    default:
      console.error("Usage: veryfront completions <bash|zsh|fish>");
      console.error('Example: eval "$(veryfront completions bash)"');
      Deno.exit(1);
  }
}
