import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/logger.ts";
import type { AgentContext, AgentResponse } from "#veryfront/agent/types.ts";

const context = {} as AgentContext;
const response = {} as AgentResponse;

function waitForReport(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1));
}

describe("agent middleware continuation Promise species", () => {
  it("tracks derived rejections when Promise species is not preserving", async () => {
    const nativeSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
    const records: LogEntry[] = [];
    const unhandled: PromiseRejectionEvent[] = [];
    let discardedBranch: Promise<AgentResponse> | undefined;
    let handledBranch: Promise<AgentResponse> | undefined;
    const onUnhandled = (event: PromiseRejectionEvent): void => {
      unhandled.push(event);
      event.preventDefault();
    };
    const unsubscribe = __subscribeLogRecordEmitter((entry) => records.push(entry));
    let speciesRestored = false;
    const restoreSpecies = (): void => {
      if (speciesRestored) return;
      if (nativeSpecies) {
        Object.defineProperty(Promise, Symbol.species, nativeSpecies);
      } else {
        Reflect.deleteProperty(Promise, Symbol.species);
      }
      speciesRestored = true;
    };

    globalThis.addEventListener("unhandledrejection", onUnhandled);
    try {
      Object.defineProperty(Promise, Symbol.species, {
        configurable: true,
        get: () => Promise,
      });
      const { MiddlewareChain: NonPreservingSpeciesChain } = await import(
        "#veryfront/agent/middleware/chain.ts?non-preserving-species"
      );
      await new NonPreservingSpeciesChain([
        (_context: AgentContext, next: () => Promise<AgentResponse>) => {
          discardedBranch = next().then(() => response);
          return Promise.resolve(response);
        },
      ]).execute(context, () => Promise.reject(new Error("species fallback failure")));
      await new NonPreservingSpeciesChain([
        (_context: AgentContext, next: () => Promise<AgentResponse>) => {
          handledBranch = next().then(() => response).catch(() => response);
          return Promise.resolve(response);
        },
      ]).execute(context, () => Promise.reject(new Error("handled species fallback failure")));
      restoreSpecies();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await waitForReport();
    } finally {
      restoreSpecies();
      globalThis.removeEventListener("unhandledrejection", onUnhandled);
      unsubscribe();
    }

    assertEquals(unhandled.length, 1);
    assertEquals(discardedBranch?.constructor, Promise);
    assertEquals(handledBranch?.constructor, Promise);
    assertEquals(
      records.filter((entry) => entry.message === "Your agent middleware continuation failed")
        .length,
      0,
    );
  });
});
