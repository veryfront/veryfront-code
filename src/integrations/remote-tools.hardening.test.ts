import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  __subscribeLogRecordEmitter,
  type LogEntry,
  LogLevel,
  refreshLoggerConfig,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
  MAX_INTEGRATION_CALL_REQUEST_BYTES,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
  MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS,
  MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES,
  MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH,
} from "./limits.ts";
import {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  getRemoteIntegrationToolDiscovery,
} from "./remote-tools.ts";

const ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));
const encoder = new TextEncoder();

function requestSignalFromInit(init: unknown): AbortSignal | undefined {
  if (typeof init !== "object" || init === null) return undefined;
  const signal = (init as { signal?: unknown }).signal;
  return signal instanceof AbortSignal ? signal : undefined;
}

function restoreRemoteToolEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }
  refreshEnvironmentConfig();
}

function configureRemoteTools(): void {
  for (const key of ENV_KEYS) deleteEnv(key);
  setEnv("VERYFRONT_API_BASE_URL", "https://api.test");
  setEnv("VERYFRONT_API_TOKEN", "environment-token");
  refreshEnvironmentConfig();
}

async function captureRejection(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  return new Error("Expected operation to reject");
}

function rejectFetchWhenAborted(
  signal: AbortSignal | null | undefined,
  started?: PromiseWithResolvers<void>,
): Promise<Response> {
  if (!(signal instanceof AbortSignal)) {
    return Promise.reject(new TypeError("Expected integration request signal"));
  }
  started?.resolve();
  return new Promise<Response>((_resolve, reject) => {
    const rejectWithReason = () => reject(signal.reason);
    signal.addEventListener("abort", rejectWithReason, { once: true });
    if (signal.aborted) rejectWithReason();
  });
}

function createOpenByteResponse(
  bytes: Uint8Array,
  options: ResponseInit = {},
): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        cancelled = true;
      },
    }),
    options,
  );
  return { response, wasCancelled: () => cancelled };
}

function createPendingBodyResponse(
  started: PromiseWithResolvers<void>,
): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull() {
        started.resolve();
        return new Promise<void>(() => {});
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 }),
  );
  return { response, wasCancelled: () => cancelled };
}

function createToolDefinition(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "github__list_repos",
    description: "List repositories",
    inputSchema: { type: "object", properties: {} },
    ...overrides,
  };
}

function createSchemaAtDepth(depth: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: "string" };
  for (let index = 0; index < depth; index++) {
    schema = { items: schema };
  }
  return schema;
}

afterEach(() => {
  restoreRemoteToolEnv();
});

describe("integrations/remote-tools hardening", () => {
  it("rejects pre-aborted discovery and execution without dispatching", async () => {
    configureRemoteTools();
    const caller = new AbortController();
    const reason = new DOMException("caller stopped", "AbortError");
    caller.abort(reason);
    let fetchCalls = 0;

    const errors = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ tools: [] });
      },
      async () => ({
        discovery: await captureRejection(() =>
          getRemoteIntegrationToolDefinitions({ abortSignal: caller.signal })
        ),
        execution: await captureRejection(() =>
          executeRemoteIntegrationTool(
            "github__list_repos",
            {},
            { abortSignal: caller.signal },
          )
        ),
      }),
    );

    assertEquals(fetchCalls, 0);
    assertStrictEquals(errors.discovery, reason);
    assertStrictEquals(errors.execution, reason);
  });

  it("closes the abort race between the initial check and listener registration", async () => {
    configureRemoteTools();
    const caller = new AbortController();
    const reason = new DOMException("raced abort", "AbortError");
    const signal = caller.signal;
    const originalAdd = signal.addEventListener.bind(signal);
    Object.defineProperty(signal, "addEventListener", {
      configurable: true,
      value: ((
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) => {
        // Abort inside the window the source re-checks: the {once:true}
        // listener is registered after the event has already fired.
        if (type === "abort") caller.abort(reason);
        originalAdd(type, listener, options);
      }) as AbortSignal["addEventListener"],
    });
    let fetchCalls = 0;

    const error = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ tools: [] });
      },
      () =>
        captureRejection(() =>
          executeRemoteIntegrationTool("github__list_repos", {}, { abortSignal: signal })
        ),
    );

    assertEquals(fetchCalls, 0);
    assertStrictEquals(error, reason);
  });

  it("propagates caller cancellation from in-flight discovery", async () => {
    configureRemoteTools();
    const caller = new AbortController();
    const reason = new DOMException("caller stopped discovery", "AbortError");
    const started = Promise.withResolvers<void>();

    const operation = withMockFetch(
      async (_input, init) => await rejectFetchWhenAborted(requestSignalFromInit(init), started),
      () =>
        captureRejection(() => getRemoteIntegrationToolDefinitions({ abortSignal: caller.signal })),
    );
    await started.promise;
    caller.abort(reason);

    assertStrictEquals(await operation, reason);
  });

  it("cancels discovery during retry backoff without another request", async () => {
    configureRemoteTools();
    const caller = new AbortController();
    const reason = new DOMException("caller stopped retry", "AbortError");
    const retryStarted = Promise.withResolvers<void>();
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      if (
        entry.message === "Retrying remote integration tool discovery after a transient failure"
      ) {
        retryStarted.resolve();
      }
    });
    setLogLevel(LogLevel.DEBUG);
    let fetchCalls = 0;

    try {
      const operation = withMockFetch(
        async () => {
          fetchCalls++;
          return new Response(undefined, { status: 503, statusText: "Service Unavailable" });
        },
        () =>
          captureRejection(() =>
            getRemoteIntegrationToolDefinitions({ abortSignal: caller.signal })
          ),
      );
      await retryStarted.promise;
      caller.abort(reason);

      assertStrictEquals(await operation, reason);
      assertEquals(fetchCalls, 1);
    } finally {
      unsubscribe();
      refreshLoggerConfig();
    }
  });

  it("cancels an in-flight response body with the caller reason", async () => {
    configureRemoteTools();
    const caller = new AbortController();
    const reason = new DOMException("caller stopped body read", "AbortError");
    const bodyStarted = Promise.withResolvers<void>();
    const pending = createPendingBodyResponse(bodyStarted);

    const operation = withMockFetch(
      async () => pending.response,
      () =>
        captureRejection(() =>
          executeRemoteIntegrationTool(
            "github__list_repos",
            {},
            { abortSignal: caller.signal },
          )
        ),
    );
    await bodyStarted.promise;
    caller.abort(reason);

    assertStrictEquals(await operation, reason);
    assertEquals(pending.wasCancelled(), true);
  });

  it("detaches caller listeners and clears the deadline after success", async () => {
    using time = new FakeTime();
    configureRemoteTools();
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;

    const result = await withMockFetch(
      async (_input, init) => {
        requestSignal = requestSignalFromInit(init);
        return Response.json({ content: [], structuredContent: { ok: true } });
      },
      () =>
        executeRemoteIntegrationTool(
          "github__list_repos",
          {},
          { abortSignal: caller.signal },
        ),
    );

    assertEquals(result, { ok: true });
    assertEquals(requestSignal?.aborted, false);
    caller.abort(new DOMException("late caller abort", "AbortError"));
    time.tick(INTEGRATION_REQUEST_TIMEOUT_MS);
    assertEquals(requestSignal?.aborted, false);
  });

  it("owns a typed end-to-end request deadline", async () => {
    using time = new FakeTime();
    configureRemoteTools();
    const started = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | undefined;

    const operation = withMockFetch(
      async (_input, init) => {
        requestSignal = requestSignalFromInit(init);
        return await rejectFetchWhenAborted(requestSignalFromInit(init), started);
      },
      () => captureRejection(() => executeRemoteIntegrationTool("github__list_repos", {})),
    );
    await started.promise;
    time.tick(INTEGRATION_REQUEST_TIMEOUT_MS);
    const error = await operation;

    assertEquals(requestSignal?.aborted, true);
    assertEquals(error instanceof DOMException, true);
    assertEquals((error as DOMException).name, "TimeoutError");
  });

  it("preserves the integration discovery timeout reason without retrying", async () => {
    using time = new FakeTime();
    configureRemoteTools();
    const started = Promise.withResolvers<void>();
    const records: LogEntry[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      if (entry.message === "Failed to fetch remote integration tool definitions") {
        records.push(entry);
      }
    });
    let fetchCalls = 0;

    try {
      const operation = withMockFetch(
        async (_input, init) => {
          fetchCalls++;
          return await rejectFetchWhenAborted(requestSignalFromInit(init), started);
        },
        () => getRemoteIntegrationToolDiscovery(),
      );
      await started.promise;
      time.tick(INTEGRATION_REQUEST_TIMEOUT_MS);

      assertEquals(await operation, { status: "unavailable", reason: "request_failed" });
      assertEquals(fetchCalls, 1);
      assertEquals(records.length, 1);
      const [record] = records;
      assert(record);
      assertEquals(
        record.context?.error,
        `Integration API request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
      );
    } finally {
      unsubscribe();
    }
  });

  it("rejects an oversized declared discovery body before reading and cancels it", async () => {
    configureRemoteTools();
    const oversized = createOpenByteResponse(new Uint8Array(), {
      headers: {
        "content-length": String(MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES + 1),
      },
    });

    const definitions = await withMockFetch(
      async () => oversized.response,
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(definitions, []);
    assertEquals(oversized.wasCancelled(), true);
  });

  it("rejects and cancels a chunked tool-call response above the byte ceiling", async () => {
    configureRemoteTools();
    const oversized = createOpenByteResponse(
      new Uint8Array(MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES + 1),
    );

    const error = await withMockFetch(
      async () => oversized.response,
      () => captureRejection(() => executeRemoteIntegrationTool("github__list_repos", {})),
    );

    assertEquals(error instanceof Error, true);
    assertEquals(
      (error as Error).message,
      `Integration tools API call response exceeds the ${MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES}-byte response limit`,
    );
    assertEquals(oversized.wasCancelled(), true);
  });

  it("bounds API error text and cancels the unread remainder", async () => {
    configureRemoteTools();
    const oversized = createOpenByteResponse(
      encoder.encode("x".repeat(MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES + 1)),
      { status: 502 },
    );

    const result = await withMockFetch(
      async () => oversized.response,
      () => executeRemoteIntegrationTool("github__list_repos", {}),
    );

    assertEquals(result, {
      error: "api_error",
      status: 502,
      message: "x".repeat(MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES),
    });
    assertEquals(oversized.wasCancelled(), true);
  });

  it("fails discovery closed for malformed UTF-8", async () => {
    configureRemoteTools();
    let fetchCalls = 0;
    const definitions = await withMockFetch(
      async () => {
        fetchCalls++;
        return new Response(new Uint8Array([0xff]));
      },
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(definitions, [], "a body that is not valid UTF-8 must admit no tools");
    assertEquals(fetchCalls, 1, "a malformed response body must not be retried as a network error");

    // Valid JSON only after lenient U+FFFD replacement, so a repaired decode
    // would admit the tool with corrupted metadata instead of failing closed.
    const prefix = encoder.encode('{"tools":[{"name":"github__ok_tool","description":"a');
    const suffix = encoder.encode('b","inputSchema":{}}]}');
    const repairableBody = new Uint8Array(prefix.length + 1 + suffix.length);
    repairableBody.set(prefix, 0);
    repairableBody[prefix.length] = 0xff;
    repairableBody.set(suffix, prefix.length + 1);

    fetchCalls = 0;
    const discovery = await withMockFetch(
      async () => {
        fetchCalls++;
        return new Response(repairableBody);
      },
      () => getRemoteIntegrationToolDiscovery(),
    );

    assertEquals(
      discovery,
      { status: "unavailable", reason: "request_failed" },
      "malformed UTF-8 in the discovery body must fail closed rather than be repaired",
    );
    assertEquals(fetchCalls, 1, "a malformed streamed body must fail without retrying");
  });

  it("admits remote tool definitions atomically within count limits", async () => {
    configureRemoteTools();
    const atLimitTools = Array.from(
      { length: MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS },
      (_, index) => createToolDefinition({ name: `github__tool_${index}` }),
    );

    const atLimitDefinitions = await withMockFetch(
      async () => Response.json({ tools: atLimitTools }),
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(
      atLimitDefinitions.length,
      MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS,
      "a catalog at exactly the definition ceiling must be admitted in full",
    );

    const tools = Array.from(
      { length: MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS + 1 },
      (_, index) => createToolDefinition({ name: `github__tool_${index}` }),
    );

    const definitions = await withMockFetch(
      async () => Response.json({ tools }),
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(definitions, [], "a catalog past the definition ceiling must be rejected whole");
  });

  it("rejects duplicate remote tool names atomically", async () => {
    configureRemoteTools();

    const definitions = await withMockFetch(
      async () =>
        Response.json({
          tools: [
            createToolDefinition(),
            createToolDefinition({ description: "Conflicting definition" }),
          ],
        }),
      () => getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(definitions, []);
  });

  it("rejects overlong and deeply nested tool metadata atomically", async () => {
    configureRemoteTools();
    const invalidDefinitions = [
      createToolDefinition({
        name: `${"g".repeat(64)}__${
          "t".repeat(
            MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH - 65,
          )
        }`,
      }),
      createToolDefinition({
        description: "d".repeat(MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH + 1),
      }),
      createToolDefinition({
        inputSchema: {
          type: "object",
          description: "s".repeat(MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES),
        },
      }),
      createToolDefinition({
        inputSchema: createSchemaAtDepth(MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH + 1),
      }),
    ];

    for (const invalidDefinition of invalidDefinitions) {
      const definitions = await withMockFetch(
        async () => Response.json({ tools: [invalidDefinition] }),
        () => getRemoteIntegrationToolDefinitions(),
      );
      assertEquals(definitions, []);
    }
  });

  it("snapshots hostile call arguments before dispatch", async () => {
    configureRemoteTools();
    let getterCalled = false;
    const args: Record<string, unknown> = {};
    Object.defineProperty(args, "secret", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "credential";
      },
    });
    const cyclicArgs: Record<string, unknown> = {};
    cyclicArgs.self = cyclicArgs;
    let fetchCalls = 0;

    const errors = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ structuredContent: { ok: true } });
      },
      async () => ({
        accessor: await captureRejection(() =>
          executeRemoteIntegrationTool("github__list_repos", args)
        ),
        cycle: await captureRejection(() =>
          executeRemoteIntegrationTool("github__list_repos", cyclicArgs)
        ),
      }),
    );

    assertEquals(errors.accessor instanceof TypeError, true);
    assertEquals(errors.cycle instanceof TypeError, true);
    assertEquals(getterCalled, false);
    assertEquals(fetchCalls, 0);
  });

  it("does not invoke accessors in the tool execution context", async () => {
    configureRemoteTools();
    let getterCalled = false;
    let fetchCalls = 0;
    const context: Record<string, unknown> = {};
    Object.defineProperty(context, "authToken", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "accessor-token";
      },
    });

    const errors = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ tools: [] });
      },
      async () => ({
        discovery: await captureRejection(() => getRemoteIntegrationToolDefinitions(context)),
        execution: await captureRejection(() =>
          executeRemoteIntegrationTool(
            "github__list_repos",
            {},
            context,
          )
        ),
      }),
    );

    assertEquals(errors.discovery instanceof TypeError, true);
    assertEquals(errors.execution instanceof TypeError, true);
    assertEquals(getterCalled, false);
    assertEquals(fetchCalls, 0);
  });

  it("rejects oversized credentials and non-canonical project slugs before dispatch", async () => {
    configureRemoteTools();
    let fetchCalls = 0;
    const oversizedToken = "t".repeat(MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH + 1);

    const outcomes = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ tools: [] });
      },
      async () => ({
        oversizedDiscovery: await getRemoteIntegrationToolDefinitions({
          authToken: oversizedToken,
        }),
        oversizedExecution: await executeRemoteIntegrationTool(
          "github__list_repos",
          {},
          { authToken: oversizedToken },
        ),
        invalidSlugDiscovery: await getRemoteIntegrationToolDefinitions({
          authToken: "request-token",
          projectSlug: "not_a_canonical_slug",
        }),
        invalidSlugExecution: await captureRejection(() =>
          executeRemoteIntegrationTool(
            "github__list_repos",
            {},
            {
              authToken: "request-token",
              projectSlug: "not_a_canonical_slug",
            },
          )
        ),
      }),
    );

    assertEquals(outcomes.oversizedDiscovery, []);
    assertEquals(outcomes.oversizedExecution, {
      error: "no_api_token",
      message: "No API token available",
    });
    assertEquals(outcomes.invalidSlugDiscovery, []);
    assertEquals(outcomes.invalidSlugExecution instanceof TypeError, true);
    assertEquals(fetchCalls, 0);
  });

  it("rejects deeply nested tool-call results at the JSON shape boundary", async () => {
    configureRemoteTools();
    const deeplyNestedResult = createSchemaAtDepth(129);

    const error = await withMockFetch(
      async () => Response.json(deeplyNestedResult),
      () => captureRejection(() => executeRemoteIntegrationTool("github__list_repos", {})),
    );

    assertEquals(error instanceof TypeError, true);
    assertEquals(
      (error as Error).message,
      "Integration tools API call response exceeds bounded JSON shape limits",
    );
  });

  it("rejects malformed MCP structured content", async () => {
    configureRemoteTools();

    const error = await withMockFetch(
      async () =>
        Response.json({
          content: [],
          structuredContent: "not-an-object",
        }),
      () => captureRejection(() => executeRemoteIntegrationTool("github__list_repos", {})),
    );

    assertEquals(error instanceof TypeError, true);
  });

  it("does not reintroduce an unsafe shape by parsing MCP text content", async () => {
    configureRemoteTools();
    const deeplyNestedText = JSON.stringify(createSchemaAtDepth(129));

    const result = await withMockFetch(
      async () =>
        Response.json({
          content: [{ type: "text", text: deeplyNestedText }],
        }),
      () => executeRemoteIntegrationTool("github__list_repos", {}),
    );

    assertEquals(result, deeplyNestedText);
  });

  it("rejects oversized serialized call metadata before dispatch", async () => {
    configureRemoteTools();
    let fetchCalls = 0;

    const error = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ structuredContent: { ok: true } });
      },
      () =>
        captureRejection(() =>
          executeRemoteIntegrationTool(
            "github__list_repos",
            {},
            { runId: "r".repeat(MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH + 1) },
          )
        ),
    );

    assertEquals(error instanceof RangeError, true);
    assertEquals(fetchCalls, 0);
  });

  it("rejects a serialized call body above the aggregate byte ceiling", async () => {
    configureRemoteTools();
    const emptyArguments = { a: "", b: "", c: "", d: "" };
    const argumentSyntaxBytes = encoder.encode(JSON.stringify(emptyArguments)).byteLength;
    const chunkBytes = Math.floor(MAX_INTEGRATION_CALL_REQUEST_BYTES / 4);
    const args = {
      a: "a".repeat(chunkBytes),
      b: "b".repeat(chunkBytes),
      c: "c".repeat(chunkBytes),
      d: "d".repeat(
        MAX_INTEGRATION_CALL_REQUEST_BYTES - argumentSyntaxBytes - 3 * chunkBytes,
      ),
    };
    let fetchCalls = 0;

    const error = await withMockFetch(
      async () => {
        fetchCalls += 1;
        return Response.json({ structuredContent: { ok: true } });
      },
      () => captureRejection(() => executeRemoteIntegrationTool("github__list_repos", args)),
    );

    assertEquals(error instanceof RangeError, true);
    assertEquals(fetchCalls, 0);
  });
});
