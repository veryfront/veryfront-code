import {
  bindHostedToolCallAdmissionWriter,
  createHostedRunEventWriterCapability,
} from "#veryfront/agent/hosted/child-run-event-writer-token.ts";
import {
  type AdmitExecutorToolCall,
  bindToolCallAdmissionOwner,
} from "#veryfront/runtime/tool-call-admission-dispatch.ts";
import { pushPrivateArray } from "#veryfront/security/private-array.ts";
import {
  privateByteLength,
  PrivateUint8Array,
  setPrivateBytes,
} from "#veryfront/security/private-bytes.ts";
import { createPrivateTextDecoder } from "#veryfront/security/private-text.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { isPrivateConversationRunEvent } from "#veryfront/agent/conversation/private-run-event.ts";
import { readRecoveryAppendAcknowledgement } from "./recovery-append-acknowledgement.ts";
import type { RecoveryEventAppend } from "./managed-recovery-writer.ts";
import { cancelPrivateStream, getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import {
  assertNativeRequestProcessing,
  createNativeRequestInit,
} from "#veryfront/platform/compat/http/native-request-init.ts";
import { createVeryfrontApiOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import {
  getRecoveryOwnershipReceiptSchema,
  type RecoveryAdmission,
} from "./recovery-admission-schema.ts";
import { MAX_RECOVERY_SUFFIX_PAGE_BYTES } from "./recovery-suffix.ts";
import { createRecoverySourceManifest } from "./recovery-source-manifest.ts";

const NativeURL = URL;
const parseJson = JSON.parse;
const apply = Reflect.apply;
const responseBody = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const responseOk = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const timeout = AbortSignal.timeout.bind(AbortSignal);
const privateCredentials = createPrivateWeakStore<
  object,
  Readonly<{
    invocation: string;
    terminal: string;
    source: string;
    writer?: string;
    admission: RecoveryAdmission;
  }>
>();
const token = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 16_384 &&
  /^[\x21-\x7e]+$/.test(value);

/** Original signed-body credentials and original header only; no credential getter is exported. */
export function bindManagedRecoveryCredentials(
  claims: VerifiedControlPlaneRequestClaims,
  input: {
    authToken?: string;
    sourceAuthToken?: string;
    terminalToken: string | null;
    writerToken?: string | null;
  },
): void {
  const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
  if (!admission) return;
  const source = input.sourceAuthToken ?? input.authToken;
  if (
    !token(input.authToken) || !token(input.terminalToken) || !token(source) ||
    (admission.identity.projectId !== admission.sourceBinding.projectId && !input.sourceAuthToken)
  ) {
    throw new Error("Managed recovery requires original paired and source credentials");
  }
  if (privateCredentials.get(claims)) throw new Error("Managed recovery credentials already bound");
  privateCredentials.set(
    claims,
    Object.freeze({
      invocation: input.authToken,
      terminal: input.terminalToken,
      source,
      ...(input.writerToken == null ? {} : { writer: input.writerToken }),
      admission,
    }),
  );
}

const getManifestSchema = defineSchema((v) =>
  v.object({
    project_id: v.string().uuid(),
    release_id: v.string().uuid(),
    manifest_version: v.literal(1),
    manifest_hash: v.string().regex(/^[a-f0-9]{64}$/),
    file_count: v.number().int().min(0).max(10_000),
    total_bytes: v.number().int().min(0).max(64 * 1024 * 1024),
    files: v.array(
      v.object({
        version_id: v.string().uuid(),
        path: v.string().min(1).max(1_024),
        entity_type: v.enum(["page", "component", "function", "virtual_file"]),
        content_hash: v.string().regex(/^[a-f0-9]{64}$/),
        byte_size: v.number().int().min(0).max(8 * 1024 * 1024),
        content: v.string(),
      }).strict(),
    ).max(10_000),
  }).strict()
);

async function readBoundedJson(response: Response, maximum: number): Promise<unknown> {
  const body: ReadableStream<Uint8Array> | null = apply(responseBody, response, []);
  if (!apply(responseOk, response, []) || !body) {
    if (body) await cancelPrivateStream(body).catch(() => {});
    throw new Error("Managed recovery authority request failed");
  }
  const reader = getPrivateStreamReader(body);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += privateByteLength(result.value);
      if (size > maximum) throw new Error("Managed recovery authority response exceeds its bound");
      pushPrivateArray(chunks, result.value);
    }
    const bytes = new PrivateUint8Array(size);
    let offset = 0;
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index]!;
      setPrivateBytes(bytes, chunk, offset);
      offset += privateByteLength(chunk);
    }
    return parseJson(createPrivateTextDecoder("utf-8", { fatal: true }).decode(bytes));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Capture a host-configured origin and transport once, before project evaluation. */
export function createManagedRecoveryHttpTransport(
  apiOrigin: string,
  fetcher?: typeof fetch,
) {
  const origin = new NativeURL(apiOrigin);
  if (
    origin.protocol !== "https:" || origin.username || origin.password || origin.search ||
    origin.hash || (origin.pathname !== "/" && origin.pathname !== "")
  ) {
    throw new Error("Managed recovery requires a trusted HTTPS API origin");
  }
  const fetchCaptured = fetcher ?? createVeryfrontApiOriginBoundOutboundFetch(apiOrigin);
  const request = (path: string, headers: Record<string, string>) => {
    const init = createNativeRequestInit(undefined, {
      method: "GET",
      redirect: "error",
      signal: timeout(10_000),
      headers,
      cache: "no-store",
    });
    assertNativeRequestProcessing();
    return fetchCaptured(new NativeURL(path, origin), init);
  };
  const credentialsFor = (claims: VerifiedControlPlaneRequestClaims) => {
    const credentials = privateCredentials.get(claims);
    if (!credentials) throw new Error("Managed recovery credentials unavailable");
    return credentials;
  };
  return Object.freeze({
    async readRecoverySuffixPage(
      claims: VerifiedControlPlaneRequestClaims,
      input: {
        afterEventId: number;
        throughEventId: number;
        throughExternalSequence: number;
        limit: number;
      },
    ): Promise<unknown> {
      const credentials = credentialsFor(claims);
      for (
        const cursor of [input.afterEventId, input.throughEventId, input.throughExternalSequence]
      ) {
        if (!Number.isSafeInteger(cursor) || cursor < 0) {
          throw new Error("Managed recovery suffix cursor is invalid");
        }
      }
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
        throw new Error("Managed recovery suffix page bound is invalid");
      }
      return await readBoundedJson(
        await request(
          `/runs/${credentials.admission.identity.canonicalRunId}/runtime/recovery-events` +
            `?after_event_id=${input.afterEventId}&through_event_id=${input.throughEventId}&through_external_sequence=${input.throughExternalSequence}&limit=${input.limit}`,
          {
            authorization: `Bearer ${credentials.invocation}`,
            "x-veryfront-run-terminal-token": credentials.terminal,
          },
        ),
        MAX_RECOVERY_SUFFIX_PAGE_BYTES,
      );
    },
    createToolAdmissionBinder(claims: VerifiedControlPlaneRequestClaims) {
      const credentials = credentialsFor(claims);
      if (!token(credentials.writer)) {
        throw new Error("Managed recovery original event writer is unavailable");
      }
      const identity = credentials.admission.identity;
      const capability = createHostedRunEventWriterCapability({
        apiUrl: apiOrigin,
        runId: identity.publicRunId,
        canonicalRunId: identity.canonicalRunId,
        runEventAppendToken: credentials.writer,
        fetch: fetchCaptured,
      });
      return (callback: AdmitExecutorToolCall) => {
        bindHostedToolCallAdmissionWriter(callback, {
          capability,
          expectedRunId: identity.publicRunId,
          projectId: identity.projectId,
        });
        bindToolCallAdmissionOwner(callback, {
          runId: identity.publicRunId,
          canonicalRunId: identity.canonicalRunId,
          projectId: identity.projectId,
        });
      };
    },
    async createEventAppender(
      claims: VerifiedControlPlaneRequestClaims,
    ): Promise<RecoveryEventAppend> {
      const credentials = credentialsFor(claims);
      const writer = credentials.writer;
      if (!token(writer)) throw new Error("Managed recovery original event writer is unavailable");
      const canonicalRunId = credentials.admission.identity.canonicalRunId;
      const initial = getRecoveryOwnershipReceiptSchema().parse(
        await readBoundedJson(
          await request(
            `/runs/${canonicalRunId}/runtime/recovery-ownership`,
            {
              authorization: `Bearer ${credentials.invocation}`,
              "x-veryfront-run-terminal-token": credentials.terminal,
            },
          ),
          65_536,
        ),
      );
      const admission = credentials.admission;
      if (
        initial.identity.projectId !== admission.identity.projectId ||
        initial.identity.canonicalRunId !== admission.identity.canonicalRunId ||
        initial.identity.publicRunId !== admission.identity.publicRunId ||
        initial.identity.agentId !== admission.identity.agentId ||
        initial.identity.threadId !== admission.identity.threadId ||
        initial.generation.workerId !== admission.generation.workerId ||
        initial.generation.dispatchNonce !== admission.generation.dispatchNonce ||
        initial.generation.transportRecoveryAttempt !==
          admission.generation.transportRecoveryAttempt
      ) {
        throw new Error("Recovery event writer ownership receipt is foreign");
      }
      let eventCursor = initial.acknowledgedEventId;
      let externalCursor = initial.acknowledgedExternalSequence;
      return async (event, occurrenceId, recoveryCheckpoint) => {
        const isPrivate = isPrivateConversationRunEvent(event);
        if (occurrenceId && event.type !== "TOOL_CALL_START") {
          throw new Error("Recovery occurrence lacks its original tool start");
        }
        const body = privateJsonStringify(
          {
            ...(isPrivate
              ? { expected_previous_event_id: eventCursor }
              : { expected_previous_external_event_sequence: externalCursor }),
            ...(occurrenceId
              ? { tool_call_starts: [{ occurrence_id: occurrenceId, event_index: 0 }] }
              : {}),
            events: [event],
            ...(recoveryCheckpoint ? { recovery_checkpoint: recoveryCheckpoint } : {}),
          },
          null,
          undefined,
          1_048_576,
        );
        const init = createNativeRequestInit(undefined, {
          method: "POST",
          redirect: "error",
          signal: timeout(10_000),
          cache: "no-store",
          headers: {
            authorization: `Bearer ${writer}`,
            "content-type": "application/json",
            "cache-control": "no-store",
          },
          body,
        });
        assertNativeRequestProcessing();
        const response = await fetchCaptured(
          new NativeURL(`/runs/${canonicalRunId}/events`, origin),
          init,
        );
        const acknowledgement = await readRecoveryAppendAcknowledgement(
          response,
          canonicalRunId,
          isPrivate ? externalCursor : undefined,
        );
        if (acknowledgement.acknowledged_event_ids?.length !== 1) {
          throw new Error("Recovery append lacks the exact accepted event row");
        }
        if (
          acknowledgement.latest_event_id < eventCursor ||
          acknowledgement.latest_external_event_sequence < externalCursor
        ) {
          throw new Error("Recovery append cursor regressed");
        }
        eventCursor = acknowledgement.latest_event_id;
        externalCursor = acknowledgement.latest_external_event_sequence;
        return {
          eventId: acknowledgement.acknowledged_event_ids[0]!,
          ...(acknowledgement.recovery_checkpoint
            ? { recoveryCheckpoint: acknowledgement.recovery_checkpoint }
            : {}),
          externalSequence: externalCursor,
          toolAdmissions: acknowledgement.tool_call_admissions ?? [],
          modelCaptures: acknowledgement.model_call_captures?.map((capture) => ({
            eventId: capture.event_id,
            projectId: capture.project_id,
            runId: capture.run_id,
            modelCallId: capture.model_call_id,
          })),
        };
      };
    },
    readOwnership: async (claims: VerifiedControlPlaneRequestClaims) => {
      const credentials = credentialsFor(claims);
      const response = await request(
        `/runs/${credentials.admission.identity.canonicalRunId}/runtime/recovery-ownership`,
        {
          authorization: `Bearer ${credentials.invocation}`,
          "x-veryfront-run-terminal-token": credentials.terminal,
        },
      );
      return getRecoveryOwnershipReceiptSchema().parse(await readBoundedJson(response, 65_536));
    },
    listImmutableReleaseFiles: async (claims: VerifiedControlPlaneRequestClaims) => {
      const credentials = credentialsFor(claims);
      const binding = credentials.admission.sourceBinding;
      const response = await request(
        `/projects/${binding.projectId}/releases/${binding.releaseId}/source-manifest`,
        {
          authorization: `Bearer ${credentials.source}`,
        },
      );
      const manifest = getManifestSchema().parse(await readBoundedJson(response, 96 * 1024 * 1024));
      const files = manifest.files.map((file) => {
        if (
          Buffer.byteLength(file.content, "utf8") !== file.byte_size ||
          createHash("sha256").update(file.content, "utf8").digest("hex") !== file.content_hash
        ) {
          throw new Error("Managed recovery release file integrity failed");
        }
        return { path: file.path, entityType: file.entity_type, content: file.content };
      });
      const computed = createRecoverySourceManifest(files);
      if (
        manifest.project_id !== binding.projectId || manifest.release_id !== binding.releaseId ||
        manifest.manifest_hash !== computed.hash || manifest.file_count !== computed.fileCount ||
        manifest.total_bytes !== computed.totalBytes ||
        computed.hash !== credentials.admission.identity.sourceHash
      ) {
        throw new Error("Managed recovery release manifest binding failed");
      }
      return { sourceBinding: binding, files };
    },
  });
}
