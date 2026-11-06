import { createPrivateSet } from "#veryfront/security/private-set.ts";
import {
  allPrivatePromises,
  chainPrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { mapPrivateArray } from "#veryfront/security/private-array.ts";
import { serverLogger } from "#veryfront/utils";
import type { RemoteToolSource, ToolExecutionContext } from "./types.ts";

type DisposeOutcome = { failed: false } | { failed: true; error: unknown };

/**
 * Dispose each distinct source concurrently, so independent session cleanup
 * budgets overlap instead of adding up. Throws the first failure after every
 * disposal settles.
 */
export async function disposeRemoteToolSources(
  sources: Iterable<RemoteToolSource>,
  context?: ToolExecutionContext,
): Promise<void> {
  const seen = createPrivateSet<RemoteToolSource>();
  const distinct: RemoteToolSource[] = [];
  for (const source of sources) {
    if (seen.has(source)) continue;
    seen.add(source);
    defineOwnDataProperty(distinct, distinct.length, source);
  }
  // Start every disposal before awaiting any, including through a source whose
  // dispose throws synchronously.
  const outcomes = await allPrivatePromises(
    mapPrivateArray(distinct, (source) =>
      chainPrivatePromise<void, DisposeOutcome>(
        chainPrivatePromise(resolvePrivatePromise(), () => source.dispose?.(context)),
        () => ({ failed: false }),
        (error) => ({ failed: true, error }),
      )),
  );
  for (const outcome of outcomes) {
    if (outcome.failed) throw outcome.error;
  }
}

/** Track sources created by a host lifecycle without taking ownership of injected sources. */
export function createRemoteToolSourceOwner() {
  const sources = createPrivateSet<RemoteToolSource>();
  let cleanup: Promise<void> | undefined;
  let closing = false;
  const dispose = (): Promise<void> => {
    closing = true;
    cleanup ??= (async () => {
      try {
        await disposeRemoteToolSources(sources);
      } finally {
        sources.clear();
      }
    })();
    return cleanup;
  };
  return {
    own(source: RemoteToolSource): RemoteToolSource {
      if (closing) throw new Error("Remote tool source owner is already closing");
      sources.add(source);
      return source;
    },
    dispose,
    async fail(error: unknown): Promise<never> {
      try {
        await dispose();
      } catch (cleanupError) {
        serverLogger.warn("Remote MCP cleanup failed after setup error", {
          errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
        });
      }
      throw error;
    },
  };
}
