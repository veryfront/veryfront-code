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
import { Buffer } from "node:buffer";
import { assertThrows } from "#veryfront/testing/assert.ts";

it("paired transport keeps original credentials private, bound and redirect-free", async () => {
  const previous = Deno.env.get(envKey);
  const files: Array<{ path: string; entityType: "function"; content: string }> = [{
    path: "a.ts",
    entityType: "function",
    content: "hello",
  }];
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
          ? new Response("x".repeat(10 * 1024 * 1024 + 256 * 1024 + 1))
          : Response.json({ private: "x".repeat(10 * 1024 * 1024 - 4096) });
      },
    );
    const request = {
      afterEventId: 42,
      throughEventId: 91,
      throughExternalSequence: 17,
      limit: 100,
    };
    assertEquals(await transport.readRecoverySuffixPage(claims, request), {
      private: "x".repeat(10 * 1024 * 1024 - 4096),
    });
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

it("native release transport preserves exact binary bytes and refuses incomplete or corrupted source", async () => {
  const previous = Deno.env.get(envKey);
  const value = admission();
  value.identity = {
    ...identity,
    sourceHash: "f41a2ea57c6e706a4c469dcf8167adf5882e810d1f3dece05de0ba2de17b8e58",
  };
  const text = {
    kind: "text",
    version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    path: "a.ts",
    entity_type: "function",
    content: "hello",
    byte_size: 5,
    content_hash: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  };
  const binary = {
    kind: "binary",
    version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    path: "knowledge/raw.bin",
    entity_type: "virtual_file",
    content_base64: "AP+ACg==",
    content_type: "application/octet-stream",
    byte_size: 4,
    content_hash: "6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1",
  };
  const valid = {
    project_id: value.sourceBinding.projectId,
    release_id: value.sourceBinding.releaseId,
    manifest_version: 2,
    manifest_hash: value.identity.sourceHash,
    file_count: 2,
    total_bytes: 9,
    files: [text, binary],
  };
  let response: unknown = valid;
  let oversized = false;
  let oversizedCancelled = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assertEquals(
      url.pathname,
      `/projects/${value.sourceBinding.projectId}/releases/${value.sourceBinding.releaseId}/source-manifest`,
    );
    assertEquals(url.search, "?representation=native");
    assertEquals(new Headers(init?.headers).get("authorization"), "Bearer original-source");
    if (oversized) {
      const chunk = new Uint8Array(1024 * 1024);
      let emitted = 0;
      return new Response(
        new ReadableStream({
          pull(controller) {
            if (++emitted <= 98) controller.enqueue(chunk);
            else controller.close();
          },
          cancel() {
            oversizedCancelled = true;
          },
        }),
        { headers: { "content-length": "1" } },
      );
    }
    return Response.json(response);
  };
  try {
    const claims = await signed(value);
    bindManagedRecoveryCredentials(claims, {
      authToken: "original-invocation",
      sourceAuthToken: "original-source",
      terminalToken: "original-terminal",
    });
    const transport = createManagedRecoveryHttpTransport("https://trusted.test", fetcher);
    const originalSome = Array.prototype.some;
    let exposedListings = 0;
    let listing: Awaited<ReturnType<typeof transport.listImmutableReleaseFiles>>;
    try {
      Array.prototype.some = function () {
        exposedListings++;
        this.length = 0;
        return true;
      };
      listing = await transport.listImmutableReleaseFiles(claims);
      response = { ...valid, files: [text] };
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      response = valid;
    } finally {
      Array.prototype.some = originalSome;
    }
    assertEquals(exposedListings, 0);
    const mimeDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "content_type");
    const { content_type: _omitted, ...missingMime } = binary;
    const kindDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "kind");
    const versionDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "manifest_version");
    const filesDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "files");
    let mimeExposures = 0;
    try {
      Object.defineProperty(Object.prototype, "content_type", {
        configurable: true,
        get() {
          mimeExposures++;
          return "application/octet-stream";
        },
      });
      response = { ...valid, files: [text, missingMime] };
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      const { kind: _kind, ...withoutKind } = missingMime;
      Object.defineProperty(Object.prototype, "kind", { configurable: true, value: "binary" });
      response = { ...valid, files: [text, withoutKind] };
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      if (kindDescriptor) Object.defineProperty(Object.prototype, "kind", kindDescriptor);
      else Reflect.deleteProperty(Object.prototype, "kind");
      const { manifest_version: _version, ...withoutVersion } = valid;
      Object.defineProperty(Object.prototype, "manifest_version", {
        configurable: true,
        get() {
          mimeExposures++;
          return 2;
        },
      });
      response = withoutVersion;
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      const { files: _files, ...withoutFiles } = valid;
      Object.defineProperty(Object.prototype, "files", {
        configurable: true,
        get() {
          mimeExposures++;
          return valid.files;
        },
      });
      response = withoutFiles;
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      response = valid;
      await transport.listImmutableReleaseFiles(claims);
    } finally {
      if (filesDescriptor) Object.defineProperty(Object.prototype, "files", filesDescriptor);
      else Reflect.deleteProperty(Object.prototype, "files");
      if (versionDescriptor) {
        Object.defineProperty(Object.prototype, "manifest_version", versionDescriptor);
      } else Reflect.deleteProperty(Object.prototype, "manifest_version");
      if (kindDescriptor) Object.defineProperty(Object.prototype, "kind", kindDescriptor);
      else Reflect.deleteProperty(Object.prototype, "kind");
      if (mimeDescriptor) Object.defineProperty(Object.prototype, "content_type", mimeDescriptor);
      else Reflect.deleteProperty(Object.prototype, "content_type");
    }
    assertEquals(mimeExposures, 0);
    assertEquals(createRecoverySourceManifest(listing.files), {
      version: 2,
      hash: value.identity.sourceHash,
      fileCount: 2,
      totalBytes: 9,
    });
    for (
      const invalid of [
        { ...valid, files: [text] },
        { ...valid, files: [text, { ...binary, content_base64: "AP+ACg=" }] },
        { ...valid, files: [text, { ...binary, content_base64: "AP+ACn==" }] },
        { ...valid, files: [text, { ...binary, content_hash: "a".repeat(64) }] },
        { ...valid, files: [text, { ...binary, byte_size: 3 }] },
        { ...valid, files: [text, { ...binary, content_type: "image/png" }] },
        { ...valid, files: [text, { ...binary, content_type: undefined }] },
        { ...valid, files: [text, { ...binary, content_type: "image/png\n" }] },
        { ...valid, files: [text, { ...binary, byte_size: 8 * 1024 * 1024 + 1 }] },
        { ...valid, release_id: "88888888-8888-4888-8888-888888888888" },
        { ...valid, project_id: "88888888-8888-4888-8888-888888888888" },
        { ...valid, total_bytes: 8 },
        { ...valid, manifest_version: 1 },
      ]
    ) {
      response = invalid;
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
    }
    oversized = true;
    await assertRejects(
      () => transport.listImmutableReleaseFiles(claims),
      Error,
      "response exceeds its bound",
    );
    assertEquals(oversizedCancelled, true);
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("native API fixture passes transport integrity and independent host admission without omitting binary members", async () => {
  for (
    const fixture of [
      (await import("../../../fixtures/contracts/api-native-release-source-manifest.json", {
        with: { type: "json" },
      })).default,
      (await import(
        "../../../fixtures/contracts/api-native-release-source-manifest-legacy-metadata.json",
        { with: { type: "json" } }
      )).default,
    ]
  ) {
    const { createManagedRecoveryHostFactory } = await import(
      "#veryfront/internal-agents/managed-recovery-host.ts"
    );
    const { AgentRunSessionManager } = await import(
      "#veryfront/internal-agents/session-manager.ts"
    );
    const previous = Deno.env.get(envKey);
    const directory = await makeTempDir();
    const value = admission();
    value.sourceBinding = {
      ...value.sourceBinding,
      projectId: fixture.project_id,
      releaseId: fixture.release_id,
    };
    value.identity = { ...identity, sourceHash: fixture.manifest_hash };
    let payload: unknown = fixture;
    let overrideFiles: unknown;
    const transport = createManagedRecoveryHttpTransport("https://trusted.test", async (input) => {
      const url = new URL(String(input));
      assertEquals(
        url.pathname,
        `/projects/${fixture.project_id}/releases/${fixture.release_id}/source-manifest`,
      );
      assertEquals(url.searchParams.get("representation"), "native");
      return Response.json(payload);
    });
    const manager = new AgentRunSessionManager({
      recoveryOwnerFactory: createManagedRecoveryHostFactory({
        sourceBinding: value.sourceBinding,
        durableDirectory: directory,
        listImmutableReleaseFiles: async (claims) => {
          const listing = await transport.listImmutableReleaseFiles(claims);
          return overrideFiles === undefined ? listing : { ...listing, files: overrideFiles };
        },
        validateCurrentOwnership: async () => receipt(value),
        loadAcknowledgedSnapshot: async () => undefined,
      }),
    });
    try {
      const claims = await signed(value);
      bindManagedRecoveryCredentials(claims, {
        authToken: "fixture-invocation",
        sourceAuthToken: "fixture-source",
        terminalToken: "fixture-terminal",
      });
      const listing = await transport.listImmutableReleaseFiles(claims);
      assertEquals(createRecoverySourceManifest(listing.files), {
        version: fixture.manifest_version,
        hash: fixture.manifest_hash,
        fileCount: fixture.file_count,
        totalBytes: fixture.total_bytes,
      });
      const binary = fixture.files.find((file) => file.kind === "binary");
      assert(typeof binary?.content_base64 === "string");
      assert(typeof binary.content_type === "string");
      const listedBinary = listing.files.find((file) => "kind" in file && file.kind === "binary");
      assert(listedBinary && "contentType" in listedBinary);
      assertEquals(listedBinary.contentType, binary.content_type);
      assertEquals(Array.from(Buffer.from(binary.content_base64, "base64")), [
        239,
        187,
        191,
        0,
        255,
        128,
        10,
      ]);
      assert(
        fixture.files.some((file) =>
          file.kind === "text" && typeof file.content === "string" &&
          file.content.startsWith("\uFEFF")
        ),
      );
      for (
        const invalid of [
          { ...fixture, files: fixture.files.slice(0, -1) },
          {
            ...fixture,
            files: fixture.files.map((file) =>
              file.kind === "binary" ? { ...file, content_base64: "AAAA" } : file
            ),
          },
          {
            ...fixture,
            files: fixture.files.map((file) =>
              file.kind === "text" && typeof file.content === "string"
                ? { ...file, content: file.content.replace(/^\uFEFF/, "") }
                : file
            ),
          },
        ]
      ) {
        payload = invalid;
        await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      }
      payload = {
        ...fixture,
        files: fixture.files.map((file) =>
          file.kind === "binary"
            ? {
              ...file,
              content_type: file.content_type === "image/png"
                ? "application/octet-stream"
                : "image/png",
            }
            : file
        ),
      };
      await assertRejects(() => transport.listImmutableReleaseFiles(claims));
      payload = fixture;
      overrideFiles = listing.files.map((file) =>
        "kind" in file && file.kind === "binary"
          ? {
            ...file,
            contentType: "contentType" in file && file.contentType === "image/png"
              ? "application/octet-stream"
              : "image/png",
          }
          : file
      );
      await assertRejects(() =>
        manager.startManagedRecoveryRun({
          runId: identity.publicRunId,
          threadId: "fixture-thread",
          claims,
        })
      );
      overrideFiles = listing.files.slice(0, -1);
      await assertRejects(() =>
        manager.startManagedRecoveryRun({
          runId: identity.publicRunId,
          threadId: "fixture-thread",
          claims,
        })
      );
      overrideFiles = undefined;
      const started = await manager.startManagedRecoveryRun({
        runId: identity.publicRunId,
        threadId: "fixture-thread",
        claims,
      });
      assertEquals(started.signal.aborted, false);
      manager.completeRun(identity.publicRunId, started.signal);
      started.settle();
    } finally {
      manager.reset();
      await Deno.remove(directory, { recursive: true });
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  }
});

it("empty and all-text release transport stays v1 and rejects internally consistent v2 without binary membership", async () => {
  const previous = Deno.env.get(envKey);
  try {
    const cases: Array<Array<{ path: string; entityType: "function"; content: string }>> = [
      [],
      [{ path: "a.ts", entityType: "function", content: "hello" }],
    ];
    for (const files of cases) {
      const legacy = createRecoverySourceManifest(files);
      const value = admission();
      value.identity = { ...identity, sourceHash: legacy.hash };
      const wireFiles = files.map((file) => ({
        version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        path: file.path,
        entity_type: file.entityType,
        content: file.content,
        byte_size: Buffer.byteLength(file.content),
        content_hash: createHash("sha256").update(file.content).digest("hex"),
      }));
      let payload: unknown = {
        project_id: value.sourceBinding.projectId,
        release_id: value.sourceBinding.releaseId,
        manifest_version: 1,
        manifest_hash: legacy.hash,
        file_count: legacy.fileCount,
        total_bytes: legacy.totalBytes,
        files: wireFiles,
      };
      const transport = createManagedRecoveryHttpTransport(
        "https://trusted.test",
        async () => Response.json(payload),
      );
      const claims = await signed(value);
      bindManagedRecoveryCredentials(claims, {
        authToken: "text-invocation",
        sourceAuthToken: "text-source",
        terminalToken: "text-terminal",
      });
      assertEquals((await transport.listImmutableReleaseFiles(claims)).files, files);
      const nativeHash = createHash("sha256").update(
        JSON.stringify({
          version: 2,
          files: wireFiles.map((file) => ({
            path: file.path,
            type: file.entity_type,
            kind: "text",
            contentHash: file.content_hash,
            byteSize: file.byte_size,
          })),
        }),
      ).digest("hex");
      value.identity = { ...identity, sourceHash: nativeHash };
      payload = {
        project_id: value.sourceBinding.projectId,
        release_id: value.sourceBinding.releaseId,
        manifest_version: 2,
        manifest_hash: nativeHash,
        file_count: legacy.fileCount,
        total_bytes: legacy.totalBytes,
        files: wireFiles.map((file) => ({ ...file, kind: "text" })),
      };
      const nativeClaims = await signed(value);
      bindManagedRecoveryCredentials(nativeClaims, {
        authToken: "native-invocation",
        sourceAuthToken: "native-source",
        terminalToken: "native-terminal",
      });
      await assertRejects(() => transport.listImmutableReleaseFiles(nativeClaims));
    }
  } finally {
    if (previous === undefined) Deno.env.delete(envKey);
    else Deno.env.set(envKey, previous);
  }
});

it("transport preserves the producer-admitted 96 MiB JSON boundary for v1 and native v2", async () => {
  const { createHash } = await import("node:crypto");
  const { Buffer } = await import("node:buffer");
  const { createRecoverySourceManifest } = await import(
    "#veryfront/internal-agents/recovery-source-manifest.ts"
  );
  const { bindManagedRecoveryCredentials, createManagedRecoveryHttpTransport } = await import(
    "#veryfront/internal-agents/managed-recovery-http.ts"
  );
  // Same admitted recipe exercised through the API producer and registered Hono route:
  // two valid UTF-8 control-character text files, plus seven raw bytes for v2.
  // Encoded JSON, rather than raw text/base64 capacity, is limited to 96 MiB.
  for (const native of [false, true]) {
    const value = admission();
    const texts = ["\u0001".repeat(8 * 1024 * 1024), "x"];
    const bytes = Buffer.from([239, 187, 191, 0, 255, 128, 10]);
    const build = () => {
      const files = texts.map((content, index) => ({
        path: `knowledge/text-${index}.md`,
        entityType: "virtual_file" as const,
        ...(native ? { kind: "text" as const } : {}),
        content,
      }));
      const all = native
        ? [...files, {
          kind: "binary" as const,
          path: "knowledge/raw.bin",
          entityType: "virtual_file" as const,
          contentBase64: bytes.toString("base64"),
          contentType: "application/octet-stream",
          contentHash: createHash("sha256").update(bytes).digest("hex"),
          byteSize: bytes.length,
        }]
        : files;
      const digest = createRecoverySourceManifest(all);
      const payload = {
        project_id: value.sourceBinding.projectId,
        release_id: value.sourceBinding.releaseId,
        manifest_version: native ? 2 : 1,
        manifest_hash: digest.hash,
        file_count: digest.fileCount,
        total_bytes: digest.totalBytes,
        files: all.map((file, index) => ({
          version_id: `30000000-3000-4000-8000-00000000000${index}`,
          path: file.path,
          entity_type: file.entityType,
          ...(native ? { kind: file.kind } : {}),
          content_hash: "content" in file
            ? createHash("sha256").update(file.content).digest("hex")
            : file.contentHash,
          byte_size: "content" in file ? Buffer.byteLength(file.content) : file.byteSize,
          ...("content" in file
            ? { content: file.content }
            : { content_base64: file.contentBase64, content_type: file.contentType }),
        })),
      };
      return { digest, payload };
    };
    const cap = 96 * 1024 * 1024;
    const seed = Buffer.byteLength(JSON.stringify(build().payload));
    // Leave room for total_bytes digit growth, then fill the exact encoded remainder.
    const available = cap - seed - 64;
    texts[1] = "\u0001".repeat(Math.floor(available / 6)) + "x".repeat(available % 6);
    texts[1] += "x".repeat(cap - Buffer.byteLength(JSON.stringify(build().payload)));
    const { digest, payload } = build();
    assertEquals(Buffer.byteLength(JSON.stringify(payload)), cap);
    value.identity = { ...identity, sourceHash: digest.hash };
    const previous = Deno.env.get(envKey);
    try {
      const claims = await signed(value);
      bindManagedRecoveryCredentials(claims, {
        authToken: "original-invocation",
        sourceAuthToken: "original-source",
        terminalToken: "original-terminal",
      });
      const transport = createManagedRecoveryHttpTransport(
        "https://trusted.test",
        async () => Response.json(payload),
      );
      const actual = await transport.listImmutableReleaseFiles(claims);
      assertEquals(createRecoverySourceManifest(actual.files), digest);
    } finally {
      if (previous === undefined) Deno.env.delete(envKey);
      else Deno.env.set(envKey, previous);
    }
  }
});
