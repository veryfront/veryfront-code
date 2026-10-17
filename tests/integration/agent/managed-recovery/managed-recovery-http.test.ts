import { makeTempDir } from "#veryfront/testing/deno-compat.ts";
import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import {
  createControlPlaneSignature,
  createCtx,
} from "#veryfront/server/handlers/request/internal-agent-run.test-helpers.ts";
import { verifyControlPlaneRequest } from "#veryfront/internal-agents/control-plane-auth.ts";

const envKey = "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY";
const identity = {
  projectId: "11111111-1111-4111-8111-111111111111",
  canonicalRunId: "22222222-2222-4222-8222-222222222222",
  publicRunId: "run-proof",
  agentId: "proof-agent",
  threadId: "77777777-7777-4777-8777-777777777777",
  sourceHash: "a".repeat(64),
};
function admission(attempt = 0) {
  return {
    version: 1,
    identity,
    generation: {
      workerId: `worker-${attempt}`,
      dispatchNonce: `66666666-6666-4666-8666-${String(attempt).padStart(12, "0")}`,
      transportRecoveryAttempt: attempt,
    },
    acknowledgedExternalSequence: 0,
    leaseRemainingMs: 10_000,
    sourceBinding: {
      projectId: identity.projectId,
      environmentId: "33333333-3333-4333-8333-333333333333",
      releaseId: "44444444-4444-4444-8444-444444444444",
    },
    eventPersistence: "runtime-owned-v1" as const,
    expiresAt: Math.floor(Date.now() / 1000) + 30,
  };
}
function receipt(value = admission()) {
  return {
    version: 1,
    identity: {
      projectId: value.identity.projectId,
      canonicalRunId: value.identity.canonicalRunId,
      publicRunId: value.identity.publicRunId,
      agentId: value.identity.agentId,
      threadId: value.identity.threadId,
    },
    generation: value.generation,
    acknowledgedEventId: 0,
    acknowledgedExternalSequence: value.acknowledgedExternalSequence,
    leaseRemainingMs: value.leaseRemainingMs,
  };
}
async function signed(value = admission()) {
  const body = JSON.stringify({
    managedRecoveryAdmission: value,
    credentials: { authToken: "NEVER_PERSIST_TEST_CREDENTIAL" },
  });
  const { jws, publicKeyPem } = await createControlPlaneSignature(body, {
    projectId: value.sourceBinding.projectId,
    requestId: identity.publicRunId,
  });
  Deno.env.set(envKey, publicKeyPem);
  const ctx = createCtx(publicKeyPem);
  ctx.projectId = value.sourceBinding.projectId;
  return await verifyControlPlaneRequest(
    new Request(`https://veryfront.test/api/control-plane/runs/${identity.publicRunId}/stream`, {
      method: "POST",
      headers: { "x-veryfront-control-plane-jws": jws },
    }),
    ctx,
    body,
  );
}

import { createRecoverySourceManifest } from "#veryfront/internal-agents/recovery-source-manifest.ts";

import {
  bindManagedRecoveryCredentials,
  createManagedRecoveryHttpTransport,
} from "#veryfront/internal-agents/managed-recovery-http.ts";
import { readManagedRecoveryBootConfig } from "#veryfront/internal-agents/managed-recovery-runtime-bootstrap.ts";
import { createHash, Hash } from "node:crypto";
import { assertThrows } from "#veryfront/testing/assert.ts";

it("paired transport keeps original credentials private, bound and redirect-free", async () => {
  const previous = Deno.env.get(envKey);
  const files = [{ path: "a.ts", entityType: "function", content: "hello" }];
  const value = admission();
  value.identity = { ...identity, sourceHash: createRecoverySourceManifest(files).hash };
  const contentHash = createHash("sha256").update("hello").digest("hex");
  let mode = "valid";
  const seen: Array<
    { path: string; auth: string | null; terminal: string | null; redirect: string | undefined }
  > = [];
  const fetcher: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const path = new URL(String(input)).pathname;
    seen.push({
      path,
      auth: headers.get("authorization"),
      terminal: headers.get("x-veryfront-run-terminal-token"),
      redirect: init?.redirect,
    });
    if (mode === "error") return new Response("private failure content", { status: 403 });
    if (mode === "oversized") return new Response("x".repeat(65_537));
    if (path.endsWith("/runtime/recovery-ownership")) return Response.json(receipt(value));
    return Response.json({
      project_id: value.sourceBinding.projectId,
      release_id: value.sourceBinding.releaseId,
      manifest_version: 1,
      manifest_hash: value.identity.sourceHash,
      file_count: 1,
      total_bytes: 5,
      files: [{
        version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        path: "a.ts",
        entity_type: "function",
        content_hash: contentHash,
        byte_size: 5,
        content: mode === "tampered" ? "wrong" : "hello",
      }],
    });
  };
  try {
    const claims = await signed(value);
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      sourceAuthToken: "original-source",
      terminalToken: "original-terminal",
    });
    const transport = createManagedRecoveryHttpTransport("https://trusted.test", fetcher);
    assertEquals(await transport.readOwnership(claims), receipt(value));
    const update = Hash.prototype.update;
    const digest = Hash.prototype.digest;
    try {
      Hash.prototype.update = function () {
        throw new Error("project replaced hash update");
      };
      Hash.prototype.digest = function () {
        throw new Error("project replaced hash digest");
      };
      assertEquals(await transport.listImmutableReleaseFiles(claims), {
        sourceBinding: value.sourceBinding,
        files,
      });
      mode = "tampered";
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      mode = "valid";
    } finally {
      Hash.prototype.update = update;
      Hash.prototype.digest = digest;
    }
    assertEquals(seen[0], {
      path: `/runs/${identity.canonicalRunId}/runtime/recovery-ownership`,
      auth: "Bearer original-invocation",
      terminal: "original-terminal",
      redirect: "error",
    });
    assert(seen[1]);
    assertEquals(seen[1].auth, "Bearer original-source");
    assertEquals(seen[1].terminal, null);
    assertEquals(seen[1].redirect, "error");
    await assertRejects(() => transport.readOwnership({ ...claims }));
    mode = "error";
    await assertRejects(() => transport.readOwnership(claims));
    mode = "oversized";
    await assertRejects(() => transport.readOwnership(claims));
    mode = "tampered";
    await assertRejects(() => transport.listImmutableReleaseFiles(claims));
    for (
      const origin of [
        "http://trusted.test",
        "https://user:secret@trusted.test",
        "https://trusted.test/path",
        "https://trusted.test/?override=1",
      ]
    ) assertThrows(() => createManagedRecoveryHttpTransport(origin, fetcher));
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("boot configuration is disabled by default and rejects partial or invalid immutable binding", async () => {
  assertEquals(readManagedRecoveryBootConfig(() => undefined), undefined);
  const directory = await makeTempDir();
  try {
    const values: Record<string, string> = {
      VERYFRONT_MANAGED_RECOVERY_ENABLED: "true",
      VERYFRONT_MANAGED_RECOVERY_DIRECTORY: directory,
      VERYFRONT_MANAGED_RECOVERY_SOURCE_PROJECT_ID: identity.projectId,
      VERYFRONT_MANAGED_RECOVERY_SOURCE_ENVIRONMENT_ID: admission().sourceBinding.environmentId,
      VERYFRONT_MANAGED_RECOVERY_SOURCE_RELEASE_ID: admission().sourceBinding.releaseId,
      VERYFRONT_API_URL: "https://trusted.test",
    };
    const config = readManagedRecoveryBootConfig((key) => values[key]);
    assertEquals(config?.sourceBinding, admission().sourceBinding);
    assertEquals(config?.apiOrigin, "https://trusted.test");
    assertThrows(() =>
      readManagedRecoveryBootConfig((key) =>
        key.endsWith("SOURCE_RELEASE_ID") ? undefined : values[key]
      )
    );
    assertThrows(() =>
      readManagedRecoveryBootConfig((key) => key.endsWith("DIRECTORY") ? "relative" : values[key])
    );
    assertThrows(() =>
      readManagedRecoveryBootConfig((key) => key.endsWith("ENABLED") ? "yes" : values[key])
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

it("canonical writer uses original credential, independent DB cursor and exact replay row acknowledgement", async () => {
  const previous = Deno.env.get(envKey);
  const originalMap = Array.prototype.map;
  try {
    const value = admission();
    const claims = await signed(value);
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      terminalToken: "original-terminal",
      writerToken: "original-writer",
    });
    let foreign = false;
    let missingRows = false;
    let replay = false;
    const bodies: unknown[] = [];
    const transport = createManagedRecoveryHttpTransport(
      "https://trusted.test",
      async (url, init) => {
        assertEquals(init?.redirect, "error");
        if (String(url).endsWith("/runtime/recovery-ownership")) {
          return Response.json({
            ...receipt(value),
            acknowledgedEventId: 91,
            acknowledgedExternalSequence: 17,
            ...(foreign ? { generation: admission(1).generation } : {}),
          });
        }
        assertEquals(String(url), `https://trusted.test/runs/${identity.canonicalRunId}/events`);
        assertEquals(new Headers(init?.headers).get("authorization"), "Bearer original-writer");
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({
          run_id: identity.canonicalRunId,
          latest_event_id: 93,
          latest_external_event_sequence: 18,
          appended_count: replay ? 0 : 1,
          model_call_captures: [{
            event_id: "capture-1",
            project_id: identity.projectId,
            run_id: identity.canonicalRunId,
            model_call_id: "99999999-9999-4999-8999-999999999999",
          }],
          ...(missingRows ? {} : { acknowledged_event_ids: [replay ? 42 : 92] }),
        });
      },
    );
    const append = await transport.createEventAppender(claims);
    Array.prototype.map = function (...args) {
      return this[0] && typeof this[0] === "object" && "event_id" in this[0]
        ? []
        : Reflect.apply(originalMap, this, args);
    };
    const accepted = await append({ type: "MESSAGES_SNAPSHOT", messages: [] });
    Array.prototype.map = originalMap;
    assertEquals(accepted.eventId, 92);
    assertEquals(accepted.modelCaptures, [{
      eventId: "capture-1",
      projectId: identity.projectId,
      runId: identity.canonicalRunId,
      modelCallId: "99999999-9999-4999-8999-999999999999",
    }]);
    assertEquals(bodies[0], {
      expected_previous_external_event_sequence: 17,
      events: [{ type: "MESSAGES_SNAPSHOT", messages: [] }],
    });
    replay = true;
    const repeated = await append({ type: "MESSAGES_SNAPSHOT", messages: [] });
    assertEquals(repeated.eventId, 42);
    missingRows = true;
    await assertRejects(() => append({ type: "MESSAGES_SNAPSHOT", messages: [] }));
    foreign = true;
    await assertRejects(() => transport.createEventAppender(claims));
    await assertRejects(() => transport.createEventAppender({ ...claims }));
  } finally {
    Array.prototype.map = originalMap;
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("suffix transport uses only original paired credentials, fixed cursors and bounded redirect-free reads", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const claims = await signed(admission());
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      sourceAuthToken: "original-source",
      terminalToken: "original-terminal",
      writerToken: "original-writer",
    });
    let oversized = false;
    const transport = createManagedRecoveryHttpTransport(
      "https://api.veryfront.test",
      async (url, init) => {
        const target = new URL(String(url));
        assertEquals(target.pathname, `/runs/${identity.canonicalRunId}/runtime/recovery-events`);
        assertEquals(target.searchParams.get("after_event_id"), "42");
        assertEquals(target.searchParams.get("through_event_id"), "91");
        assertEquals(target.searchParams.get("through_external_sequence"), "17");
        assertEquals(init?.redirect, "error");
        const headers = new Headers(init?.headers);
        assertEquals(headers.get("authorization"), "Bearer original-invocation");
        assertEquals(headers.get("x-veryfront-run-terminal-token"), "original-terminal");
        assertEquals(headers.get("x-veryfront-run-event-writer-token"), null);
        return oversized
          ? new Response("x".repeat(256 * 1024 + 1))
          : Response.json({ private: "page" });
      },
    );
    const request = {
      afterEventId: 42,
      throughEventId: 91,
      throughExternalSequence: 17,
      limit: 100,
    };
    assertEquals(await transport.readRecoverySuffixPage(claims, request), { private: "page" });
    oversized = true;
    await assertRejects(() => transport.readRecoverySuffixPage(claims, request));
    await assertRejects(() => transport.readRecoverySuffixPage(claims, { ...request, limit: 101 }));
    await assertRejects(() =>
      transport.readRecoverySuffixPage(claims, { ...request, afterEventId: 0.5 })
    );
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("authority ownership bytes cannot be replaced through a mutable decoder", async () => {
  const previous = Deno.env.get(envKey);
  const originalDecode = TextDecoder.prototype.decode;
  try {
    const claims = await signed();
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      terminalToken: "original-terminal",
    });
    const foreign = receipt(admission(1));
    const response = Response.json(foreign);
    const forged = JSON.stringify(receipt());
    const transport = createManagedRecoveryHttpTransport(
      "https://trusted.test",
      () => Promise.resolve(response),
    );
    let actual;
    try {
      TextDecoder.prototype.decode = () => forged;
      actual = await transport.readOwnership(claims);
    } finally {
      TextDecoder.prototype.decode = originalDecode;
    }
    assertEquals(actual, foreign);
  } finally {
    TextDecoder.prototype.decode = originalDecode;
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("authority reads native response state instead of project response accessors", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const claims = await signed();
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      terminalToken: "original-terminal",
    });
    const foreign = receipt(admission(1));
    let response = Response.json(foreign);
    Object.defineProperty(response, "body", { value: Response.json(receipt()).body });
    const transport = createManagedRecoveryHttpTransport(
      "https://trusted.test",
      () => Promise.resolve(response),
    );
    assertEquals(await transport.readOwnership(claims), foreign);
    response = Response.json(receipt(), { status: 403 });
    Object.defineProperty(response, "ok", { value: true });
    await assertRejects(() => transport.readOwnership(claims), Error, "authority request failed");
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("authority byte bounds ignore project chunk length accessors", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const claims = await signed();
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      terminalToken: "original-terminal",
    });
    const chunk = new TextEncoder().encode(JSON.stringify(receipt()) + " ".repeat(65_536));
    Object.defineProperty(chunk, "byteLength", { value: 0 });
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    );
    const transport = createManagedRecoveryHttpTransport(
      "https://trusted.test",
      () => Promise.resolve(response),
    );
    await assertRejects(() => transport.readOwnership(claims), Error, "exceeds its bound");
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("legacy ownership receipts cannot grant private recovery authority", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const value = admission();
    const claims = await signed(value);
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      terminalToken: "original-terminal",
      writerToken: "original-writer",
    });
    const legacy = {
      version: 1,
      identity: {
        project_id: value.identity.projectId,
        canonical_run_id: value.identity.canonicalRunId,
        public_run_id: value.identity.publicRunId,
      },
      generation: {
        worker_id: value.generation.workerId,
        dispatch_nonce: value.generation.dispatchNonce,
        transport_recovery_attempt: value.generation.transportRecoveryAttempt,
      },
      lease_remaining_ms: value.leaseRemainingMs,
      acknowledged_external_sequence: value.acknowledgedExternalSequence,
    };
    const transport = createManagedRecoveryHttpTransport("https://trusted.test", (url) => {
      assertEquals(
        String(url),
        `https://trusted.test/runs/${identity.canonicalRunId}/runtime/recovery-ownership`,
      );
      return Promise.resolve(Response.json(legacy));
    });
    await assertRejects(() => transport.readOwnership(claims));
    await assertRejects(() => transport.createEventAppender(claims));
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});
