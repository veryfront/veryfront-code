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
  const vector = Array.from({ length: 1536 }, () => 0.001);
  return {
    model: "veryfront-cloud/openai/text-embedding-3-small",
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
    model: "veryfront-cloud/openai/text-embedding-3-small",
    async embed(_text: string): Promise<number[]> {
      throw new Error("probe should request document embedding through embedMany");
    },
    async embedMany(texts: string[]): Promise<number[][]> {
      return texts.map(() => Array.from({ length: 1536 }, () => 1e300));
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
  failEventAppend?: "missing-cursor" | "reject";
  failEventReadback?: boolean;
  paginatedReadback?: boolean;
  wrongIndexVersion?: boolean;
  wrongIndexFile?: boolean;
  indexStatus?: "empty" | "wrong-file" | "wrong-version" | "not-ready";
  denyReplayCredentials?: boolean;
  replayCredentialDenial?: "authority-409" | "generic-409";
  denyReplayEvent?: boolean;
  replayEventDenial?: "authority-409" | "generic-409";
};

function claimProofFetch(options: ClaimFetchOptions = {}): typeof fetch {
  const indexedEvents: unknown[] = [];
  let sourceContent = "";
  let postedEvent = false;
  let eventReadCount = 0;
  return (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    options.calls?.push(request);
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
      if (options.replayCredentialDenial === "generic-409") {
        return Promise.resolve(
          Response.json({ slug: "state-conflict", detail: "Version conflict" }, { status: 409 }),
        );
      }
      return Promise.resolve(
        Response.json({ error: "stale or expired worker generation" }, { status: 403 }),
      );
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
        assertEquals(index.model?.name, "text-embedding-3-small");
        assertEquals(index.model?.dimension, 1536);
        assertEquals(index.chunks?.[0]?.vector?.length, 1536);
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
          checksum: "source-checksum",
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
            index_ready: options.indexStatus !== "not-ready",
          })),
        });
      });
    }
    if (request.method === "POST" && url.pathname.endsWith("/events")) {
      postedEvent = true;
      if (options.denyReplayEvent && replayCredential) {
        if (options.replayEventDenial === "authority-409") {
          return Promise.resolve(
            Response.json({
              slug: "state-conflict",
              detail: "This execution generation is no longer current; stop execution",
            }, { status: 409 }),
          );
        }
        if (options.replayEventDenial === "generic-409") {
          return Promise.resolve(
            Response.json({ slug: "state-conflict", detail: "Sequence conflict" }, { status: 409 }),
          );
        }
        return Promise.resolve(
          Response.json({ error: "stale or expired worker generation" }, { status: 403 }),
        );
      }
      if (options.failEventAppend === "reject") {
        return Promise.reject(new TypeError("connection closed"));
      }
      if (options.failEventAppend === "missing-cursor") {
        return Promise.resolve(Response.json({ ok: true }));
      }
      return request.json().then((body) => {
        indexedEvents.push(...((body as { events?: unknown[] }).events ?? []));
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
        data: postedEvent ? indexedEvents : [],
        page_info: { next: null },
      }));
    }
    return Promise.resolve(Response.json({ error: "unexpected request" }, { status: 500 }));
  };
}

it("does not expose private proof material through replaced Object or Map intrinsics", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );
  const originalAssign = Object.assign;
  const originalMapSet = Map.prototype.set;
  const originalParse = JSON.parse;
  const originalAtob = globalThis.atob;
  const originalSplit = String.prototype.split;
  const originalReplaceAll = String.prototype.replaceAll;
  let exposedPrivateMaterial = false;
  const markIfPrivate = (value: unknown) => {
    if (originalStringify(value).includes("writer") || originalStringify(value).includes("auth")) {
      exposedPrivateMaterial = true;
    }
  };
  const originalStringify = JSON.stringify;
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
      fetch: claimProofFetch(),
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
    Object.defineProperty(String.prototype, "replaceAll", {
      configurable: true,
      value: originalReplaceAll,
    });
  }

  assertEquals(receipts[0]?.status, "ok");
  assertEquals(exposedPrivateMaterial, false);
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
  assertEquals(calls[3]?.headers.get("Authorization"), "Bearer writer");
  assertEquals(calls[4]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[5]?.headers.get("Authorization"), "Bearer writer");
  const receiptJson = JSON.stringify(receipts[0]);
  assertEquals(receiptJson.includes("writer"), false);
  assertEquals(receiptJson.includes("auth"), false);
  assertEquals(receiptJson.includes("header."), false);
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
  assertEquals(receipts[0]?.deniedStatus, 403);
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

it("accepts current-generation 409 replay denials as authority proof", async () => {
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
  assertEquals(receipts[0]?.status, "ok");
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

it("fails renewal when a stale generation write commits without a cursor", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await assertRejects(
    () =>
      probe.afterRenew({
        apiUrl: "https://api.example.test",
        fetch: claimProofFetch({ denyReplayCredentials: true, failEventAppend: "missing-cursor" }),
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
    "append cursor is unavailable",
  );

  assertEquals(receipts[0]?.reason, "append-cursor-unavailable");
});

it("fails renewal when the stale generation write outcome is ambiguous", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await assertRejects(
    () =>
      probe.afterRenew({
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
      }),
    Error,
    "stale generation outcome is ambiguous",
  );

  assertEquals(receipts[0]?.status, "error");
});

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
  assertEquals(receipts[0]?.deniedStatus, 403);
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
        return Promise.resolve(Response.json({ error: "parent cancelled" }, { status: 409 }));
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
  assertEquals(calls[1]?.headers.get("Authorization"), "Bearer auth");
  assertEquals(calls[1]?.headers.get("X-Veryfront-Run-Terminal-Token"), terminalToken());
  assertEquals(await calls[1]?.json(), {
    project_id: uuid,
    target: { type: "task", id: "agent-worker-runtime-ownership-probe" },
    parent_run_id: canonicalRunId,
    tool_call_id: "tool-call-1",
    title: "agent worker runtime ownership stale child denial probe",
    input: { probe: "agent-worker-runtime-ownership", probeId: "stage-probe" },
  });
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

it("fails the claim when the probe append cursor is unavailable", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await assertRejects(
    () =>
      probe.afterClaim({
        apiUrl: "https://api.example.test",
        fetch: claimProofFetch({ failEventAppend: "missing-cursor" }),
        workerId,
        run: probeRun(),
        credentials: credentials(),
        embedder: managedTestEmbedder(),
      }),
    Error,
    "append cursor is unavailable",
  );

  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "append-cursor-unavailable");
});

it("does not send mutation requests after the probe deadline expires", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const methods: string[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    { ...activation, operationTimeoutMs: 1 },
    (receipt) => receipts.push(receipt),
  );

  await probe.afterClaim({
    apiUrl: "https://api.example.test",
    fetch: (input, init) => {
      const request = new Request(input, init);
      methods.push(request.method);
      return new Promise((resolve) =>
        setTimeout(() => resolve(Response.json({ data: [], page_info: { next: "again" } })), 5)
      );
    },
    workerId,
    run: probeRun(),
    credentials: credentials(),
    embedder: managedTestEmbedder(),
  });

  assertEquals(methods, ["GET"]);
  assertEquals(receipts[0]?.status, "error");
  assertEquals(receipts[0]?.reason, "operation-deadline-exceeded");
});

it("fails the claim when the probe append outcome is ambiguous", async () => {
  const receipts: AgentWorkerRuntimeOwnershipProbeReceipt[] = [];
  const paths: string[] = [];
  const probe = createAgentWorkerRuntimeOwnershipProbe(
    activation,
    (receipt) => receipts.push(receipt),
  );

  await assertRejects(
    () =>
      probe.afterClaim({
        apiUrl: "https://api.example.test",
        fetch: claimProofFetch({ paths, failEventAppend: "reject" }),
        workerId,
        run: probeRun(),
        credentials: credentials(),
        embedder: managedTestEmbedder(),
      }),
    Error,
    "probe append outcome is ambiguous",
  );

  assert(paths.some((path) => path === `POST /runs/${canonicalRunId}/events`));
  assertEquals(receipts[0]?.phase, "canonical-source-index");
  assertEquals(receipts[0]?.status, "error");
});

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
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const probe = createAgentWorkerRuntimeOwnershipProbe(activation);
    await probe.afterRenew({
      apiUrl: "https://api.example.test",
      fetch: claimProofFetch({ calls: [], denyReplayCredentials: true, denyReplayEvent: true }),
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
    // The default sink hashes asynchronously after the phase settles.
    for (let turn = 0; turn < 50 && logged.length === 0; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    console.info = originalInfo;
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
