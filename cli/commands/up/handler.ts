/**
 * Up command handler
 */

import { parseUpArgs, upCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";

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
  const options = parseArgsOrThrow(parseUpArgs, "up", args);
  await dependencies.ensureBundlerContracts();
  await dependencies.up(options);
}
