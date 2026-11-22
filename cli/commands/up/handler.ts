/**
 * Up command handler
 */

import { parseUpArgs, upCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";
import { INVALID_ARGUMENT } from "veryfront/errors";

interface UpHandlerDependencies {
  ensureBundlerContracts: () => Promise<void>;
  up: typeof upCommand;
}

const defaultDependencies: UpHandlerDependencies = {
  ensureBundlerContracts: ensureCliBundlerContracts,
  up: upCommand,
};

export async function handleUpCommand(
  args: ParsedArgs,
  dependencies: UpHandlerDependencies = defaultDependencies,
): Promise<void> {
  showLogo();
  // A bare `--name` parses as `true`, which the shared string coercion would
  // turn into a project literally named "true".
  if (args.name === true) {
    throw INVALID_ARGUMENT.create({
      detail:
        'Invalid up arguments: --name requires a value, for example veryfront up --name "Support Desk"',
      context: { command: "up" },
    });
  }
  const options = parseArgsOrThrow(parseUpArgs, "up", args);
  await dependencies.ensureBundlerContracts();
  await dependencies.up(options);
}
