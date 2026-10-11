import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { inspectOkfDocument } from "#veryfront/knowledge/okf-document.ts";

export interface OwnershipIndexClient {
  get<T>(
    path: string,
    params?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
  postRaw<T>(path: string, body: string, options?: { signal?: AbortSignal }): Promise<T>;
}
export interface OwnershipIndexProof {
  requestHash: string;
  readinessBeforeHash?: string;
  readinessAfterHash: string;
  authorizationDenied: boolean;
}
const encode = encodeURIComponent;
const match = RegExp.prototype.exec;
const apply = Reflect.apply;
const denied = /(?:^|\D)(401|403)(?:\D|$)/;
const finite = Number.isFinite;
const float32 = Math.fround;
const errorPrototype = Error.prototype;
const isPrototype = Object.prototype.isPrototypeOf;
const arrayIsArray = Array.isArray;
const ceil = Math.ceil;
const max = Math.max;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** The host retains real vectors and replays identical bytes for stale authority; no new inference. */
export function createRuntimeOwnershipIndexProbe(input: {
  projectId: string;
  branchId?: string;
  createWriter(signal: AbortSignal): OwnershipIndexClient;
  createReader(signal: AbortSignal): OwnershipIndexClient;
  embed(text: string, signal: AbortSignal): Promise<number[]>;
}) {
  let retained: { wire: string; path: string; fileId: string; versionId: string } | undefined;
  return async (
    request: { sourcePath: string; content: string; stale: boolean; signal: AbortSignal },
  ): Promise<OwnershipIndexProof> => {
    const { signal } = request;
    const writer = input.createWriter(signal);
    const reader = input.createReader(signal);
    const filePath = `/projects/${encode(input.projectId)}/files/${encode(request.sourcePath)}`;
    const canonical: unknown = await reader.get(
      filePath,
      input.branchId ? { branch_id: input.branchId } : undefined,
      { signal },
    );
    if (
      !record(canonical) || typeof canonical.id !== "string" ||
      !apply(match, uuid, [canonical.id]) ||
      typeof canonical.version_id !== "string" || !apply(match, uuid, [canonical.version_id]) ||
      canonical.content !== request.content || canonical.path !== request.sourcePath ||
      canonical.checksum !== await computeHash(request.content)
    ) throw new Error("Canonical index source identity changed");
    const ready = async () => {
      const response: unknown = await reader.post(
        `/projects/${encode(input.projectId)}/knowledge/index-status`,
        {
          paths: [request.sourcePath],
          lookup_target: input.branchId
            ? { kind: "preview_branch", branch_id: input.branchId }
            : { kind: "preview_branch", branch_id: null },
        },
        { signal },
      );
      if (!record(response) || !arrayIsArray(response.data) || response.data.length !== 1) {
        throw new Error("Index readiness is incomplete");
      }
      const row: unknown = response.data[0];
      if (
        !record(row) || row.path !== request.sourcePath || row.file_id !== canonical.id ||
        row.file_version_id !== canonical.version_id || row.index_ready !== true
      ) throw new Error("Current canonical version is not index ready");
      return await computeHash(privateJsonStringify(response));
    };
    const indexPath = `/projects/${encode(input.projectId)}/branches/${
      encode(input.branchId ?? "main")
    }/files/${encode(request.sourcePath)}/index`;
    if (request.stale) {
      if (
        !retained || retained.path !== request.sourcePath || retained.fileId !== canonical.id ||
        retained.versionId !== canonical.version_id
      ) throw new Error("No matching current canonical index receipt");
      const before = await ready();
      let rejected = false;
      try {
        await writer.postRaw(indexPath, retained.wire, { signal });
      } catch (error) {
        const message = apply(isPrototype, errorPrototype, [error]) && record(error) &&
            typeof error.message === "string"
          ? error.message
          : "";
        if (!apply(match, denied, [message])) {
          throw new Error("Index request failed without authorization denial");
        }
        rejected = true;
      }
      if (!rejected) throw new Error("Stale canonical index was accepted");
      const after = await ready();
      if (before !== after) throw new Error("Stale canonical index changed readiness");
      return {
        requestHash: await computeHash(retained.wire),
        readinessBeforeHash: before,
        readinessAfterHash: after,
        authorizationDenied: true,
      };
    }
    const inspected = inspectOkfDocument(request.sourcePath, request.content);
    const body = inspected.body;
    if (!body.trim()) throw new Error("Index probe requires a nonempty complete canonical body");
    const vector = await input.embed(body, signal);
    if (
      !arrayIsArray(vector) || vector.length !== 1536 || (() => {
        for (let i = 0; i < vector.length; i++) {
          const value = vector[i];
          if (typeof value !== "number" || !finite(value) || !finite(float32(value))) return true;
        }
        return false;
      })()
    ) throw new Error("Managed index probe vector is invalid");
    const offset = request.content.length - body.length;
    const payload = {
      expected_version_id: canonical.version_id,
      model: { provider: "openai", name: "text-embedding-3-small", dimension: 1536 },
      chunks: [{
        chunk_index: 0,
        content: body,
        start_offset: offset,
        end_offset: request.content.length,
        token_count: max(1, ceil(body.length / 4)),
        metadata: {
          source: request.sourcePath,
          document_id: canonical.id,
          file_version_id: canonical.version_id,
          title: inspected.metadata.title ?? request.sourcePath,
          okf_metadata: inspected.metadata,
        },
        vector,
      }],
    };
    const wire = privateJsonStringify(payload);
    // Parse once here to ensure retained bytes are valid JSON; transport sends them unchanged later.
    privateJsonParse(wire);
    const acknowledgement: unknown = await writer.postRaw(indexPath, wire, { signal });
    if (
      !record(acknowledgement) || acknowledgement.file_id !== canonical.id ||
      acknowledgement.version_id !== canonical.version_id ||
      acknowledgement.path !== request.sourcePath ||
      acknowledgement.checksum !== canonical.checksum ||
      acknowledgement.indexed_chunk_count !== 1 ||
      !record(acknowledgement.model) || acknowledgement.model.name !== "text-embedding-3-small" ||
      acknowledgement.model.provider !== "openai" || acknowledgement.model.dimension !== 1536
    ) throw new Error("Canonical index acknowledgement mismatched");
    const after = await ready();
    retained = {
      wire,
      path: request.sourcePath,
      fileId: canonical.id,
      versionId: canonical.version_id,
    };
    return {
      requestHash: await computeHash(wire),
      readinessAfterHash: after,
      authorizationDenied: false,
    };
  };
}
