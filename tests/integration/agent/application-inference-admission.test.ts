import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetVeryfrontCloudCatalogForTests,
} from "#veryfront/provider/veryfront-cloud/catalog-client.ts";
import { servedCatalogPayload } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { resetHostApiOriginSnapshot } from "#veryfront/platform/compat/process/env.ts";
import { clearModelProviders } from "#veryfront/provider/index.ts";
import {
  __runWithOutboundFetchTransportForTests,
  type OutboundFetchTransport,
} from "#veryfront/security/http/outbound-fetch.ts";
import { resolveAgentModelTransport } from "#veryfront/agent/runtime/model-transport.ts";
import {
  type ApplicationInferenceFinalizeStatus,
  getPrivateApplicationInferenceRuntimeOptions,
  type PrivateApplicationInferenceRuntime,
  runWithApplicationInferenceAdmission,
  runWithRetainedApplicationInferenceAdmission,
} from "#veryfront/agent/runtime/application-inference-admission.ts";

const RUN_ID = "run-application-inference-admission";
const INFERENCE_TOKEN = "private-application-inference-token";
const STUB_PINNED_ADDRESS = "192.0.2.1";

async function withRuntimeFetch<T>(
  fetch: typeof globalThis.fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const transport: OutboundFetchTransport = {
    fetch,
    pinnedFetch: (url, _addresses, init) => fetch(url, init),
    resolveHost: () => Promise.resolve([STUB_PINNED_ADDRESS]),
  };
  return await __runWithOutboundFetchTransportForTests(transport, fn, {
    allowedResolvedAddresses: [STUB_PINNED_ADDRESS],
  });
}

function resetRuntimeTestState(): void {
  clearModelProviders();
  __resetVeryfrontCloudCatalogForTests();
  resetHostApiOriginSnapshot();
}

function expiresIn(milliseconds: number): string {
  return new Date(Date.now() + milliseconds).toISOString();
}

function waitForSignalAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function admittedRuntime(input: {
  expiresAt?: string;
  signal?: AbortSignal;
  finalize?: (status: ApplicationInferenceFinalizeStatus) => Promise<void> | void;
} = {}) {
  resetHostApiOriginSnapshot();
  let admittedAgentId: string | undefined;
  const runtime = await runWithApplicationInferenceAdmission(async (agentId) => {
    admittedAgentId = agentId;
    return {
      runId: RUN_ID,
      inferenceToken: INFERENCE_TOKEN,
      expiresAt: input.expiresAt ?? expiresIn(60_000),
      finalize: input.finalize ?? (() => {}),
    };
  }, () => getPrivateApplicationInferenceRuntimeOptions("synthetic-agent", input.signal));

  assert(runtime, "admission must create a private inference runtime inside scope");
  assertEquals(admittedAgentId, "synthetic-agent");
  return runtime;
}

describe("application inference admission runtime", () => {
  afterEach(resetRuntimeTestState);

  it("returns undefined outside an application inference admission scope", async () => {
    const runtime = await getPrivateApplicationInferenceRuntimeOptions("synthetic-agent");

    assertEquals(runtime, undefined);
  });

  it("does not admit a detached task after the route scope settles", async () => {
    let admissions = 0;
    const timerDetached = Promise.withResolvers<PrivateApplicationInferenceRuntime | undefined>();
    const promiseDetached = Promise.withResolvers<PrivateApplicationInferenceRuntime | undefined>();
    const releasePromiseContinuation = Promise.withResolvers<void>();

    await runWithApplicationInferenceAdmission(async () => {
      admissions++;
      return {
        runId: RUN_ID,
        inferenceToken: INFERENCE_TOKEN,
        expiresAt: expiresIn(60_000),
        finalize: () => {},
      };
    }, () => {
      setTimeout(() => {
        void getPrivateApplicationInferenceRuntimeOptions("timer-detached-agent").then(
          timerDetached.resolve,
          timerDetached.reject,
        );
      }, 0);
      void releasePromiseContinuation.promise.then(() =>
        getPrivateApplicationInferenceRuntimeOptions("promise-detached-agent")
      ).then(
        promiseDetached.resolve,
        promiseDetached.reject,
      );
    });
    releasePromiseContinuation.resolve();

    assertEquals(await timerDetached.promise, undefined);
    assertEquals(await promiseDetached.promise, undefined);
    assertEquals(admissions, 0);
  });

  it("does not admit a detached task after a rejected route scope settles", async () => {
    let admissions = 0;
    const detached = Promise.withResolvers<PrivateApplicationInferenceRuntime | undefined>();
    const releaseContinuation = Promise.withResolvers<void>();

    await assertRejects(
      () =>
        runWithApplicationInferenceAdmission(async () => {
          admissions++;
          return {
            runId: RUN_ID,
            inferenceToken: INFERENCE_TOKEN,
            expiresAt: expiresIn(60_000),
            finalize: () => {},
          };
        }, () => {
          void releaseContinuation.promise.then(() =>
            getPrivateApplicationInferenceRuntimeOptions("rejected-detached-agent")
          ).then(detached.resolve, detached.reject);
          throw new Error("synthetic route failure");
        }),
      Error,
      "synthetic route failure",
    );
    releaseContinuation.resolve();

    assertEquals(await detached.promise, undefined);
    assertEquals(admissions, 0);
  });

  it("does not call the host when the root request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("already closed", "AbortError"));
    let admissions = 0;

    const runtime = await runWithApplicationInferenceAdmission(
      async () => {
        admissions++;
        return {
          runId: RUN_ID,
          inferenceToken: INFERENCE_TOKEN,
          expiresAt: expiresIn(60_000),
          finalize: () => {},
        };
      },
      () => getPrivateApplicationInferenceRuntimeOptions("aborted-root", controller.signal),
      controller.signal,
    );

    assertEquals(runtime, undefined);
    assertEquals(admissions, 0);
  });

  it("cancels a pending root admission that resolves after the route scope settles", async () => {
    const pending = Promise.withResolvers<{
      runId: string;
      inferenceToken: string;
      expiresAt: string;
      finalize: (status: ApplicationInferenceFinalizeStatus) => void;
    }>();
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    let runtimePromise: Promise<PrivateApplicationInferenceRuntime | undefined> | undefined;
    let admissions = 0;

    await runWithApplicationInferenceAdmission(() => {
      admissions++;
      return pending.promise;
    }, () => {
      runtimePromise = getPrivateApplicationInferenceRuntimeOptions("pending-root");
    });

    pending.resolve({
      runId: RUN_ID,
      inferenceToken: INFERENCE_TOKEN,
      expiresAt: expiresIn(60_000),
      finalize: (status) => finalizations.push(status),
    });

    assert(runtimePromise, "pending root runtime request must be started");
    assertEquals(await runtimePromise, undefined);
    assertEquals(admissions, 1);
    assertEquals(finalizations, ["cancelled"]);
  });

  it("cancels a pending root admission when the caller aborts before it resolves", async () => {
    const controller = new AbortController();
    const pending = Promise.withResolvers<{
      runId: string;
      inferenceToken: string;
      expiresAt: string;
      finalize: (status: ApplicationInferenceFinalizeStatus) => void;
    }>();
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    let runtimePromise: Promise<PrivateApplicationInferenceRuntime | undefined> | undefined;
    let admissions = 0;

    await runWithApplicationInferenceAdmission(() => {
      admissions++;
      return pending.promise;
    }, () => {
      runtimePromise = getPrivateApplicationInferenceRuntimeOptions(
        "pending-aborted-root",
        controller.signal,
      );
      controller.abort(new DOMException("client closed", "AbortError"));
    }, controller.signal);

    pending.resolve({
      runId: RUN_ID,
      inferenceToken: INFERENCE_TOKEN,
      expiresAt: expiresIn(60_000),
      finalize: (status) => finalizations.push(status),
    });

    assert(runtimePromise, "pending aborted runtime request must be started");
    assertEquals(await runtimePromise, undefined);
    assertEquals(admissions, 1);
    assertEquals(finalizations, ["cancelled"]);
  });

  it("keeps retained producer child admission after root return while detached root tasks fail", async () => {
    const release = Promise.withResolvers<void>();
    const detached = Promise.withResolvers<PrivateApplicationInferenceRuntime | undefined>();
    let childRuntimePromise: Promise<PrivateApplicationInferenceRuntime | undefined> | undefined;
    const admittedAgents: string[] = [];

    const rootRuntime = await runWithApplicationInferenceAdmission(async (agentId) => {
      admittedAgents.push(agentId);
      return {
        runId: `${RUN_ID}-${agentId}`,
        inferenceToken: `${INFERENCE_TOKEN}-${agentId}`,
        expiresAt: expiresIn(60_000),
        finalize: () => {},
      };
    }, async () => {
      const root = await getPrivateApplicationInferenceRuntimeOptions("root-agent");
      assert(root, "root admission must be available during route execution");
      childRuntimePromise = runWithRetainedApplicationInferenceAdmission(
        root,
        () =>
          release.promise.then(() => getPrivateApplicationInferenceRuntimeOptions("child-agent")),
      );
      void release.promise.then(() =>
        getPrivateApplicationInferenceRuntimeOptions("detached-root-agent")
      )
        .then(detached.resolve, detached.reject);
      return root;
    });

    assert(rootRuntime, "root runtime must be returned");
    release.resolve();

    assert(childRuntimePromise, "child runtime request must be started under retained scope");
    const child = await childRuntimePromise;
    assert(child, "retained producer scope must allow child admission after route return");
    assertEquals(await detached.promise, undefined);
    assertEquals(admittedAgents, ["root-agent", "child-agent"]);
    child.finish("completed");
    rootRuntime.finish("completed");
  });

  it("does not fall back to an ambient admission scope after a retained runtime closes", async () => {
    const runtime = await admittedRuntime();
    runtime.finish("completed");
    let admissions = 0;

    const retained = await runWithApplicationInferenceAdmission(async () => {
      admissions++;
      return {
        runId: "unexpected-root-admission",
        inferenceToken: INFERENCE_TOKEN,
        expiresAt: expiresIn(60_000),
        finalize: () => {},
      };
    }, () =>
      runWithRetainedApplicationInferenceAdmission(
        runtime,
        () => getPrivateApplicationInferenceRuntimeOptions("child-after-parent-close"),
      ));

    assertEquals(retained, undefined);
    assertEquals(admissions, 0);
  });

  it("does not admit from retained scope after parent completion, cancellation, failure, or expiry", async () => {
    for (const status of ["completed", "failed", "cancelled"] as const) {
      const runtime = await admittedRuntime();
      runtime.finish(status);
      let admissions = 0;

      const retained = await runWithApplicationInferenceAdmission(async () => {
        admissions++;
        return {
          runId: `unexpected-${status}`,
          inferenceToken: INFERENCE_TOKEN,
          expiresAt: expiresIn(60_000),
          finalize: () => {},
        };
      }, () =>
        runWithRetainedApplicationInferenceAdmission(
          runtime,
          () => getPrivateApplicationInferenceRuntimeOptions(`child-after-${status}`),
        ));

      assertEquals(retained, undefined, status);
      assertEquals(admissions, 0, status);
    }

    const expired = await admittedRuntime({ expiresAt: expiresIn(-1) });
    let admissions = 0;
    const retained = await runWithApplicationInferenceAdmission(async () => {
      admissions++;
      return {
        runId: "unexpected-expired",
        inferenceToken: INFERENCE_TOKEN,
        expiresAt: expiresIn(60_000),
        finalize: () => {},
      };
    }, () =>
      runWithRetainedApplicationInferenceAdmission(
        expired,
        () => getPrivateApplicationInferenceRuntimeOptions("child-after-expiry"),
      ));

    assertEquals(retained, undefined, "expired");
    assertEquals(admissions, 0, "expired");
  });

  it("cancels a pending retained child admission when the parent expires before host response", async () => {
    const childAdmission = Promise.withResolvers<{
      runId: string;
      inferenceToken: string;
      expiresAt: string;
      finalize: (status: ApplicationInferenceFinalizeStatus) => void;
    }>();
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    const admittedAgents: string[] = [];

    const rootRuntime = await runWithApplicationInferenceAdmission(async (agentId) => {
      admittedAgents.push(agentId);
      if (agentId === "child-after-parent-expiry") return childAdmission.promise;
      return {
        runId: `${RUN_ID}-${agentId}`,
        inferenceToken: `${INFERENCE_TOKEN}-${agentId}`,
        expiresAt: expiresIn(1_000),
        finalize: () => {},
      };
    }, () => getPrivateApplicationInferenceRuntimeOptions("parent-short-lived"));
    assert(rootRuntime, "parent admission must be created before expiry");

    const childRuntime = runWithRetainedApplicationInferenceAdmission(
      rootRuntime,
      () => getPrivateApplicationInferenceRuntimeOptions("child-after-parent-expiry"),
    );
    await waitForSignalAbort(rootRuntime.signal);
    childAdmission.resolve({
      runId: `${RUN_ID}-child`,
      inferenceToken: `${INFERENCE_TOKEN}-child`,
      expiresAt: expiresIn(60_000),
      finalize: (status) => finalizations.push(status),
    });

    assertEquals(await childRuntime, undefined);
    assertEquals(admittedAgents, ["parent-short-lived", "child-after-parent-expiry"]);
    assertEquals(finalizations, ["cancelled"]);
  });

  it("finalizes a completed run exactly once", async () => {
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    const runtime = await admittedRuntime({
      finalize: (status) => {
        finalizations.push(status);
      },
    });

    runtime.finish("completed");
    runtime.finish("failed");

    assertEquals(finalizations, ["completed"]);
    assertEquals(runtime.signal.aborted, true);
  });

  it("does not expose the private runtime to inherited then accessors", async () => {
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, "then");
    let capturedRuntime: unknown;
    Object.defineProperty(Object.prototype, "then", {
      configurable: true,
      get() {
        if (Object.hasOwn(this, "runtimeOptions")) capturedRuntime = this;
        return undefined;
      },
    });
    try {
      const runtime = await admittedRuntime();

      assertEquals(capturedRuntime, undefined);
      assertEquals(Object.getPrototypeOf(runtime), null);
      assertEquals(Object.hasOwn(runtime, "then"), true);
      assertEquals(Reflect.get(runtime, "then"), undefined);
      runtime.finish("completed");
    } finally {
      if (originalThen) Object.defineProperty(Object.prototype, "then", originalThen);
      else Reflect.deleteProperty(Object.prototype, "then");
    }
  });

  it("finalizes a caller-aborted run as cancelled", async () => {
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    const controller = new AbortController();
    const runtime = await admittedRuntime({
      signal: controller.signal,
      finalize: (status) => {
        finalizations.push(status);
      },
    });

    controller.abort(new DOMException("client disconnected", "AbortError"));

    assertEquals(finalizations, ["cancelled"]);
    assertEquals(runtime.signal.aborted, true);
  });

  it("revokes private model authority after finalization", async () => {
    const runtime = await admittedRuntime();
    const resolver = runtime.runtimeOptions.resolveModelRuntime;
    assert(resolver, "admitted runtime must expose a private model resolver");
    assert(resolver("local/synthetic") === undefined);
    assert(resolver("veryfront-cloud/openai/gpt-5.5") !== undefined);

    runtime.finish("completed");

    assertThrows(
      () => resolver("veryfront-cloud/openai/gpt-5.5"),
      TypeError,
      "Application inference credential is no longer active",
    );
  });

  it("refuses private model authority when the admission credential is expired", async () => {
    const runtime = await admittedRuntime({ expiresAt: expiresIn(-1) });
    const resolver = runtime.runtimeOptions.resolveModelRuntime;
    assert(resolver, "admitted runtime must expose a private model resolver");

    assertThrows(
      () => resolver("veryfront-cloud/openai/gpt-5.5"),
      TypeError,
      "Application inference credential is no longer active",
    );
    assertEquals(runtime.signal.aborted, true);
  });

  it("loads the private catalog with the admitted inference credential", async () => {
    const catalogCredentials: string[] = [];
    const runtime = await admittedRuntime();
    await withRuntimeFetch(async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/ai/models") {
        catalogCredentials.push(request.headers.get("authorization") ?? "");
        return Response.json(servedCatalogPayload());
      }
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    }, async () => {
      await runtime.prepareAgent(() => "prepared");
    });

    assertEquals(catalogCredentials, [`Bearer ${INFERENCE_TOKEN}`]);
    runtime.finish("completed");
  });

  it("resolves the automatic model through the admitted private catalog", async () => {
    const runtime = await admittedRuntime();
    await withRuntimeFetch(async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname === "/ai/models") {
        return Response.json(servedCatalogPayload());
      }
      throw new Error(`Unexpected request ${request.method} ${request.url}`);
    }, async () => {
      const transport = await resolveAgentModelTransport({
        agentId: "synthetic-agent",
        config: { model: "auto", system: "Synthetic system." },
        context: undefined,
        modelOverride: undefined,
        mode: "stream",
        resolveModelRuntime: runtime.runtimeOptions.resolveModelRuntime,
      });

      assertEquals(transport.requestedModel, "veryfront-cloud/mistral/mistral-small-2503");
      assertEquals(transport.resolvedModelString, "veryfront-cloud/mistral/mistral-small-2503");
    });
    runtime.finish("completed");
  });

  it("finalizes a failed stream completion as failed", async () => {
    const finalizations: ApplicationInferenceFinalizeStatus[] = [];
    const finalized = Promise.withResolvers<void>();
    const runtime = await admittedRuntime({
      finalize: (status) => {
        finalizations.push(status);
        finalized.resolve();
      },
    });

    runtime.runtimeOptions.onStreamCompletion?.(Promise.reject(new Error("synthetic failure")));
    await finalized.promise;

    assertEquals(finalizations, ["failed"]);
  });
});
