import { cliLogger, exitProcess } from "#cli/utils";
import { createSuccessEnvelope, isJsonMode, outputJson } from "../shared/json-output.ts";
import type { SourceTriggerDiscoveryError } from "veryfront/trigger";

export async function readJsonFile(path: string, label: string): Promise<unknown> {
  try {
    const content = await Deno.readTextFile(path);
    return JSON.parse(content);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label}: ${message}`);
  }
}

export async function outputTriggerList<T>(input: {
  command: string;
  items: T[];
  errors: SourceTriggerDiscoveryError[];
  formatItem: (item: T) => string;
}): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope(input.command, {
      items: input.items,
      errors: input.errors,
    }));
    if (input.errors.length > 0) exitProcess(1);
    return;
  }

  if (input.items.length === 0) {
    cliLogger.info(`No ${input.command} found.`);
  } else {
    for (const item of input.items) {
      cliLogger.info(input.formatItem(item));
    }
  }

  if (input.errors.length > 0) {
    cliLogger.error("");
    cliLogger.error(`${input.errors.length} ${input.command} file failed to load:`);
    for (const error of input.errors) {
      cliLogger.error(`  - ${error.sourcePath}: ${error.message}`);
    }
    exitProcess(1);
  }
}

export async function outputTriggerRun(input: {
  command: string;
  triggerId: string;
  target: { kind: string; id: string };
  output?: unknown;
  durationMs: number;
}): Promise<void> {
  if (isJsonMode()) {
    await outputJson(createSuccessEnvelope(input.command, input));
    return;
  }

  cliLogger.info(
    `${input.command} "${input.triggerId}" ran ${input.target.kind} "${input.target.id}" in ${input.durationMs}ms`,
  );
  if (input.output !== undefined) {
    cliLogger.info(JSON.stringify(input.output, null, 2));
  }
}
