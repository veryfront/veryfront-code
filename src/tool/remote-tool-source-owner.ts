import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { serverLogger } from "#veryfront/utils";
import type { RemoteToolSource } from "./types.ts";

/** Track sources created by a host lifecycle without taking ownership of injected sources. */
export function createRemoteToolSourceOwner() {
  const sources = createPrivateSet<RemoteToolSource>();
  let cleanup: Promise<void> | undefined;
  let closing = false;
  const dispose = (): Promise<void> => {
    closing = true;
    cleanup ??= (async () => {
      let firstError: unknown;
      let failed = false;
      for (const source of sources) {
        try {
          await source.dispose?.();
        } catch (error) {
          if (!failed) firstError = error;
          failed = true;
        }
      }
      sources.clear();
      if (failed) throw firstError;
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
