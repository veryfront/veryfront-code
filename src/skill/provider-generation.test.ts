import { reset, tryResolve } from "#veryfront/extensions/contracts.ts";
import { ExtensionLoader } from "#veryfront/extensions/loader.ts";
import {
  type SkillScriptExecutionReporter,
  type SkillScriptExecutorProvider,
  SkillScriptExecutorProviderName,
} from "#veryfront/extensions/skill/script-executor-provider.ts";
import type { Extension, ExtensionLogger, ResolvedExtension } from "#veryfront/extensions/types.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { createSkillOperationBudget } from "./operation-budget.ts";
import {
  executeSkillScriptWithProvider,
  resolveSkillScriptExecutionBackend,
  type SkillScriptExecutionBackend,
} from "./provider-executor.ts";
import type { SkillScriptResult } from "./types.ts";

type Settlement<T> =
  | { readonly kind: "fulfilled"; readonly value: T }
  | { readonly kind: "rejected"; readonly reason: unknown }
  | { readonly kind: "pending" };

const noopLogger: ExtensionLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function resolvedExtension(extension: Extension): ResolvedExtension {
  return {
    extension,
    source: "config",
    origin: "test",
  };
}

function providerExtension(
  name: string,
  provider: SkillScriptExecutorProvider,
  teardown?: () => void | Promise<void>,
): ResolvedExtension {
  return resolvedExtension({
    name,
    version: "1.0.0",
    capabilities: [],
    contracts: { provides: [SkillScriptExecutorProviderName] },
    setup(context) {
      context.provide(SkillScriptExecutorProviderName, provider);
    },
    teardown,
  });
}

function executeProviderBackend(
  backend: Readonly<SkillScriptExecutionBackend>,
  timeoutMs = 1_000,
  terminationGraceMs?: number,
): Promise<Readonly<SkillScriptResult>> {
  if (backend.kind !== "provider") {
    throw new Error("Expected a Skill provider backend");
  }
  return executeSkillScriptWithProvider(
    backend.provider,
    { scriptPath: "/skills/demo/scripts/run.ts" },
    createSkillOperationBudget({ timeoutMs }),
    backend.contractReference,
    terminationGraceMs,
  );
}

async function settleWithin<T>(
  promise: Promise<T>,
  timeoutMs = 20,
): Promise<Settlement<T>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(
        (value): Settlement<T> => ({ kind: "fulfilled", value }),
        (reason: unknown): Settlement<T> => ({ kind: "rejected", reason }),
      ),
      new Promise<Settlement<T>>((resolve) => {
        timeoutId = setTimeout(() => resolve({ kind: "pending" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

Deno.test("loader-owned Skill backend cannot start after its generation retires", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  let prepareCalls = 0;
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      prepareCalls += 1;
      return {
        activate() {
          reporter.resolveResult({ stdout: "stale", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };

  try {
    await loader.setupAll(
      [providerExtension("stale-provider", provider)],
      {},
    );
    const staleBackend = resolveSkillScriptExecutionBackend();
    await loader.teardownAll();

    await assertRejects(
      () => executeProviderBackend(staleBackend),
      Error,
      "captured generation is no longer active",
    );
    assertEquals(prepareCalls, 0);
  } finally {
    try {
      await loader.teardownAll();
    } catch {
      // Best-effort cleanup for the primary assertion.
    }
    reset();
  }
});

Deno.test("Skill resolution closes as soon as replacement staging begins", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const stagingStarted = Promise.withResolvers<void>();
  const continueReplacement = Promise.withResolvers<void>();
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "unexpected", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  let replacement: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [providerExtension("first-provider", provider)],
      {},
    );
    replacement = loader.setupAll(
      [providerExtension("second-provider", provider)],
      {},
      {
        beforeActivate: async () => {
          stagingStarted.resolve();
          await continueReplacement.promise;
        },
      },
    );

    await stagingStarted.promise;
    assertThrows(
      () => resolveSkillScriptExecutionBackend(),
      Error,
      "generation is staging",
    );
  } finally {
    continueReplacement.resolve();
    if (replacement) {
      try {
        await replacement;
      } catch {
        // Preserve the primary assertion.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("captured Skill backend cannot start after replacement staging begins", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const stagingStarted = Promise.withResolvers<void>();
  const continueReplacement = Promise.withResolvers<void>();
  let prepareCalls = 0;
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      prepareCalls += 1;
      return {
        activate() {
          reporter.resolveResult({ stdout: "unexpected", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  let replacement: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [providerExtension("first-provider", provider)],
      {},
    );
    const capturedBackend = resolveSkillScriptExecutionBackend();
    replacement = loader.setupAll(
      [providerExtension("second-provider", provider)],
      {},
      {
        beforeActivate: async () => {
          stagingStarted.resolve();
          await continueReplacement.promise;
        },
      },
    );

    await stagingStarted.promise;
    await assertRejects(
      () => executeProviderBackend(capturedBackend),
      Error,
      "generation is staging",
    );
    assertEquals(prepareCalls, 0);
  } finally {
    continueReplacement.resolve();
    if (replacement) {
      try {
        await replacement;
      } catch {
        // Preserve the primary assertion.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("Skill execution drains before provider-generation replacement", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const terminationStarted = Promise.withResolvers<void>();
  const order: string[] = [];
  let firstReporter: Readonly<SkillScriptExecutionReporter> | undefined;
  const firstProvider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      firstReporter = reporter;
      return {
        activate() {
          order.push("first:activate");
        },
        terminate(reason) {
          order.push("first:terminate");
          reporter.rejectResult(reason);
          terminationStarted.resolve();
        },
      };
    },
  };
  const secondProvider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "second", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  let firstExecution: Promise<Readonly<SkillScriptResult>> | undefined;
  let replacement: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [
        providerExtension("first-provider", firstProvider, () => {
          order.push("first:teardown");
        }),
      ],
      {},
    );
    firstExecution = executeProviderBackend(resolveSkillScriptExecutionBackend());
    replacement = loader.setupAll(
      [
        providerExtension("second-provider", secondProvider, () => {
          order.push("second:teardown");
        }),
      ],
      {},
    );

    await terminationStarted.promise;
    assertEquals((await settleWithin(replacement)).kind, "pending");
    assertThrows(
      () => resolveSkillScriptExecutionBackend(),
      Error,
      "generation is retiring",
    );
    assertEquals(order, ["first:activate", "first:terminate"]);

    order.push("first:terminal");
    firstReporter?.resolveTerminal();
    await assertRejects(() => firstExecution!, Error);
    await replacement;
    assertEquals(order, [
      "first:activate",
      "first:terminate",
      "first:terminal",
      "first:teardown",
    ]);
    assertEquals(
      (await executeProviderBackend(resolveSkillScriptExecutionBackend())).stdout,
      "second",
    );
  } finally {
    firstReporter?.rejectResult(new Error("test cleanup"));
    firstReporter?.resolveTerminal();
    if (firstExecution) {
      try {
        await firstExecution;
      } catch {
        // Expected after retirement.
      }
    }
    if (replacement) {
      try {
        await replacement;
      } catch {
        // Preserve the primary assertion.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("unsettled Skill cleanup quarantines replacement until late terminal settlement", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const terminationStarted = Promise.withResolvers<void>();
  let firstReporter: Readonly<SkillScriptExecutionReporter> | undefined;
  let firstTeardownCalls = 0;
  const firstProvider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      firstReporter = reporter;
      return {
        activate() {},
        terminate(reason) {
          reporter.rejectResult(reason);
          terminationStarted.resolve();
        },
      };
    },
  };
  const secondProvider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "second", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  let execution: Promise<Readonly<SkillScriptResult>> | undefined;
  let replacement: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [
        providerExtension("unsettled-provider", firstProvider, () => {
          firstTeardownCalls += 1;
        }),
      ],
      {},
    );
    execution = executeProviderBackend(
      resolveSkillScriptExecutionBackend(),
      1_000,
      10,
    );
    const executionSettlementPromise = settleWithin(execution, 60);
    replacement = loader.setupAll(
      [providerExtension("replacement-provider", secondProvider)],
      {},
    );
    const replacementSettlementPromise = settleWithin(replacement, 60);

    await terminationStarted.promise;
    const replacementSettlement = await replacementSettlementPromise;
    assertEquals(replacementSettlement.kind, "rejected");
    assertEquals(
      replacementSettlement.kind === "rejected" &&
        replacementSettlement.reason instanceof Error &&
        replacementSettlement.reason.message.includes("quarantined"),
      true,
    );
    assertEquals((await executionSettlementPromise).kind, "rejected");
    assertEquals(firstTeardownCalls, 0);
    assertThrows(
      () => resolveSkillScriptExecutionBackend(),
      Error,
      "generation is retiring",
    );

    firstReporter?.resolveTerminal();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await loader.teardownAll();
    await loader.setupAll(
      [providerExtension("replacement-provider", secondProvider)],
      {},
    );
    assertEquals(firstTeardownCalls, 1);
    assertEquals(
      (await executeProviderBackend(resolveSkillScriptExecutionBackend())).stdout,
      "second",
    );
  } finally {
    firstReporter?.resolveTerminal();
    if (execution) {
      try {
        await execution;
      } catch {
        // Expected after retirement.
      }
    }
    if (replacement) {
      try {
        await replacement;
      } catch {
        // Expected while the old generation is quarantined.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("completed Skill execution survives immediate generation teardown", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  let providerTerminationCalls = 0;
  let extensionTeardownCalls = 0;
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "complete", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate() {
          providerTerminationCalls += 1;
        },
      };
    },
  };

  try {
    await loader.setupAll(
      [
        providerExtension("synchronous-provider", provider, () => {
          extensionTeardownCalls += 1;
        }),
      ],
      {},
    );
    const execution = executeProviderBackend(resolveSkillScriptExecutionBackend());
    const teardown = loader.teardownAll();

    assertEquals((await execution).stdout, "complete");
    await teardown;
    assertEquals(providerTerminationCalls, 0);
    assertEquals(extensionTeardownCalls, 1);
  } finally {
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("extension context abort cannot admit Skill work after generation sealing", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  let prepareCalls = 0;
  let abortResolutionFailure: unknown;
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      prepareCalls += 1;
      return {
        activate() {
          reporter.resolveResult({ stdout: "unexpected", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  const extension = resolvedExtension({
    name: "abort-race-provider",
    version: "1.0.0",
    capabilities: [],
    contracts: { provides: [SkillScriptExecutorProviderName] },
    setup(context) {
      context.provide(SkillScriptExecutorProviderName, provider);
      const signal = context.signal;
      if (signal === undefined) {
        throw new Error("Expected an extension lifecycle signal");
      }
      signal.addEventListener("abort", () => {
        try {
          const backend = resolveSkillScriptExecutionBackend();
          void executeProviderBackend(backend);
        } catch (error) {
          abortResolutionFailure = error;
        }
      }, { once: true });
    },
  });

  try {
    await loader.setupAll([extension], {});
    await loader.teardownAll();
    assertEquals(abortResolutionFailure instanceof Error, true);
    assertEquals(
      abortResolutionFailure instanceof Error
        ? abortResolutionFailure.message.includes("generation is retiring")
        : false,
      true,
    );
    assertEquals(prepareCalls, 0);
  } finally {
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("failed staged Skill provider stays unavailable until a successful commit", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          reporter.resolveResult({ stdout: "recovered", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };
  const failing = resolvedExtension({
    name: "failing-provider",
    version: "1.0.0",
    capabilities: [],
    contracts: { provides: [SkillScriptExecutorProviderName] },
    setup(context) {
      context.provide(SkillScriptExecutorProviderName, provider);
      throw new Error("candidate setup failed");
    },
  });

  try {
    await assertRejects(
      () => loader.setupAll([failing], {}),
      Error,
      "candidate setup failed",
    );
    assertEquals(tryResolve(SkillScriptExecutorProviderName), undefined);
    assertThrows(
      () => resolveSkillScriptExecutionBackend(),
      Error,
      "previous generation failed",
    );

    await loader.setupAll(
      [providerExtension("recovered-provider", provider)],
      {},
    );
    assertEquals(
      (await executeProviderBackend(resolveSkillScriptExecutionBackend())).stdout,
      "recovered",
    );
  } finally {
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("synchronous Skill provider prepare failure releases its generation lease", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const provider: SkillScriptExecutorProvider = {
    prepare() {
      throw new Error("prepare failed");
    },
  };

  try {
    await loader.setupAll(
      [providerExtension("throwing-provider", provider)],
      {},
    );
    await assertRejects(
      () => executeProviderBackend(resolveSkillScriptExecutionBackend()),
      Error,
      "prepare failed",
    );
    assertEquals((await settleWithin(loader.teardownAll())).kind, "fulfilled");
  } finally {
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("Skill generation lease release ignores post-activation Set prototype mutation", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const originalDeleteDescriptor = Object.getOwnPropertyDescriptor(
    Set.prototype,
    "delete",
  );
  if (originalDeleteDescriptor === undefined) {
    throw new Error("Expected Set.prototype.delete");
  }
  let deleteHookInstalled = false;
  const restoreDelete = (): void => {
    if (!deleteHookInstalled) return;
    Object.defineProperty(Set.prototype, "delete", originalDeleteDescriptor);
    deleteHookInstalled = false;
  };
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, reporter) {
      return {
        activate() {
          Object.defineProperty(Set.prototype, "delete", {
            ...originalDeleteDescriptor,
            value() {
              throw new Error("post-activation Set.delete hook ran");
            },
          });
          deleteHookInstalled = true;
          reporter.resolveResult({ stdout: "complete", stderr: "", exitCode: 0 });
          reporter.resolveTerminal();
        },
        terminate(reason) {
          reporter.rejectResult(reason);
          reporter.resolveTerminal();
        },
      };
    },
  };

  try {
    await loader.setupAll(
      [providerExtension("set-mutation-provider", provider)],
      {},
    );
    const result = await executeProviderBackend(resolveSkillScriptExecutionBackend());
    restoreDelete();

    assertEquals(result.stdout, "complete");
    assertEquals((await settleWithin(loader.teardownAll())).kind, "fulfilled");
  } finally {
    restoreDelete();
    reset();
  }
});

Deno.test("Skill generation drain ignores retirement-time Promise prototype mutation", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const terminationStarted = Promise.withResolvers<void>();
  const originalThenDescriptor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "then",
  );
  if (originalThenDescriptor === undefined) {
    throw new Error("Expected Promise.prototype.then");
  }
  let thenHookInstalled = false;
  const restoreThen = (): void => {
    if (!thenHookInstalled) return;
    Object.defineProperty(Promise.prototype, "then", originalThenDescriptor);
    thenHookInstalled = false;
  };
  let reporter: Readonly<SkillScriptExecutionReporter> | undefined;
  let teardownCalls = 0;
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, executionReporter) {
      reporter = executionReporter;
      return {
        activate() {},
        terminate(reason) {
          executionReporter.rejectResult(reason);
          terminationStarted.resolve();
          Object.defineProperty(Promise.prototype, "then", {
            ...originalThenDescriptor,
            value() {
              throw new Error("retirement-time Promise.then hook ran");
            },
          });
          thenHookInstalled = true;
          queueMicrotask(restoreThen);
        },
      };
    },
  };
  let execution: Promise<Readonly<SkillScriptResult>> | undefined;
  let teardown: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [
        providerExtension("promise-mutation-provider", provider, () => {
          teardownCalls += 1;
        }),
      ],
      {},
    );
    execution = executeProviderBackend(resolveSkillScriptExecutionBackend());
    teardown = loader.teardownAll();

    await terminationStarted.promise;
    await Promise.resolve();
    assertEquals(teardownCalls, 0);
    assertEquals((await settleWithin(teardown)).kind, "pending");

    reporter?.resolveTerminal();
    await assertRejects(() => execution!, Error);
    await teardown;
    assertEquals(teardownCalls, 1);
  } finally {
    restoreThen();
    reporter?.resolveTerminal();
    if (execution) {
      try {
        await execution;
      } catch {
        // Expected after generation retirement.
      }
    }
    if (teardown) {
      try {
        await teardown;
      } catch {
        // Preserve the primary assertion.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("Skill generation teardown ignores Promise hooks installed during activation", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const originalThenDescriptor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "then",
  );
  const originalConstructorDescriptor = Object.getOwnPropertyDescriptor(
    Promise.prototype,
    "constructor",
  );
  const originalSpeciesDescriptor = Object.getOwnPropertyDescriptor(
    Promise,
    Symbol.species,
  );
  if (
    originalThenDescriptor === undefined ||
    originalConstructorDescriptor === undefined ||
    originalSpeciesDescriptor === undefined
  ) {
    throw new Error("Expected intrinsic Promise descriptors");
  }

  let hooksInstalled = false;
  let hookCalls = 0;
  let terminationCalls = 0;
  let teardownCalls = 0;
  let reporter: Readonly<SkillScriptExecutionReporter> | undefined;
  const restorePromiseHooks = (): void => {
    if (!hooksInstalled) return;
    Object.defineProperty(Promise.prototype, "then", originalThenDescriptor);
    Object.defineProperty(
      Promise.prototype,
      "constructor",
      originalConstructorDescriptor,
    );
    Object.defineProperty(Promise, Symbol.species, originalSpeciesDescriptor);
    hooksInstalled = false;
  };
  const throwingAccessorDescriptor = (): PropertyDescriptor => {
    const descriptor = Object.create(null) as PropertyDescriptor;
    descriptor.configurable = true;
    descriptor.get = () => {
      hookCalls += 1;
      throw new Error("post-activation Promise hook ran");
    };
    return descriptor;
  };
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, executionReporter) {
      reporter = executionReporter;
      return {
        activate() {
          Object.defineProperty(
            Promise,
            Symbol.species,
            throwingAccessorDescriptor(),
          );
          Object.defineProperty(
            Promise.prototype,
            "constructor",
            throwingAccessorDescriptor(),
          );
          Object.defineProperty(
            Promise.prototype,
            "then",
            throwingAccessorDescriptor(),
          );
          hooksInstalled = true;
        },
        terminate(reason) {
          terminationCalls += 1;
          restorePromiseHooks();
          executionReporter.rejectResult(reason);
          executionReporter.resolveTerminal();
        },
      };
    },
  };
  let execution: Promise<Readonly<SkillScriptResult>> | undefined;
  let teardown: Promise<void> | undefined;

  try {
    await loader.setupAll(
      [
        providerExtension("activation-promise-hook-provider", provider, () => {
          teardownCalls += 1;
        }),
      ],
      {},
    );
    execution = executeProviderBackend(resolveSkillScriptExecutionBackend());
    teardown = loader.teardownAll();

    await teardown;
    await assertRejects(() => execution!, Error);
    assertEquals(hookCalls, 0);
    assertEquals(terminationCalls, 1);
    assertEquals(teardownCalls, 1);
  } finally {
    restorePromiseHooks();
    reporter?.rejectResult(new Error("test cleanup"));
    reporter?.resolveTerminal();
    if (execution) {
      try {
        await execution;
      } catch {
        // Expected after generation retirement or test cleanup.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});

Deno.test("Skill generation teardown drains before consulting a mutated Array iterator", async () => {
  reset();
  const loader = new ExtensionLoader(noopLogger);
  const originalIteratorDescriptor = Object.getOwnPropertyDescriptor(
    Array.prototype,
    Symbol.iterator,
  );
  if (originalIteratorDescriptor === undefined) {
    throw new Error("Expected Array.prototype[Symbol.iterator]");
  }

  let iteratorHookInstalled = false;
  let iteratorHookCalls = 0;
  let terminationCalls = 0;
  let teardownCalls = 0;
  let reporter: Readonly<SkillScriptExecutionReporter> | undefined;
  const restoreArrayIterator = (): void => {
    if (!iteratorHookInstalled) return;
    Object.defineProperty(
      Array.prototype,
      Symbol.iterator,
      originalIteratorDescriptor,
    );
    iteratorHookInstalled = false;
  };
  const provider: SkillScriptExecutorProvider = {
    prepare(_input, executionReporter) {
      reporter = executionReporter;
      return {
        activate() {
          const descriptor = Object.create(null) as PropertyDescriptor;
          descriptor.configurable = true;
          descriptor.get = () => {
            iteratorHookCalls += 1;
            throw new Error("post-activation Array iterator hook ran");
          };
          Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
          iteratorHookInstalled = true;
        },
        terminate(reason) {
          terminationCalls += 1;
          restoreArrayIterator();
          executionReporter.rejectResult(reason);
          executionReporter.resolveTerminal();
        },
      };
    },
  };
  let execution: Promise<Readonly<SkillScriptResult>> | undefined;

  try {
    await loader.setupAll(
      [
        providerExtension("activation-array-hook-provider", provider, () => {
          teardownCalls += 1;
        }),
      ],
      {},
    );
    execution = executeProviderBackend(resolveSkillScriptExecutionBackend());

    await loader.teardownAll();
    await assertRejects(() => execution!, Error);
    assertEquals(iteratorHookCalls, 0);
    assertEquals(terminationCalls, 1);
    assertEquals(teardownCalls, 1);
  } finally {
    restoreArrayIterator();
    reporter?.rejectResult(new Error("test cleanup"));
    reporter?.resolveTerminal();
    if (execution) {
      try {
        await execution;
      } catch {
        // Expected after generation retirement or test cleanup.
      }
    }
    try {
      await loader.teardownAll();
    } catch {
      // Preserve the primary assertion.
    }
    reset();
  }
});
