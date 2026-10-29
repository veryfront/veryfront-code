import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { isRuntimeOwnershipProbeApiAuthorityError } from "./project-run-runtime-ownership-probe.ts";
import { inspectRuntimeOwnershipOkfDocument } from "./project-run-runtime-ownership-okf-inspector.ts";

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
const finite = Number.isFinite;
const float32 = Math.fround;
const arrayIsArray = Array.isArray;
const ceil = Math.ceil;
const max = Math.max;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownDescriptor = Object.getOwnPropertyDescriptor;
/**
 * An own data property of an API response object. Parsed JSON inherits Object.prototype,
 * which earlier project code in this process can extend, so an inherited or accessor
 * value is never evidence.
 */
function own(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  return (apply(ownDescriptor, Object, [value, key]) as PropertyDescriptor | undefined)?.value;
}

interface RetainedIndexReceipt {
  wire: string;
  path: string;
  fileId: string;
  versionId: string;
}

function matchesRetainedIndexReceipt(
  retained: RetainedIndexReceipt | undefined,
  request: { sourcePath: string },
  canonicalId: string,
  canonicalVersionId: string,
): boolean {
  if (retained === undefined) return false;
  return retained.path === request.sourcePath && retained.fileId === canonicalId &&
    retained.versionId === canonicalVersionId;
}

function assertUnchangedIndexReadiness(before: string, after: string): void {
  if (before !== after) throw new Error("Stale canonical index changed readiness");
}

function isManagedProbeVector(vector: number[]): boolean {
  if (!arrayIsArray(vector) || vector.length !== 3072) return false;
  for (let i = 0; i < vector.length; i++) {
    const value = vector[i];
    if (typeof value !== "number" || !finite(value) || !finite(float32(value))) return false;
  }
  return true;
}

/** The host retains real vectors and replays identical bytes for stale authority; no new inference. */
export function createRuntimeOwnershipIndexProbe(input: {
  projectId: string;
  branchId?: string;
  createWriter(signal: AbortSignal): OwnershipIndexClient;
  createReader(signal: AbortSignal): OwnershipIndexClient;
  embed(text: string, signal: AbortSignal): Promise<number[]>;
}) {
  let retained: RetainedIndexReceipt | undefined;
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
    const canonicalId = own(canonical, "id");
    const canonicalVersionId = own(canonical, "version_id");
    const canonicalChecksum = own(canonical, "checksum");
    if (
      typeof canonicalId !== "string" || !apply(match, uuid, [canonicalId]) ||
      typeof canonicalVersionId !== "string" || !apply(match, uuid, [canonicalVersionId]) ||
      own(canonical, "content") !== request.content ||
      own(canonical, "path") !== request.sourcePath ||
      canonicalChecksum !== await computeHash(request.content)
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
      const rows = own(response, "data");
      if (!arrayIsArray(rows) || rows.length !== 1) {
        throw new Error("Index readiness is incomplete");
      }
      const row: unknown = own(rows, "0");
      if (
        own(row, "path") !== request.sourcePath || own(row, "file_id") !== canonicalId ||
        own(row, "file_version_id") !== canonicalVersionId || own(row, "index_ready") !== true
      ) throw new Error("Current canonical version is not index ready");
      return await computeHash(privateJsonStringify(response));
    };
    const indexPath = `/projects/${encode(input.projectId)}/branches/${
      encode(input.branchId ?? "main")
    }/files/${encode(request.sourcePath)}/index`;
    if (request.stale) {
      if (
        !matchesRetainedIndexReceipt(retained, request, canonicalId, canonicalVersionId)
      ) throw new Error("No matching current canonical index receipt");
      const before = await ready();
      let rejected = false;
      try {
        await writer.postRaw(indexPath, retained!.wire, { signal });
      } catch (error) {
        if (!isRuntimeOwnershipProbeApiAuthorityError(error, "canonical-index")) {
          throw new Error("Index request failed without authorization denial");
        }
        rejected = true;
      }
      if (!rejected) throw new Error("Stale canonical index was accepted");
      const after = await ready();
      assertUnchangedIndexReadiness(before, after);
      return {
        requestHash: await computeHash(retained!.wire),
        readinessBeforeHash: before,
        readinessAfterHash: after,
        authorizationDenied: true,
      };
    }
    const inspected = inspectRuntimeOwnershipOkfDocument(request.sourcePath, request.content);
    const body = inspected.body;
    const vector = await input.embed(body, signal);
    if (
      !isManagedProbeVector(vector)
    ) throw new Error("Managed index probe vector is invalid");
    const offset = request.content.length - body.length;
    const payload = {
      expected_version_id: canonicalVersionId,
      model: { provider: "google", name: "gemini-embedding-001", dimension: 3072 },
      chunks: [{
        chunk_index: 0,
        content: body,
        start_offset: offset,
        end_offset: request.content.length,
        token_count: max(1, ceil(body.length / 4)),
        metadata: {
          source: request.sourcePath,
          document_id: canonicalId,
          file_version_id: canonicalVersionId,
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
    const model = own(acknowledgement, "model");
    if (
      own(acknowledgement, "file_id") !== canonicalId ||
      own(acknowledgement, "version_id") !== canonicalVersionId ||
      own(acknowledgement, "path") !== request.sourcePath ||
      own(acknowledgement, "checksum") !== canonicalChecksum ||
      own(acknowledgement, "indexed_chunk_count") !== 1 ||
      own(model, "name") !== "gemini-embedding-001" ||
      own(model, "provider") !== "google" || own(model, "dimension") !== 3072
    ) throw new Error("Canonical index acknowledgement mismatched");
    const after = await ready();
    retained = {
      wire,
      path: request.sourcePath,
      fileId: canonicalId,
      versionId: canonicalVersionId,
    };
    return {
      requestHash: await computeHash(wire),
      readinessAfterHash: after,
      authorizationDenied: false,
    };
  };
}
