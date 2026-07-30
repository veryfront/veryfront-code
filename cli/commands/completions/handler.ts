import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess, logUsageError } from "#cli/utils";
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
      logUsageError(
        "Usage: veryfront completions <bash|zsh|fish>",
        'Example: eval "$(veryfront completions bash)"',
      );
      exitProcess(2);
  }
}
