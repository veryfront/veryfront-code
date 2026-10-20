/**
 * Exercises process-global intrinsic replacement around private worker authority,
 * so it belongs in the semantic integration boundary rather than the hermetic
 * colocated unit suite.
 */
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  type AgentWorkerRuntimeOwnershipProbeActivation,
  type AgentWorkerRuntimeOwnershipProbeReceipt,
  createAgentWorkerRuntimeOwnershipProbe,
  createAgentWorkerRuntimeOwnershipProbeFromHostEnv,
} from "#veryfront/agent/service/agent-worker-runtime-ownership-probe.ts";
import { createExternalAgentWorkerClient } from "#veryfront/agent/service/external-worker-client.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import type { AgentWorkerRuntimeOwnershipProbeClaimInput } from "#veryfront/agent/service/agent-worker-runtime-ownership-probe.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
const publicRunId = "run_public";
const canonicalRunId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";

function terminalToken(runId = publicRunId, canonicalId = canonicalRunId): string {
  return `header.${
    btoa(JSON.stringify({
      runId,
      canonicalRunId: canonicalId,
      tokenUse: "run_event_writer",
      writerPurpose: "current_run_terminal",
      dispatchNonce: "generation_~",
    })).replaceAll("+", "-").replaceAll("/", "_")
  }.signature`;
}

function run() {
  return {
    run_id: publicRunId,
    conversation_id: uuid,
    message_id: uuid,
    project_id: uuid,
    agent_id: "agent-main",
    status: "running",
    request_snapshot: null,
    latest_event_id: 2,
    latest_external_event_sequence: 1,
    lease_owner: workerId,
    lease_expires_at: null,
    worker_session: null,
  };
}

const activation: AgentWorkerRuntimeOwnershipProbeActivation = {
  probeId: "stage-probe",
  projectId: uuid,
  workerId,
  expiresAtMs: Date.now() + 60_000,
  operationTimeoutMs: 5_000,
};

function credentials(suffix = "") {
  return {
    authToken: `auth${suffix}`,
    runEventToken: `writer${suffix}`,
    runTerminalToken: terminalToken(),
  };
}

function managedTestEmbedder(calls: string[] = []) {
  const vector = Array.from({ length: 3072 }, () => 0.001);
  return {
    model: "veryfront-cloud/google/gemini-embedding-001",
    async embed(_text: string): Promise<number[]> {
      throw new Error("probe should request document embedding through embedMany");
    },
    async embedMany(texts: string[]): Promise<number[][]> {
      calls.push(...texts);
      return texts.map(() => vector);
    },
  };
}

function overflowingTestEmbedder() {
  return {
    model: "veryfront-cloud/google/gemini-embedding-001",
    async embed(_text: string): Promise<number[]> {
      throw new Error("probe should request document embedding through embedMany");
    },
    async embedMany(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array.from({ length: 3072 }, () => 1e300));
    },
  };
}

function probeRun() {
  return {
    runId: publicRunId,
    canonicalRunId,
    projectId: uuid,
    agentId: "agent-main",
    latestExternalEventSequence: 1,
  };
}

type ClaimFetchOptions = {
  calls?: Request[];
  paths?: string[];
  failEventAppend?:
    | "missing-cursor"
    | "reject"
    | "missing-cursor-retry-reject"
    | "missing-cursor-retry-timeout";
  failEventReadback?: boolean;
  paginatedReadback?: boolean;
  wrongIndexVersion?: boolean;
  wrongIndexFile?: boolean;
  indexAckChecksum?: "missing" | "wrong";
  indexStatus?: "empty" | "wrong-file" | "wrong-version" | "not-ready" | "missing-ready";
  denyReplayCredentials?: boolean;
  replayCredentialDenial?:
    | "authority-403"
    | "authority-409"
    | "source-detail-for-index"
    | "index-detail-for-source"
    | "missing-event-authority-403"
    | "missing-project-attempt-403"
    | "branch-mismatch-403"
    | "index-branch-mismatch-403"
    | "empty-409"
    | "generic-409"
    | "generic-401"
    | "generic-403";
  denyReplayEvent?: boolean;
  replayEventDenial?:
    | "authority-403"
    | "authority-409"
    | "wrong-slug-authority-409"
    | "generic-409"
    | "generic-401"
    | "generic-403";
  eventReadbackUnrelated?: boolean;
};

function claimProofFetch(options: ClaimFetchOptions = {}): typeof fetch {
  const indexedEvents: unknown[] = [];
  const completedEventAppends = new Set<string>();
  let sourceContent = "";
  let postedEvent = false;
  let eventReadCount = 0;
  let eventAppendFailures = 0;
  return (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    options.calls?.push(request.clone());
    options.paths?.push(`${request.method} ${url.pathname}${url.search}`);
    const authorization = request.headers.get("Authorization") ?? "";
    const replayCredential = authorization.includes("old") || authorization.includes("expired");
    const replaySourceOrIndex = url.pathname.includes("/files/");
    if (
      options.denyReplayCredentials && replayCredential && request.method !== "GET" &&
      replaySourceOrIndex
    ) {
      if (options.replayCredentialDenial === "authority-409") {
        return Promise.resolve(
          Response.json({
            slug: "state-conflict",
            detail: "This execution generation is no longer current; stop execution",
          }, { status: 409 }),
        );
      }
      if (
        options.replayCredentialDenial === "authority-403" ||
        options.replayCredentialDenial === undefined
      ) {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: url.pathname.endsWith("/index")
              ? "Run no longer permits canonical indexing"
              : "Run no longer permits canonical source writes",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "source-detail-for-index") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "Run no longer permits canonical source writes",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "index-detail-for-source") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "Run no longer permits canonical indexing",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "missing-event-authority-403") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "A signed current run event writer authority is required",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "missing-project-attempt-403") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "A signed current project execution attempt is required",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "branch-mismatch-403") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "Run source destination differs from its trusted runtime branch",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "index-branch-mismatch-403") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "Run indexing destination differs from its trusted runtime branch",
          }, { status: 403 }),
        );
      }
      if (options.replayCredentialDenial === "generic-409") {
        return Promise.resolve(
          Response.json({ slug: "state-conflict", detail: "Version conflict" }, { status: 409 }),
        );
      }
      if (options.replayCredentialDenial === "empty-409") {
        return Promise.resolve(Response.json({}, { status: 409 }));
      }
      if (options.replayCredentialDenial === "generic-401") {
        return Promise.resolve(
          Response.json({ slug: "invalid-token", detail: "Invalid token" }, { status: 401 }),
        );
      }
      if (options.replayCredentialDenial === "generic-403") {
        return Promise.resolve(
          Response.json({
            slug: "authorization-denied",
            detail: "The caller does not have project permission",
          }, { status: 403 }),
        );
      }
      throw new Error("unreachable replay credential denial");
    }
    if (request.method === "PUT" && url.pathname.includes("/files/")) {
      return request.json().then((body) => {
        sourceContent = String((body as { content?: unknown }).content ?? "");
        return Response.json({
          id: "11111111-1111-4111-8111-111111111111",
          version_id: "22222222-2222-4222-8222-222222222222",
          path: decodeURIComponent(url.pathname.split("/files/")[1] ?? ""),
          checksum: "source-checksum",
          content: sourceContent,
        });
      });
    }
    if (request.method === "GET" && url.pathname.includes("/files/")) {
      return Promise.resolve(Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        version_id: "22222222-2222-4222-8222-222222222222",
        path: decodeURIComponent(url.pathname.split("/files/")[1] ?? ""),
        checksum: "source-checksum",
        content: sourceContent,
      }));
    }
    if (request.method === "POST" && url.pathname.endsWith("/index")) {
      return request.json().then((body) => {
        const index = body as {
          expected_version_id?: unknown;
          model?: { name?: unknown; dimension?: unknown };
          chunks?: Array<{ vector?: unknown[] }>;
        };
        assertEquals(index.expected_version_id, "22222222-2222-4222-8222-222222222222");
        assertEquals(index.model?.name, "gemini-embedding-001");
        assertEquals(index.model?.dimension, 3072);
        assertEquals(index.chunks?.[0]?.vector?.length, 3072);
        return Response.json({
          file_id: options.wrongIndexFile
            ? "99999999-9999-4999-8999-999999999999"
            : "11111111-1111-4111-8111-111111111111",
          version_id: options.wrongIndexVersion
            ? "99999999-9999-4999-8999-999999999999"
            : "22222222-2222-4222-8222-222222222222",
          path: decodeURIComponent(
            url.pathname.split("/files/")[1]?.slice(0, -"/index".length) ?? "",
          ),
          ...(options.indexAckChecksum === "missing" ? {} : {
            checksum: options.indexAckChecksum === "wrong"
              ? "wrong-source-checksum"
              : "source-checksum",
          }),
          indexed_chunk_count: 1,
          model: index.model,
        });
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/knowledge/index-status")) {
      return request.json().then((body) => {
        const paths = (body as { paths?: unknown[] }).paths ?? [];
        if (options.indexStatus === "empty") return Response.json({ data: [] });
        return Response.json({
          data: paths.map((path) => ({
            path,
            file_id: options.indexStatus === "wrong-file"
              ? "99999999-9999-4999-8999-999999999999"
              : "11111111-1111-4111-8111-111111111111",
            file_version_id: options.indexStatus === "wrong-version"
              ? "99999999-9999-4999-8999-999999999999"
              : "22222222-2222-4222-8222-222222222222",
            ...(options.indexStatus === "missing-ready" ? {} : {
              index_ready: options.indexStatus !== "not-ready",
            }),
          })),
        });
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      postedEvent = true;
      const eventIdempotencyKey = request.headers.get("Idempotency-Key") ?? undefined;
      if (
        eventIdempotencyKey !== undefined &&
        completedEventAppends.has(eventIdempotencyKey) &&
        options.failEventAppend !== "missing-cursor-retry-reject" &&
        options.failEventAppend !== "missing-cursor-retry-timeout"
      ) {
        return Promise.resolve(Response.json({ latest_external_event_sequence: 2 }));
      }
      if (options.denyReplayEvent && replayCredential) {
        if (
          options.replayEventDenial === "authority-409" || options.replayEventDenial === undefined
        ) {
          return Promise.resolve(
            Response.json({
              slug: "state-conflict",
              detail: "This execution generation is no longer current; stop execution",
            }, { status: 409 }),
          );
        }
        if (options.replayEventDenial === "authority-403") {
          return Promise.resolve(
            Response.json({
              slug: "authorization-denied",
              detail: "Run no longer permits canonical source writes",
            }, { status: 403 }),
          );
        }
        if (options.replayEventDenial === "wrong-slug-authority-409") {
          return Promise.resolve(
            Response.json({
              slug: "invalid-token",
              detail: "This execution generation is no longer current; stop execution",
            }, { status: 409 }),
          );
        }
        if (options.replayEventDenial === "generic-409") {
          return Promise.resolve(
            Response.json({ slug: "state-conflict", detail: "Sequence conflict" }, { status: 409 }),
          );
        }
        if (options.replayEventDenial === "generic-401") {
          return Promise.resolve(
            Response.json({ slug: "invalid-token", detail: "Invalid token" }, { status: 401 }),
          );
        }
        if (options.replayEventDenial === "generic-403") {
          return Promise.resolve(
            Response.json({
              slug: "authorization-denied",
              detail: "The caller does not have project permission",
            }, { status: 403 }),
          );
        }
        throw new Error("unreachable replay event denial");
      }
      if (options.failEventAppend === "reject" && eventAppendFailures++ === 0) {
        return Promise.reject(new TypeError("connection closed"));
      }
      if (
        options.failEventAppend === "missing-cursor-retry-reject" ||
        options.failEventAppend === "missing-cursor-retry-timeout"
      ) {
        if (eventAppendFailures++ === 0) {
          return request.json().then((body) => {
            indexedEvents.push(...((body as { events?: unknown[] }).events ?? []));
            if (eventIdempotencyKey !== undefined) completedEventAppends.add(eventIdempotencyKey);
            return Response.json({ ok: true });
          });
        }
        if (options.failEventAppend === "missing-cursor-retry-timeout") {
          return Promise.reject(
            new DOMException("Probe operation deadline exceeded", "TimeoutError"),
          );
        }
        return Promise.reject(new TypeError("retry connection closed"));
      }
      if (options.failEventAppend === "missing-cursor" && eventAppendFailures++ === 0) {
        return request.json().then((body) => {
          indexedEvents.push(...((body as { events?: unknown[] }).events ?? []));
          if (eventIdempotencyKey !== undefined) completedEventAppends.add(eventIdempotencyKey);
          return Response.json({ ok: true });
        });
      }
      return request.json().then((body) => {
        indexedEvents.push(...((body as { events?: unknown[] }).events ?? []));
        if (eventIdempotencyKey !== undefined) completedEventAppends.add(eventIdempotencyKey);
        return Response.json({ latest_external_event_sequence: 2 });
      });
    }
    if (request.method === "GET" && url.pathname.endsWith("/events")) {
      if (postedEvent && options.failEventReadback) {
        return Promise.resolve(Response.json({ error: "not indexed yet" }, { status: 503 }));
      }
      eventReadCount += 1;
      if (options.paginatedReadback && eventReadCount === 2) {
        return Promise.resolve(Response.json({ data: [], page_info: { next: "cursor-2" } }));
      }
      return Promise.resolve(Response.json({
        data: postedEvent
          ? options.eventReadbackUnrelated
            ? [{ event: "unrelated-runtime-log-entry" }]
            : indexedEvents
          : [],
        page_info: { next: null },
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected request" }, { status: 500 }));
  };
}

it("does not expose private proof material through replaced Object or Map intrinsics", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const originalAssign = Object.assign;
  const originalMapSet = Map.prototype.set;
  const originalParse = JSON.parse;
  const originalAtob = globalThis.atob;
  const originalSplit = String.prototype.split;
  const originalReplace = String.prototype.replace;
  const originalReplaceAll = String.prototype.replaceAll;
  const originalStringify = JSON.stringify;
  let exposedPrivateMaterial = false;
  const markIfPrivate = (value: unknown) => {
    if (originalStringify(value).includes("writer") || originalStringify(value).includes("auth")) {
      exposedPrivateMaterial = true;
    }
  };
  Object.assign = function (...args: Parameters<typeof Object.assign>) {
    markIfPrivate(args);
    return originalAssign(...args);
  };
  Map.prototype.set = function <K, V>(this: Map<K, V>, key: K, value: V): Map<K, V> {
    markIfPrivate([key, value]);
    return originalMapSet.call(this, key, value);
  };
  JSON.parse = function (...args: Parameters<typeof JSON.parse>) {
    markIfPrivate(args);
    return originalParse(...args);
  };
  globalThis.atob = function (...args: Parameters<typeof atob>) {
    markIfPrivate(args);
    return originalAtob(...args);
  };
  Object.defineProperty(String.prototype, "split", {
    configurable: true,
    value(this: string, separator: string | RegExp, limit?: number) {
      markIfPrivate(String(this));
      markIfPrivate([separator, limit]);
      return Reflect.apply(originalSplit, this, [separator, limit]) as string[];
    },
  });
  Object.defineProperty(String.prototype, "replace", {
    configurable: true,
    value(this: string, searchValue: string | RegExp, replaceValue: string) {
      markIfPrivate(String(this));
      markIfPrivate([searchValue, replaceValue]);
      return "https://attacker.example.test";
    },
  });
  Object.defineProperty(String.prototype, "replaceAll", {
    configurable: true,
    value(this: string, searchValue: string | RegExp, replaceValue: string) {
      markIfPrivate(String(this));
      markIfPrivate([searchValue, replaceValue]);
      return Reflect.apply(originalReplaceAll, this, [searchValue, replaceValue]) as string;
    },
  });
  try {
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ calls }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.assign = originalAssign;
    Map.prototype.set = originalMapSet;
    JSON.parse = originalParse;
    globalThis.atob = originalAtob;
    Object.defineProperty(String.prototype, "split", {
      configurable: true,
      value: originalSplit,
    });
    Object.defineProperty(String.prototype, "replace", {
      configurable: true,
      value: originalReplace,
    });
    Object.defineProperty(String.prototype, "replaceAll", {
      configurable: true,
      value: originalReplaceAll,
    });
  }

  assertEquals(receipts[0]?.status, "ok");
  assertEquals(exposedPrivateMaterial, false);
  assertEquals(
    calls.every((call) => new URL(call.url).origin === "https://api.example.test"),
    true,
  );
});

it("does not dispatch RegExp replacement while building credentialed probe URLs", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const originalReplaceSymbol = RegExp.prototype[Symbol.replace];
  Object.defineProperty(RegExp.prototype, Symbol.replace, {
    configurable: true,
    value() {
      return "https://attacker.example.test";
    },
  });
  try {
    await probe.afterClaim({
      apiUrl: "https://api.example.test/",
      fetch: claimProofFetch({ calls }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.defineProperty(RegExp.prototype, Symbol.replace, {
      configurable: true,
      value: originalReplaceSymbol,
    });
  }

  assertEquals(receipts[0]?.status, "ok");
  assertEquals(
    calls.every((call) => new URL(call.url).origin === "https://api.example.test"),
    true,
  );
  assertEquals(
    calls.some((call) => call.headers.get("Authorization")?.includes("auth")),
    true,
  );
  assertEquals(
    calls.some((call) => call.headers.get("X-Veryfront-Run-Event-Token") === "writer"),
    true,
  );
});

it("does not let replaced response intrinsics forge worker authority denials", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const originalStatus = Object.getOwnPropertyDescriptor(Response.prototype, "status")!;
  const originalOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!;
  const originalText = Response.prototype.text;
  const originalParse = JSON.parse;
  const forgedResponses = new WeakSet<Response>();
  Object.defineProperty(Response.prototype, "status", {
    configurable: true,
    get() {
      return forgedResponses.has(this as Response)
        ? 409
        : Reflect.apply(originalStatus.get!, this, []);
    },
  });
  Object.defineProperty(Response.prototype, "ok", {
    configurable: true,
    get() {
      return forgedResponses.has(this as Response)
        ? false
        : Reflect.apply(originalOk.get!, this, []);
    },
  });
  Response.prototype.text = function (...args: Parameters<typeof Response.prototype.text>) {
    if (forgedResponses.has(this as Response)) {
      return Promise.resolve(JSON.stringify({
        slug: "state-conflict",
        detail: "This execution generation is no longer current; stop execution",
      }));
    }
    return Reflect.apply(originalText, this, args) as ReturnType<typeof Response.prototype.text>;
  };
  JSON.parse = ((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
    if (typeof text === "string" && text.includes("Sequence conflict")) {
      return {
        slug: "state-conflict",
        detail: "This execution generation is no longer current; stop execution",
      };
    }
    return originalParse(text, reviver);
  }) as typeof JSON.parse;
  const fetch = claimProofFetch({
    denyReplayCredentials: true,
    denyReplayEvent: true,
    replayEventDenial: "generic-409",
  });
  try {
    await probe.afterLeaseLost({
      apiUrl: "https://api.example.test",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        const response = await fetch(request, undefined);
        const url = new URL(request.url);
        if (
          request.method === "POST" && url.pathname.endsWith("/events") &&
          request.headers.get("Authorization") === "Bearer writer-expired"
        ) {
          forgedResponses.add(response);
        }
        return response;
      },
      workerId,
      run: probeRun(),
      credentials: credentials("-expired"),
      currentCredentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.defineProperty(Response.prototype, "status", originalStatus);
    Object.defineProperty(Response.prototype, "ok", originalOk);
    Response.prototype.text = originalText;
    JSON.parse = originalParse;
  }

  assertEquals(receipts[0]?.phase, "expired-lease-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "expired-lease-source-index-or-event-write-not-denied");
});

it("records canonical source, index and event proof without leaking claim credentials", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ calls }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts.length, 1);
  assertEquals(receipts[0]?.status, "ok");
  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assert(
    receipts[0]?.sourcePath?.startsWith("knowledge/agent-worker-runtime-ownership-probe-20261011/"),
  );
  assertEquals(typeof receipts[0]?.sourceHash, "string");
  assertEquals(typeof receipts[0]?.sourceVersionHash, "string");
  assertEquals(typeof receipts[0]?.indexResponseHash, "string");
  assertEquals(calls.map((call) => call.method), [
    "GET",
    "PUT",
    "GET",
    "POST",
    "POST",
    "POST",
    "GET",
  ]);
  assertEquals(new URL(calls[0]!.url).pathname, `/runs/${canonicalRunId}/events`);
  assert(new URL(calls[1]!.url).pathname.startsWith(`/projects/${uuid}/files/`));
  assert(new URL(calls[2]!.url).pathname.startsWith(`/projects/${uuid}/files/`));
  assert(new URL(calls[3]!.url).pathname.startsWith(`/projects/${uuid}/branches/main/files/`));
  assertEquals(new URL(calls[4]!.url).pathname, `/projects/${uuid}/knowledge/index-status`);
  assertEquals(new URL(calls[5]!.url).pathname, `/runs/${canonicalRunId}/events`);
  assertEquals(new URL(calls[6]!.url).pathname, `/runs/${canonicalRunId}/events`);
  assertEquals(calls[0]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[1]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[1]?.headers.get("X-Veryfront-Run-Event-Token"), "writer");
  assertEquals(calls[3]?.headers.get("Authorization"), "Bearer writer");
  assertEquals(calls[4]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[5]?.headers.get("Authorization"), "Bearer writer");
  const receiptJson = JSON.stringify(receipts[0]);
  assertEquals(receiptJson.includes("writer"), false);
  assertEquals(receiptJson.includes("auth"), false);
  assertEquals(receiptJson.includes("header."), false);
});

it("keeps canonical request bytes and receipt hashes stable when JSON serialization is poisoned", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const captures: Array<{
    method: string;
    path: string;
    authorization: string;
    runEventToken: string | null;
    wire: string;
  }> = [];
  const currentCredentials = credentials();
  const expiredCredentials = credentials("-expired");
  const originalParse = JSON.parse;
  const originalStringify = JSON.stringify;
  const originalToJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
  let sourceContent = "";
  const indexedEvents: unknown[] = [];
  const jsonResponse = (body: unknown, init?: ResponseInit) => {
    const currentToJsonDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    if (originalToJsonDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, "toJSON");
    } else {
      Object.defineProperty(Object.prototype, "toJSON", originalToJsonDescriptor);
    }
    try {
      return new Response(originalStringify(body), {
        ...init,
        headers: { "Content-Type": "application/json", ...init?.headers },
      });
    } finally {
      if (currentToJsonDescriptor === undefined) {
        Reflect.deleteProperty(Object.prototype, "toJSON");
      } else {
        Object.defineProperty(Object.prototype, "toJSON", currentToJsonDescriptor);
      }
    }
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const authorization = request.headers.get("Authorization") ?? "";
    const path = url.pathname;
    const readWire = async () => {
      const wire = await request.text();
      captures.push({
        method: request.method,
        path,
        authorization,
        runEventToken: request.headers.get("X-Veryfront-Run-Event-Token"),
        wire,
      });
      assertEquals(wire.includes("poisoned"), false);
      return wire;
    };
    if (request.method === "PUT" && path.includes("/files/")) {
      const wire = await readWire();
      if (authorization.includes("expired")) {
        return jsonResponse({
          slug: "authorization-denied",
          detail: "Run no longer permits canonical source writes",
        }, { status: 403 });
      }
      const body = originalParse(wire) as { content?: unknown };
      sourceContent = String(body.content ?? "");
      return jsonResponse({
        id: "11111111-1111-4111-8111-111111111111",
        version_id: "22222222-2222-4222-8222-222222222222",
        path: decodeURIComponent(path.split("/files/")[1] ?? ""),
        checksum: "source-checksum",
        content: sourceContent,
      });
    }
    if (request.method === "GET" && path.includes("/files/")) {
      return jsonResponse({
        id: "11111111-1111-4111-8111-111111111111",
        version_id: "22222222-2222-4222-8222-222222222222",
        path: decodeURIComponent(path.split("/files/")[1] ?? ""),
        checksum: "source-checksum",
        content: sourceContent,
      });
    }
    if (request.method === "POST" && path.endsWith("/index")) {
      const wire = await readWire();
      if (authorization.includes("expired")) {
        return jsonResponse({
          slug: "authorization-denied",
          detail: "Run no longer permits canonical indexing",
        }, { status: 403 });
      }
      const index = originalParse(wire) as {
        expected_version_id?: unknown;
        model?: { name?: unknown; dimension?: unknown };
        chunks?: Array<{ vector?: unknown[] }>;
      };
      assertEquals(index.expected_version_id, "22222222-2222-4222-8222-222222222222");
      assertEquals(index.model?.name, "gemini-embedding-001");
      assertEquals(index.model?.dimension, 3072);
      assertEquals(index.chunks?.[0]?.vector?.length, 3072);
      return jsonResponse({
        file_id: "11111111-1111-4111-8111-111111111111",
        version_id: "22222222-2222-4222-8222-222222222222",
        path: decodeURIComponent(path.split("/files/")[1]?.slice(0, -"/index".length) ?? ""),
        checksum: "source-checksum",
        indexed_chunk_count: 1,
        model: index.model,
      });
    }
    if (request.method === "POST" && path.endsWith("/knowledge/index-status")) {
      const wire = await readWire();
      const paths = (originalParse(wire) as { paths?: unknown[] }).paths ?? [];
      return jsonResponse({
        data: paths.map((item) => ({
          path: item,
          file_id: "11111111-1111-4111-8111-111111111111",
          file_version_id: "22222222-2222-4222-8222-222222222222",
          index_ready: true,
        })),
      });
    }
    if (request.method === "POST" && path.endsWith("/events")) {
      const wire = await readWire();
      if (authorization.includes("expired")) {
        return jsonResponse({
          slug: "state-conflict",
          detail: "Detached run appends require the current signed lease generation",
        }, { status: 409 });
      }
      indexedEvents.push(...((originalParse(wire) as { events?: unknown[] }).events ?? []));
      return jsonResponse({ latest_external_event_sequence: 2 });
    }
    if (request.method === "GET" && path.endsWith("/events")) {
      return jsonResponse({ data: indexedEvents, page_info: { next: null } });
    }
    return jsonResponse({ error: "unexpected request" }, { status: 500 });
  };

  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  try {
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        return { poisoned: true };
      },
    });
    JSON.stringify = (() => '{"poisoned":true}') as typeof JSON.stringify;

    const claimResult = await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch,
      workerId,
      run: probeRun(),
      credentials: currentCredentials,
      embedder: managedTestEmbedder(),
    });
    await probe.afterLeaseLost({
      apiUrl: "https://api.example.test",
      fetch,
      workerId,
      run: probeRun(),
      credentials: expiredCredentials,
      embedder: managedTestEmbedder(),
    });

    assertEquals(claimResult?.latestExternalEventSequence, 2);
    assertEquals(receipts[0]?.status, "ok");
    assertEquals(receipts[1]?.status, "ok");
    const sourceWrites = captures.filter((capture) =>
      capture.method === "PUT" && capture.path.includes("/files/")
    );
    const indexWrites = captures.filter((capture) =>
      capture.method === "POST" && capture.path.endsWith("/index")
    );
    const currentSource = sourceWrites.find((capture) => capture.authorization === "Bearer auth")!;
    const replaySource = sourceWrites.find((capture) =>
      capture.authorization === "Bearer auth-expired"
    )!;
    const currentIndex = indexWrites.find((capture) => capture.authorization === "Bearer writer")!;
    const replayIndex = indexWrites.find((capture) =>
      capture.authorization === "Bearer writer-expired"
    )!;
    assertEquals(currentSource.runEventToken, currentCredentials.runEventToken);
    assertEquals(replaySource.runEventToken, expiredCredentials.runEventToken);
    assertEquals(replaySource.wire, currentSource.wire);
    assertEquals(replayIndex.wire, currentIndex.wire);
    assertEquals(receipts[0]?.indexRequestHash, await computeHash(currentIndex.wire));
    assertEquals(receipts[1]?.indexRequestHash, await computeHash(currentIndex.wire));
  } finally {
    JSON.stringify = originalStringify;
    if (originalToJsonDescriptor === undefined) {
      Reflect.deleteProperty(Object.prototype, "toJSON");
    } else {
      Object.defineProperty(Object.prototype, "toJSON", originalToJsonDescriptor);
    }
  }
});

it("rejects embeddings that would overflow the float32 index vector schema", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch(),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: overflowingTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("does not let replaced String model helpers validate a wrong embedder", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalStartsWith = String.prototype.startsWith;
  const originalSlice = String.prototype.slice;
  Object.defineProperty(String.prototype, "startsWith", {
    configurable: true,
    value(this: string, searchString: string, position?: number) {
      if (String(this) === "local/bad-model" && searchString === "veryfront-cloud/") return true;
      return Reflect.apply(originalStartsWith, this, [searchString, position]);
    },
  });
  Object.defineProperty(String.prototype, "slice", {
    configurable: true,
    value(this: string, start?: number, end?: number) {
      if (String(this) === "local/bad-model") return "openai/gemini-embedding-001";
      return Reflect.apply(originalSlice, this, [start, end]);
    },
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch(),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: { ...managedTestEmbedder(), model: "local/bad-model" },
    });
  } finally {
    Object.defineProperty(String.prototype, "startsWith", {
      configurable: true,
      value: originalStartsWith,
    });
    Object.defineProperty(String.prototype, "slice", {
      configurable: true,
      value: originalSlice,
    });
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("does not let replaced Number.isFinite bypass canonical vector validation", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalIsFinite = Number.isFinite;
  Object.defineProperty(Number, "isFinite", {
    configurable: true,
    value: () => true,
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch(),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: overflowingTestEmbedder(),
    });
  } finally {
    Object.defineProperty(Number, "isFinite", {
      configurable: true,
      value: originalIsFinite,
    });
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("does not let replaced Function.call bypass canonical vector validation", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalCall = Function.prototype.call;
  Object.defineProperty(Function.prototype, "call", {
    configurable: true,
    value(this: (...args: never[]) => unknown, thisArg: unknown, ...args: unknown[]) {
      if (this === Array.prototype.some) return false;
      return Reflect.apply(originalCall, this, [thisArg, ...args]);
    },
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch(),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: overflowingTestEmbedder(),
    });
  } finally {
    Object.defineProperty(Function.prototype, "call", {
      configurable: true,
      value: originalCall,
    });
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("does not let replaced String.includes fabricate canonical event readback", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalIncludes = String.prototype.includes;
  Object.defineProperty(String.prototype, "includes", {
    configurable: true,
    value(this: string, searchString: string, position?: number) {
      if (searchString.startsWith("stage-probe:")) return true;
      return Reflect.apply(originalIncludes, this, [searchString, position]);
    },
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ eventReadbackUnrelated: true }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.defineProperty(String.prototype, "includes", {
      configurable: true,
      value: originalIncludes,
    });
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "probe-event-not-indexed");
});

it("does not let replaced Array.find fabricate canonical index readiness", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalFind = Array.prototype.find;
  Object.defineProperty(Array.prototype, "find", {
    configurable: true,
    value(this: unknown[], predicate: (item: unknown, index: number, array: unknown[]) => unknown) {
      const found = Reflect.apply(originalFind, this, [predicate]);
      if (found !== undefined) return found;
      return {
        path:
          "knowledge/agent-worker-runtime-ownership-probe-20261011/stage-probe/22222222-2222-4222-8222-222222222222/fabricated/ownership.md",
        file_id: "11111111-1111-4111-8111-111111111111",
        file_version_id: "22222222-2222-4222-8222-222222222222",
        index_ready: true,
      };
    },
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ indexStatus: "empty" }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.defineProperty(Array.prototype, "find", {
      configurable: true,
      value: originalFind,
    });
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("fails canonical source/index proof when index status is missing, wrong-file, stale, or not ready", async () => {
  for (const indexStatus of ["empty", "wrong-file", "wrong-version", "not-ready"] as const) {
    const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );

    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ indexStatus }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });

    assertEquals(receipts[0]?.phase, "canonical-source-index");
    assertEquals(receipts[0]?.status, "error");
    assertEquals(receipts[0]?.errorType, "Error");
  }
});

it("fails canonical source/index proof when index acknowledgement does not match the source version", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ wrongIndexVersion: true }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("fails canonical source/index proof when index acknowledgement does not match the source file", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ wrongIndexFile: true }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.errorType, "Error");
});

it("fails canonical source/index proof when index acknowledgement omits or changes the source checksum", async () => {
  for (const indexAckChecksum of ["missing", "wrong"] as const) {
    const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );

    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ indexAckChecksum }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });

    assertEquals(receipts[0]?.phase, "canonical-source-index");
    assertEquals(receipts[0]?.status, "error");
    assertEquals(receipts[0]?.errorType, "Error");
  }
});

it("does not accept a field inherited from Object.prototype as index acknowledgement evidence", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  // Earlier worker code supplies the checksum the acknowledgement omits.
  Object.defineProperty(Object.prototype, "checksum", {
    configurable: true,
    enumerable: false,
    value: "source-checksum",
    writable: true,
  });
  try {
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ indexAckChecksum: "missing" }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    delete (Object.prototype as { checksum?: unknown }).checksum;
  }

  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
});

it("does not accept inherited readiness as canonical index evidence", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "index_ready");
  Object.defineProperty(Object.prototype, "index_ready", {
    configurable: true,
    value: true,
  });
  try {
    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ indexStatus: "missing-ready" }),
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    if (original) Object.defineProperty(Object.prototype, "index_ready", original);
    else Reflect.deleteProperty(Object.prototype, "index_ready");
  }
  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
});

it("follows paginated event pages before reporting event append/readback success", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const paths: string[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ paths, paginatedReadback: true }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.status, "ok");
  assertEquals(paths.filter((path) => path.includes("/events")), [
    `GET /runs/${canonicalRunId}/events?limit=100`,
    `POST /runs/${canonicalRunId}/events`,
    `GET /runs/${canonicalRunId}/events?limit=100`,
    `GET /runs/${canonicalRunId}/events?limit=100&cursor=cursor-2`,
  ]);
});

it("proves replaced generation denial with unchanged before and after hashes", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ calls, denyReplayCredentials: true, denyReplayEvent: true }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts.map((receipt) => receipt.phase), ["replaced-generation-denial"]);
  assertEquals(receipts[0]?.phase, "replaced-generation-denial");
  assertEquals(receipts[0]?.status, "ok");
  assertEquals(receipts[0]?.deniedStatus, 409);
  assertEquals(receipts[0]?.beforeHash, receipts[0]?.afterHash);
  assert(calls.some((call) => call.headers.get("Authorization") === "Bearer old"));
  assert(
    calls.some((call) => call.headers.get("X-Veryfront-Worker-Generation") === "generation_~"),
  );
  assertEquals(JSON.stringify(receipts).includes("old"), false);
});

it("rejects generic 409 replay conflicts as authority proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({
      denyReplayCredentials: true,
      replayCredentialDenial: "generic-409",
      denyReplayEvent: true,
    }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "replaced-generation-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
});

it("rejects unrelated 401 and 403 replay denials as generation authority proof", async () => {
  for (
    const replayCredentialDenial of [
      "generic-401",
      "generic-403",
      "missing-event-authority-403",
      "missing-project-attempt-403",
      "branch-mismatch-403",
      "index-branch-mismatch-403",
      "source-detail-for-index",
      "index-detail-for-source",
    ] as const
  ) {
    const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterRenew({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({
        denyReplayCredentials: true,
        replayCredentialDenial,
        denyReplayEvent: true,
      }),
      workerId,
      run: probeRun(),
      credentials: credentials("-new"),
      previousCredentials: {
        authToken: "old-auth",
        runEventToken: "old",
        runTerminalToken: terminalToken(),
      },
      embedder: managedTestEmbedder(),
    });

    assertEquals(receipts[0]?.phase, "replaced-generation-denial");
    assertEquals(receipts[0]?.status, "error");
    assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
  }
});

it("rejects inherited problem fields as generation authority proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalSlug = Object.getOwnPropertyDescriptor(Object.prototype, "slug");
  const originalDetail = Object.getOwnPropertyDescriptor(Object.prototype, "detail");
  Object.defineProperty(Object.prototype, "slug", {
    configurable: true,
    value: "state-conflict",
  });
  Object.defineProperty(Object.prototype, "detail", {
    configurable: true,
    value: "This execution generation is no longer current; stop execution",
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterRenew({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({
        denyReplayCredentials: true,
        replayCredentialDenial: "empty-409",
        denyReplayEvent: true,
      }),
      workerId,
      run: probeRun(),
      credentials: credentials("-new"),
      previousCredentials: {
        authToken: "old-auth",
        runEventToken: "old",
        runTerminalToken: terminalToken(),
      },
      embedder: managedTestEmbedder(),
    });
  } finally {
    if (originalSlug) Object.defineProperty(Object.prototype, "slug", originalSlug);
    else delete (Object.prototype as { slug?: unknown }).slug;
    if (originalDetail) Object.defineProperty(Object.prototype, "detail", originalDetail);
    else delete (Object.prototype as { detail?: unknown }).detail;
  }

  assertEquals(receipts[0]?.phase, "replaced-generation-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
});

it("rejects current-generation 409 canonical replay denials as source/index authority proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({
      denyReplayCredentials: true,
      replayCredentialDenial: "authority-409",
      denyReplayEvent: true,
    }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "replaced-generation-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
});

it("does not let replaced String.toLowerCase forge event authority slugs", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const originalToLowerCase = String.prototype.toLowerCase;
  Object.defineProperty(String.prototype, "toLowerCase", {
    configurable: true,
    value(this: string) {
      if (String(this) === "invalid-token") return "state-conflict";
      return Reflect.apply(originalToLowerCase, this, []);
    },
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterLeaseLost({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({
        denyReplayCredentials: true,
        denyReplayEvent: true,
        replayEventDenial: "wrong-slug-authority-409",
      }),
      workerId,
      run: probeRun(),
      credentials: credentials("-expired"),
      currentCredentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Object.defineProperty(String.prototype, "toLowerCase", {
      configurable: true,
      value: originalToLowerCase,
    });
  }

  assertEquals(receipts[0]?.phase, "expired-lease-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "expired-lease-source-index-or-event-write-not-denied");
});

it("rejects generic 409 event conflicts as replaced-generation authority proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({
      denyReplayCredentials: true,
      denyReplayEvent: true,
      replayEventDenial: "generic-409",
    }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "replaced-generation-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
});

it("returns the committed cursor when a stale generation write unexpectedly succeeds", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const result = await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ denyReplayCredentials: true }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "stale-generation-mutated-source-index-or-events");
});

it("returns the committed cursor when stale generation readback fails", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const result = await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ denyReplayCredentials: true, failEventReadback: true }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(receipts.at(-1)?.status, "error");
});

it("does not fail renewal after an explicit stale generation denial when readback fails", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  let readCount = 0;
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const result = await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: (_input, init) => {
      const request = new Request(_input, init);
      if (request.method === "POST") {
        return Promise.resolve(Response.json({ error: "stale generation" }, { status: 403 }));
      }
      readCount += 1;
      if (readCount > 1) return Promise.reject(new TypeError("readback failed"));
      return Promise.resolve(Response.json({ data: [] }));
    },
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(result, undefined);
  assertEquals(receipts.at(-1)?.status, "error");
  assertEquals(receipts.at(-1)?.errorType, "Error");
});

it("reconciles renewal cursor when a stale generation write commits without a cursor", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  const result = await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({
      calls,
      denyReplayCredentials: true,
      failEventAppend: "missing-cursor",
    }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  const eventPosts = calls.filter((request) =>
    request.method === "POST" && new URL(request.url).pathname.endsWith("/events")
  );
  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(eventPosts.length, 2);
  assertEquals(
    eventPosts[0]?.headers.get("Idempotency-Key"),
    eventPosts[1]?.headers.get("Idempotency-Key"),
  );
  assertEquals(
    eventPosts[0]?.headers.get("Idempotency-Key")?.startsWith("agent-worker-event:"),
    true,
  );
});

it("reconciles renewal cursor when the stale generation write outcome is ambiguous", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  const result = await probe.afterRenew({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ denyReplayCredentials: true, failEventAppend: "reject" }),
    workerId,
    run: probeRun(),
    credentials: credentials("-new"),
    previousCredentials: {
      authToken: "old-auth",
      runEventToken: "old",
      runTerminalToken: terminalToken(),
    },
    embedder: managedTestEmbedder(),
  });

  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(receipts[0]?.status, "error");
});

for (
  const failEventAppend of [
    "missing-cursor-retry-reject",
    "missing-cursor-retry-timeout",
  ] as const
) {
  it(`fails closed when renewal cursor reconciliation retry fails with ${failEventAppend}`, async () => {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation, () => {});

    await assertRejects(
      () =>
        probe.afterRenew({
          apiUrl: "https://api.example.test",
          fetch: claimProofFetch({
            denyReplayCredentials: true,
            failEventAppend,
          }),
          workerId,
          run: probeRun(),
          credentials: credentials("-new"),
          previousCredentials: {
            authToken: "old-auth",
            runEventToken: "old",
            runTerminalToken: terminalToken(),
          },
          embedder: managedTestEmbedder(),
        }),
      Error,
      "ownership probe append outcome is ambiguous",
    );
  });
}

it("proves expired or lost lease authority is denied without exposing the retained token", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ calls, denyReplayCredentials: true, denyReplayEvent: true }),
    workerId,
    run: probeRun(),
    credentials: credentials("-expired"),
    currentCredentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "expired-lease-denial");
  assertEquals(receipts[0]?.status, "ok");
  assertEquals(receipts[0]?.deniedStatus, 409);
  assert(calls.some((call) => new URL(call.url).pathname === `/runs/${canonicalRunId}/events`));
  assert(calls.some((call) => call.headers.get("Authorization") === "Bearer writer-expired"));
  assertEquals(JSON.stringify(receipts[0]).includes("writer-expired"), false);
});

it("rejects generic 409 event conflicts as expired-lease authority proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({
      denyReplayCredentials: true,
      denyReplayEvent: true,
      replayEventDenial: "generic-409",
    }),
    workerId,
    run: probeRun(),
    credentials: credentials("-expired"),
    currentCredentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "expired-lease-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "expired-lease-source-index-or-event-write-not-denied");
});

it("releases retained source and index proof after lease-loss probing finishes", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const fetch = claimProofFetch({ denyReplayCredentials: true, denyReplayEvent: true });
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: { ...probeRun(), leaseExpiresAtMs: Date.now() - 1_000 },
    credentials: credentials("-expired"),
  });
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: { ...probeRun(), leaseExpiresAtMs: Date.now() - 1_000 },
    credentials: credentials("-expired"),
  });

  assertEquals(receipts.at(-2)?.status, "ok");
  assertEquals(receipts.at(-1)?.phase, "expired-lease-denial");
  assertEquals(receipts.at(-1)?.status, "error");
});

it("releases retained source and index proof after normal terminal completion", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const fetch = claimProofFetch({ denyReplayCredentials: true, denyReplayEvent: true });
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });
  await probe.afterTerminal?.({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: probeRun(),
    credentials: credentials(),
  });
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: { ...probeRun(), leaseExpiresAtMs: Date.now() - 1_000 },
    credentials: credentials("-expired"),
  });

  assertEquals(receipts.at(-1)?.phase, "expired-lease-denial");
  assertEquals(receipts.at(-1)?.status, "error");
});

it("tests retained authority after the original lease deadline passes", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const fetch = claimProofFetch({ calls, denyReplayCredentials: true, denyReplayEvent: true });
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });
  await probe.afterLeaseLost({
    apiUrl: "https://api.example.test",
    fetch,
    workerId,
    run: { ...probeRun(), leaseExpiresAtMs: Date.now() - 1_000 },
    credentials: credentials("-expired"),
  });

  assertEquals(receipts.at(-1)?.phase, "expired-lease-denial");
  assertEquals(receipts.at(-1)?.status, "ok");
  assert(calls.some((call) => call.headers.get("Authorization") === "Bearer writer-expired"));
});

it("rejects unrelated authorization and stop-text errors as cancelled child proof", async () => {
  for (
    const [status, body] of [
      [401, { slug: "invalid-token", detail: "Invalid token" }],
      [403, {
        slug: "authorization-denied",
        detail: "You do not have permission to invoke this task",
      }],
      [403, {
        slug: "authorization-denied",
        detail: "Workflow child admission requires its signed current execution attempt",
      }],
      [409, { slug: "state-conflict", detail: "A different operation stopped" }],
      [409, { slug: "idempotency-conflict", detail: "Parent run no longer accepts child runs" }],
      [409, { error: "parent cancelled" }],
    ] as const
  ) {
    const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      activation,
      (receipt) => receipts.push(receipt),
    );
    await probe.afterCancelled({
      apiUrl: "https://api.example.test",
      fetch: (input, init) => {
        const request = new Request(input, init);
        return Promise.resolve(
          request.method === "POST"
            ? Response.json(body, { status })
            : Response.json({ data: [{ id: 1, toolCallId: "tool-call-1" }] }),
        );
      },
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
    assertEquals(receipts[0]?.status, "error", `${status}: ${JSON.stringify(body)}`);
    assertEquals(receipts[0]?.reason, "cancelled-child-create-not-denied");
  }
});

it("proves cancelled child creation denial through the canonical runs route", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterCancelled({
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.method === "POST" && new URL(request.url).pathname === "/runs") {
        return Promise.resolve(
          Response.json({
            slug: "state-conflict",
            detail: "This execution generation is no longer current; stop execution",
          }, { status: 409 }),
        );
      }
      return Promise.resolve(Response.json({ data: [{ id: 1, toolCallId: "tool-call-1" }] }));
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "cancelled-child-denial");
  assertEquals(receipts[0]?.status, "ok");
  assertEquals(calls[1]?.url, "https://api.example.test/runs");
  const idempotencyKey = calls[1]?.headers.get("Idempotency-Key") ?? "";
  assertEquals(calls[1]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[1]?.headers.get("X-Veryfront-Run-Terminal-Token"), terminalToken());
  assertEquals(idempotencyKey.startsWith("agent-worker-child:"), true);
  assert(idempotencyKey.length <= 128);
  assertEquals(await calls[1]?.json(), {
    project_id: uuid,
    target: { type: "task", id: "agent-worker-runtime-ownership-probe" },
    parent_run_id: canonicalRunId,
    tool_call_id: "tool-call-1",
    title: "agent worker runtime ownership stale child denial probe",
    input: { probe: "agent-worker-runtime-ownership", probeId: "stage-probe" },
  });
});

it("keeps cancelled child idempotency keys within the runs API limit", async () => {
  const calls: Request[] = [];
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    { ...activation, probeId: "a".repeat(64) },
    (receipt) => receipts.push(receipt),
  );

  await probe.afterCancelled({
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      if (request.method === "POST" && new URL(request.url).pathname === "/runs") {
        return Promise.resolve(
          Response.json({
            slug: "state-conflict",
            detail: "Parent run no longer accepts child runs",
          }, { status: 409 }),
        );
      }
      return Promise.resolve(Response.json({ data: [{ id: 1, toolCallId: "tool-call-1" }] }));
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.status, "ok");
  const idempotencyKey = calls[1]?.headers.get("Idempotency-Key") ?? "";
  assertEquals(idempotencyKey.startsWith("agent-worker-child:"), true);
  assert(idempotencyKey.length <= 128);
});

it("does not accept an unrelated child idempotency conflict as cancellation proof", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterCancelled({
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST" && new URL(request.url).pathname === "/runs") {
        return Promise.resolve(Response.json({ error: "idempotency conflict" }, { status: 409 }));
      }
      return Promise.resolve(Response.json({ data: [{ id: 1, toolCallId: "tool-call-1" }] }));
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "cancelled-child-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "cancelled-child-create-not-denied");
});

it("reports cancelled child proof remaining when no invocation correlation is available", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterCancelled({
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const request = new Request(input, init);
      calls.push(request);
      return Promise.resolve(Response.json({ data: [{ id: 1 }] }));
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(calls.map((call) => call.method), ["GET"]);
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "missing-child-invocation-reference");
});

it("does not report cancelled child denial as ok when event readback fails", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterCancelled({
    apiUrl: "https://api.example.test",
    fetch: () => Promise.resolve(Response.json({ error: "denied" }, { status: 403 })),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.phase, "cancelled-child-denial");
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "event-read-failed");
});

it("fails closed when host activation is missing, expired, or outside scope", async () => {
  assertEquals(
    createAgentWorkerRuntimeOwnershipProbeFromHostEnv(1_000, () => undefined),
    undefined,
  );
  assertEquals(
    createAgentWorkerRuntimeOwnershipProbeFromHostEnv(1_000, (key) =>
      ({
        VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_STAGE: "1",
        VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID: uuid,
        VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT: "999",
      })[key]),
    undefined,
  );

  const expiredReceipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const expiredProbe = createAgentWorkerRuntimeOwnershipProbe(
    { ...activation, expiresAtMs: Date.now() - 1 },
    (receipt) => expiredReceipts.push(receipt),
  );
  await expiredProbe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: () => {
      throw new Error("fetch should not run for expired activation");
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });
  assertEquals(expiredReceipts[0]?.status, "skipped");
  assertEquals(expiredReceipts[0]?.reason, "activation-expired");

  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    { ...activation, projectId: "44444444-4444-4444-8444-444444444444" },
    (receipt) => receipts.push(receipt),
  );
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: () => {
      throw new Error("fetch should not run for out-of-scope probe");
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });
  assertEquals(receipts[0]?.status, "skipped");
  assertEquals(receipts[0]?.reason, "project-scope-mismatch");
});

it("fails closed when the run lease leaves no safe probe budget", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: () => {
      throw new Error("fetch should not run after the lease safety deadline");
    },
    workerId,
    run: { ...probeRun(), leaseExpiresAtMs: Date.now() + 500 },
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(receipts[0]?.status, "skipped");
  assertEquals(receipts[0]?.reason, "lease-deadline-expired");
});

it("external worker client passes private claim, lease, and cancellation authority to the probe", async () => {
  const seen: string[] = [];
  const probe = {
    afterClaim(input: { run: { leaseExpiresAtMs?: number | null } }) {
      seen.push(`claim:${JSON.stringify(input).includes("writer-claim")}`);
      seen.push(`lease:${typeof input.run.leaseExpiresAtMs}`);
      return Promise.resolve();
    },
    afterRenew(
      input: {
        previousCredentials?: { runEventToken: string };
        credentials: { runEventToken: string };
      },
    ) {
      seen.push(
        `renew:${input.previousCredentials?.runEventToken}->${input.credentials.runEventToken}`,
      );
      return Promise.resolve();
    },
    afterLeaseLost(input: { credentials: { runEventToken: string } }) {
      seen.push(`lease-lost:${input.credentials.runEventToken}`);
      return Promise.resolve();
    },
    afterCancelled(input: { credentials: { authToken: string; runTerminalToken: string } }) {
      seen.push(
        `cancelled:${input.credentials.authToken}:${
          input.credentials.runTerminalToken === terminalToken()
        }`,
      );
      return Promise.resolve();
    },
  };
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: probe,
    fetch: (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: { ...run(), lease_expires_at: new Date(Date.now() + 30_000).toISOString() },
          credentials: {
            auth_token: "auth-claim",
            run_event_token: "writer-claim",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/lease")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-renew",
            run_event_token: "writer-renew",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/cancel") || path.endsWith("/finalize")) {
        return Promise.resolve(Response.json({ id: canonicalRunId, status: "cancelled" }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  const claimedRun = await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  assertEquals(claimedRun?.run_id, run().run_id);
  assertEquals(
    await client.renewLease({ workerId, runId: publicRunId, leaseDurationSeconds: 30 }),
    run(),
  );
  await client.completeRun({ runId: publicRunId, status: "cancelled" });
  assertEquals(seen, [
    "claim:true",
    "lease:number",
    "renew:writer-claim->writer-renew",
    "cancelled:auth-renew:true",
  ]);
  await client.appendRunEvents({ conversationId: uuid, runId: publicRunId, events: [] }).catch(
    (error: unknown) => {
      assert(error instanceof Error);
      assert(error.message.includes("claim authority"));
    },
  );
});

it("external worker client releases probe retention on normal completion", async () => {
  const seen: string[] = [];
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: {
      afterClaim() {
        return Promise.resolve();
      },
      afterRenew() {
        return Promise.resolve();
      },
      afterLeaseLost() {
        return Promise.resolve();
      },
      afterCancelled() {
        seen.push("cancelled");
        return Promise.resolve();
      },
      afterTerminal(input: { credentials: { authToken: string } }) {
        seen.push(`terminal:${input.credentials.authToken}`);
        return Promise.resolve();
      },
    },
    fetch: (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-claim",
            run_event_token: "writer-claim",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/finalize")) {
        return Promise.resolve(Response.json({ id: canonicalRunId, status: "completed" }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  await client.completeRun({ runId: publicRunId, status: "completed" });

  assertEquals(seen, ["terminal:auth-claim"]);
});

it("external worker client probes retained authority when lease renewal returns no credentials", async () => {
  const seen: string[] = [];
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: {
      afterClaim() {
        return Promise.resolve();
      },
      afterRenew() {
        return Promise.resolve();
      },
      afterLeaseLost(input: { credentials: { runEventToken: string } }) {
        seen.push(input.credentials.runEventToken);
        return Promise.resolve();
      },
      afterCancelled() {
        return Promise.resolve();
      },
    },
    fetch: (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-claim",
            run_event_token: "writer-claim",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/lease")) {
        return Promise.resolve(Response.json({ run: null }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  assertEquals(
    await client.renewLease({ workerId, runId: publicRunId, leaseDurationSeconds: 30 }),
    null,
  );
  assertEquals(seen, ["writer-claim"]);
});

it("external worker client returns probe-advanced event cursors before worker appends", async () => {
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: {
      afterClaim() {
        return Promise.resolve({ latestExternalEventSequence: 2 });
      },
      afterRenew() {
        return Promise.resolve({ latestExternalEventSequence: 3 });
      },
      afterLeaseLost() {
        return Promise.resolve();
      },
      afterCancelled() {
        return Promise.resolve();
      },
    },
    fetch: (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/claim") || path.endsWith("/lease")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-claim",
            run_event_token: "writer-claim",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  const claimed = await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  assertEquals(claimed?.latest_external_event_sequence, 2);
  const renewed = await client.renewLease({
    workerId,
    runId: publicRunId,
    leaseDurationSeconds: 30,
  });
  assertEquals(renewed?.latest_external_event_sequence, 3);
});

it("external worker client clears lost authority before awaiting lease-loss probe", async () => {
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: {
      afterClaim() {
        return Promise.resolve();
      },
      afterRenew() {
        return Promise.resolve();
      },
      afterLeaseLost() {
        return Promise.reject(new Error("probe failed after authority was lost"));
      },
      afterCancelled() {
        return Promise.resolve();
      },
    },
    fetch: (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-claim",
            run_event_token: "writer-claim",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/lease")) return Promise.resolve(Response.json({ run: null }));
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  await client.renewLease({ workerId, runId: publicRunId, leaseDurationSeconds: 30 }).catch(
    (error: unknown) => {
      assert(error instanceof Error);
      assert(error.message.includes("probe failed"));
    },
  );
  await client.appendRunEvents({ conversationId: uuid, runId: publicRunId, events: [] }).catch(
    (error: unknown) => {
      assert(error instanceof Error);
      assert(error.message.includes("claim authority"));
    },
  );
});

it("reconciles claim cursor when the probe append cursor is unavailable", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  const result = await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ calls, failEventAppend: "missing-cursor" }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  const eventPosts = calls.filter((request) =>
    request.method === "POST" && new URL(request.url).pathname.endsWith("/events")
  );
  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(receipts[0]?.status, "ok");
  assertEquals(eventPosts.length, 2);
  assertEquals(
    eventPosts[0]?.headers.get("Idempotency-Key"),
    eventPosts[1]?.headers.get("Idempotency-Key"),
  );
  assertEquals(
    eventPosts[0]?.headers.get("Idempotency-Key")?.startsWith("agent-worker-event:"),
    true,
  );
});

it("does not send mutation requests after the probe deadline expires", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const methods: string[] = [];
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(
      { ...activation, operationTimeoutMs: 1 },
      (receipt) => receipts.push(receipt),
    );

    await probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: (input, init) => {
        const request = new Request(input, init);
        methods.push(request.method);
        // Expire after the first read dispatch, before the next page check.
        now += 2;
        return Promise.resolve(Response.json({ data: [], page_info: { next: "again" } }));
      },
      workerId,
      run: probeRun(),
      credentials: credentials(),
      embedder: managedTestEmbedder(),
    });
  } finally {
    Date.now = originalNow;
  }

  assertEquals(methods, ["GET"]);
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "operation-deadline-exceeded");
});

it("reconciles claim cursor when the probe append outcome is ambiguous", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const paths: string[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  const result = await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ paths, failEventAppend: "reject" }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(result?.latestExternalEventSequence, 2);
  assert(paths.some((path) => path === `POST /runs/${canonicalRunId}/events`));
  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
});

it("keeps fatal claim cursor classification when global Error is replaced", async () => {
  const originalError = globalThis.Error;
  let caughtMessage: string | undefined;
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation, () => {});
    const fixtureFetch = claimProofFetch({ failEventAppend: "missing-cursor-retry-reject" });
    const fetchWithPoisonedError = ((input, init) => {
      const response = fixtureFetch(input, init);
      globalThis.Error = function () {
        return {};
      } as unknown as ErrorConstructor;
      return response;
    }) as typeof fetch;

    try {
      await probe.afterClaim({
        apiUrl: "https://api.example.test",
        fetch: fetchWithPoisonedError,
        workerId,
        run: probeRun(),
        credentials: credentials(),
        embedder: managedTestEmbedder(),
      });
    } catch (error) {
      caughtMessage = error instanceof originalError ? error.message : String(error);
    }
  } finally {
    globalThis.Error = originalError;
  }
  assertEquals(caughtMessage, "Agent worker runtime ownership probe append outcome is ambiguous");
});

it("keeps fatal claim cursor classification when String.includes is replaced", async () => {
  const originalIncludes = String.prototype.includes;
  let caughtMessage: string | undefined;
  Object.defineProperty(String.prototype, "includes", {
    configurable: true,
    value: () => false,
  });
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation, () => {});
    const fixtureFetch = claimProofFetch({ failEventAppend: "missing-cursor-retry-reject" });
    const fetchWithWorkingFixture = ((input, init) => {
      Object.defineProperty(String.prototype, "includes", {
        configurable: true,
        value: originalIncludes,
      });
      try {
        return fixtureFetch(input, init);
      } finally {
        Object.defineProperty(String.prototype, "includes", {
          configurable: true,
          value: () => false,
        });
      }
    }) as typeof fetch;

    try {
      await probe.afterClaim({
        apiUrl: "https://api.example.test",
        fetch: fetchWithWorkingFixture,
        workerId,
        run: probeRun(),
        credentials: credentials(),
        embedder: managedTestEmbedder(),
      });
    } catch (error) {
      caughtMessage = error instanceof Error ? error.message : String(error);
    }
  } finally {
    Object.defineProperty(String.prototype, "includes", {
      configurable: true,
      value: originalIncludes,
    });
  }
  assertEquals(caughtMessage, "Agent worker runtime ownership probe append outcome is ambiguous");
});

for (
  const failEventAppend of [
    "missing-cursor-retry-reject",
    "missing-cursor-retry-timeout",
  ] as const
) {
  it(`fails closed when claim cursor reconciliation retry fails with ${failEventAppend}`, async () => {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation, () => {});

    await assertRejects(
      () =>
        probe.afterClaim({
          apiUrl: "https://api.example.test",
          fetch: claimProofFetch({ failEventAppend }),
          workerId,
          run: probeRun(),
          credentials: credentials(),
          embedder: managedTestEmbedder(),
        }),
      Error,
      "ownership probe append outcome is ambiguous",
    );
  });
}

it("returns the committed cursor when event append readback fails", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const result = await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: claimProofFetch({ failEventReadback: true }),
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(result?.latestExternalEventSequence, 2);
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "event-read-failed");
});

it("external worker client installs renewed authority before awaiting renewal probe", async () => {
  const authorizations: string[] = [];
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "owner",
    ownershipProbe: {
      afterClaim() {
        return Promise.resolve();
      },
      async afterRenew() {
        await client.appendRunEvents({ conversationId: uuid, runId: publicRunId, events: [] });
      },
      afterLeaseLost() {
        return Promise.resolve();
      },
      afterCancelled() {
        return Promise.resolve();
      },
    },
    fetch: (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-old",
            run_event_token: "writer-old",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/lease")) {
        return Promise.resolve(Response.json({
          run: run(),
          credentials: {
            auth_token: "auth-new",
            run_event_token: "writer-new",
            run_terminal_token: terminalToken(),
          },
        }));
      }
      if (path.endsWith("/events")) {
        authorizations.push(request.headers.get("Authorization") ?? "");
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(Response.json({ ok: true }));
    },
  });

  await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  await client.renewLease({ workerId, runId: publicRunId, leaseDurationSeconds: 30 });
  assertEquals(authorizations, ["Bearer writer-new"]);
});

it("sends probe authority only to the API origin when String.prototype.replace is replaced", async () => {
  const calls: Request[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(activation, () => {});
  const originalReplace = String.prototype.replace;
  // deno-lint-ignore no-explicit-any
  (String.prototype as any).replace = function (this: string, ...args: unknown[]) {
    if (String(this) === "https://api.example.test/") return "https://attacker.example.test";
    return Reflect.apply(originalReplace, this, args);
  };
  try {
    await probe.afterRenew({
      apiUrl: "https://api.example.test/",
      fetch: claimProofFetch({ calls, denyReplayCredentials: true, denyReplayEvent: true }),
      workerId,
      run: probeRun(),
      credentials: credentials("-new"),
      previousCredentials: {
        authToken: "old-auth",
        runEventToken: "old",
        runTerminalToken: terminalToken(),
      },
      embedder: managedTestEmbedder(),
    });
  } finally {
    String.prototype.replace = originalReplace;
  }

  assert(calls.length > 0);
  assertEquals(
    [...new Set(calls.map((call) => new URL(call.url).origin))],
    ["https://api.example.test"],
  );
  assertEquals(calls.some((call) => new URL(call.url).pathname.startsWith("//")), false);
});

it("logs default receipts with hashed identifiers only", async () => {
  const logged: unknown[][] = [];
  const currentCredentials = credentials("-new");
  const staleCredentials = {
    authToken: "old-auth",
    runEventToken: "old",
    runTerminalToken: terminalToken(),
  };
  const originalInfo = console.info;
  const originalArrayIterator = Array.prototype[Symbol.iterator];
  const originalTextEncoder = globalThis.TextEncoder;
  console.info = (...args: unknown[]) => {
    logged.push(args);
  };
  Object.defineProperty(globalThis, "TextEncoder", {
    configurable: true,
    value: class PoisonedTextEncoder {
      encode(input?: string): Uint8Array {
        if (input?.includes(workerId) || input?.includes(publicRunId)) {
          throw new Error("project TextEncoder must not hash receipt identifiers");
        }
        throw new Error("project TextEncoder must not redact receipts");
      }
    },
  });
  Array.prototype[Symbol.iterator] = function (this: unknown[]) {
    if (this[0] === "workerId" && this[4] === "sourcePath") {
      return Reflect.apply(originalArrayIterator, [], []) as ArrayIterator<unknown>;
    }
    return Reflect.apply(originalArrayIterator, this, []) as ArrayIterator<unknown>;
  };
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation);
    await probe.afterRenew({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ calls: [], denyReplayCredentials: true, denyReplayEvent: true }),
      workerId,
      run: probeRun(),
      credentials: currentCredentials,
      previousCredentials: staleCredentials,
      embedder: managedTestEmbedder(),
    });
    // The default sink hashes asynchronously after the phase settles.
    for (let turn = 0; turn < 50 && logged.length === 0; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    console.info = originalInfo;
    Object.defineProperty(globalThis, "TextEncoder", {
      configurable: true,
      value: originalTextEncoder,
    });
    Array.prototype[Symbol.iterator] = originalArrayIterator;
  }

  assertEquals(logged.length, 1);
  const receipt = logged[0]![1] as Record<string, unknown>;
  assertEquals(receipt.phase, "replaced-generation-denial");
  assertEquals(receipt.status, "ok");
  const serialized = JSON.stringify(logged);
  for (const identifier of [uuid, workerId, publicRunId, canonicalRunId]) {
    assertEquals(serialized.includes(identifier), false);
  }
  for (const field of ["workerId", "runId", "canonicalRunId", "projectId"]) {
    assertEquals(field in receipt, false);
    assertEquals(typeof receipt[`${field}Hash`], "string");
  }
});

it("uses only issued inference authority for the shipped probe embedding transport", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(activation, (r) => receipts.push(r));
  const sourceCalls: Request[] = [];
  const gatewayCalls: Request[] = [];
  const sourceFetch = claimProofFetch({ calls: sourceCalls });
  await withMockFetch((input, init) => {
    const request = new Request(input, init);
    gatewayCalls.push(request);
    return Promise.resolve(Response.json({ embedding: { values: Array(3072).fill(0.001) } }));
  }, async () => {
    const client = createExternalAgentWorkerClient({
      apiUrl: "https://api.example.test",
      authToken: "operator-must-not-be-used",
      ownershipProbe: probe,
      fetch: (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname.endsWith("/claim")) {
          return Promise.resolve(
            Response.json({
              run: { ...run(), lease_expires_at: new Date(Date.now() + 30_000).toISOString() },
              credentials: {
                auth_token: "callback-only",
                inference_token: "issued-inference-only",
                run_event_token: "writer",
                run_terminal_token: terminalToken(),
              },
            }),
          );
        }
        return sourceFetch(input, init);
      },
    });
    await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  });
  assertEquals(gatewayCalls.length, 1, JSON.stringify(receipts));
  assertEquals(gatewayCalls[0]?.headers.get("Authorization"), "Bearer issued-inference-only");
  assert(sourceCalls.every((r) => !r.headers.get("Authorization")?.includes("issued-inference")));
  assert(!JSON.stringify(receipts).includes("issued-inference-only"));
});

it("fails closed without a dedicated inference token instead of using callback or operator authority", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  let gatewayCalls = 0;
  const probe = createAgentWorkerRuntimeOwnershipProbe(activation, (r) => receipts.push(r));
  await withMockFetch(() => {
    gatewayCalls++;
    throw new Error("Inference must not be attempted");
  }, () =>
    probe.afterClaim({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch(),
      workerId,
      run: probeRun(),
      credentials: credentials(),
    }));
  assertEquals(gatewayCalls, 0);
  assertEquals(receipts[0]?.status, "error");
});

it("invalidates retained probe inference authority on inference-only renewal and completion", async () => {
  const retained: AgentWorkerRuntimeOwnershipProbeClaimInput[] = [];
  const client = createExternalAgentWorkerClient({
    apiUrl: "https://api.example.test",
    authToken: "operator",
    ownershipProbe: {
      afterClaim(input) {
        retained.push(input);
        return Promise.resolve();
      },
      afterRenew(input) {
        retained.push(input);
        return Promise.resolve();
      },
      afterLeaseLost() {
        return Promise.resolve();
      },
      afterCancelled() {
        return Promise.resolve();
      },
    },
    fetch: (input, init) => {
      const request = new Request(input, init);
      const renewal = new URL(request.url).pathname.endsWith("/lease");
      if (new URL(request.url).pathname.endsWith("/finalize")) {
        return Promise.resolve(Response.json({ id: canonicalRunId, status: "completed" }));
      }
      return Promise.resolve(Response.json({
        run: run(),
        credentials: {
          auth_token: "callback",
          run_event_token: "unchanged-writer",
          run_terminal_token: terminalToken(),
          inference_token: renewal ? "inference-new" : "inference-old",
        },
      }));
    },
  });
  await client.claimRun({ workerId, leaseDurationSeconds: 30 });
  assertEquals(retained[0]?.credentials.inferenceToken, "inference-old");
  retained[0]?.credentials.assertInferenceCredentialActive?.();
  await client.renewLease({ workerId, runId: publicRunId, leaseDurationSeconds: 30 });
  assertEquals(retained[1]?.credentials.inferenceToken, "inference-new");
  await assertRejects(
    async () => retained[0]?.credentials.assertInferenceCredentialActive?.(),
    Error,
    "inference authority",
  );
  retained[1]?.credentials.assertInferenceCredentialActive?.();
  const stale = retained[0];
  assert(stale);
  let staleGatewayCalls = 0;
  const staleReceipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const defaultProbe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (r) => staleReceipts.push(r),
  );
  await withMockFetch(() => {
    staleGatewayCalls++;
    throw new Error("Stale inference must not reach the gateway");
  }, () => defaultProbe.afterClaim({ ...stale, fetch: claimProofFetch() }));
  assertEquals(staleGatewayCalls, 0);
  assertEquals(staleReceipts[0]?.status, "error");
  await client.completeRun({ runId: publicRunId, status: "completed" });
  await assertRejects(
    async () => retained[1]?.credentials.assertInferenceCredentialActive?.(),
    Error,
    "inference authority",
  );
});
