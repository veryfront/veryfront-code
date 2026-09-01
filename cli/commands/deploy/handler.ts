/**
 * Deploy command handler
 */

import { deployCommand, parseDeployArgs } from "./command.ts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";
import { ensureCliBundlerContracts } from "#cli/shared/default-contracts";

interface DeployHandlerDependencies {
  ensureBundlerContracts: () => Promise<void>;
  deploy: typeof deployCommand;
}

const defaultDependencies: DeployHandlerDependencies = {
  ensureBundlerContracts: ensureCliBundlerContracts,
  deploy: deployCommand,
};

export async function handleDeployCommand(
  args: ParsedArgs,
  dependencies: DeployHandlerDependencies = defaultDependencies,
): Promise<void> {
  showHeader();
  const options = parseArgsOrThrow(parseDeployArgs, "deploy", args);
  await dependencies.ensureBundlerContracts();
  await dependencies.deploy(options);
}
