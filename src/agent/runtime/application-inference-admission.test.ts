import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
import { resolveAgentModelTransport } from "./model-transport.ts";
import {
  type ApplicationInferenceFinalizeStatus,
  getPrivateApplicationInferenceRuntimeOptions,
  runWithApplicationInferenceAdmission,
} from "./application-inference-admission.ts";

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
