import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { INVALID_ARGUMENT } from "veryfront/errors";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../../shared/json-output.ts";
import {
  type EnvironmentTokenDependencies,
  mintEnvironmentAccessToken,
  parseEnvironmentTokenArgs,
} from "./command.ts";

export async function handleEnvCommand(
  args: ParsedArgs,
  dependencies: EnvironmentTokenDependencies = {},
): Promise<void> {
  const subcommand = args._[1];
  if (typeof subcommand !== "string" || subcommand.length === 0) {
    throw INVALID_ARGUMENT.create({
      detail: "Environment subcommand is required. Usage: veryfront env token --env <name>",
    });
  }
  if (subcommand !== "token") {
    throw INVALID_ARGUMENT.create({
      detail: `Unknown env subcommand: ${
        String(subcommand)
      }. Usage: veryfront env token --env <name>`,
    });
  }

  const options = parseArgsOrThrow(parseEnvironmentTokenArgs, "env token", args);
  const credential = await mintEnvironmentAccessToken(options, dependencies);
  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope("env", {
      access_token: credential.accessToken,
      expires_in: credential.expiresIn,
    }));
    return;
  }
  console.log(credential.accessToken);
}
