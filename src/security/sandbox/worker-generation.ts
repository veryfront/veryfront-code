import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { encodeSandboxBytesAsHex } from "./worker-byte-encoding.ts";

const MAX_WORKER_GENERATION_ID_LENGTH = 1024;
const WORKER_KEY_PREFIX = "veryfront-worker:v1";
const SHA_256_HEX_LENGTH = 64;
const SHA_256_FRAME_PREFIX = `${SHA_256_HEX_LENGTH}:`;
const LOWERCASE_HEX_PATTERN = /^[0-9a-f]+$/;
const WORKER_KINDS = ["api", "data", "ssr"] as const;

export type WorkerKind = (typeof WORKER_KINDS)[number];

export interface WorkerGenerationIdentity {
  readonly scopeId: string;
  readonly generationId: string;
}

export interface ResolvedWorkerGeneration {
  readonly workerId: string;
  readonly reusable: boolean;
}

function requireGenerationField(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WORKER_GENERATION_ID_LENGTH
  ) {
    throw new TypeError(
      `${label} must be a non-empty string no longer than ${MAX_WORKER_GENERATION_ID_LENGTH} characters`,
    );
  }
  return value;
}

function requireWorkerKind(kind: unknown): WorkerKind {
  if (kind !== "api" && kind !== "data" && kind !== "ssr") {
    throw new TypeError('Worker kind must be "api", "data", or "ssr"');
  }
  return kind;
}

/**
 * Snapshot the host-owned identity that proves one worker generation may
 * safely retain an imported module graph.
 *
 * Omitting both fields deliberately selects a single-use worker. Supplying
 * only one cannot establish an invalidation boundary and therefore fails
 * closed.
 */
export function snapshotWorkerGenerationIdentity(
  scopeId: unknown,
  generationId: unknown,
): Readonly<WorkerGenerationIdentity> | undefined {
  if (scopeId === undefined && generationId === undefined) return undefined;
  if (scopeId === undefined || generationId === undefined) {
    throw new TypeError(
      "Worker generation scopeId and generationId must be supplied together",
    );
  }

  return Object.freeze({
    scopeId: requireGenerationField(scopeId, "Worker generation scopeId"),
    generationId: requireGenerationField(
      generationId,
      "Worker generation generationId",
    ),
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodeExactString(value)),
  );
  return encodeSandboxBytesAsHex(digest);
}

/**
 * Hash arbitrarily sized semantic material with the exact UTF-16 encoding used
 * by worker identities. This keeps env and policy values out of pool keys
 * without introducing TextEncoder replacement-character collisions.
 */
export function digestWorkerGenerationMaterial(value: string): Promise<string> {
  if (typeof value !== "string") {
    throw new TypeError("Worker generation semantic material must be a string");
  }
  return sha256Hex(value);
}

/**
 * Encode every JavaScript UTF-16 code unit without normalization or
 * replacement. TextEncoder would collapse lone surrogate values to U+FFFD,
 * which is unsuitable for an identity key.
 */
function encodeExactString(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new Uint8Array(new ArrayBuffer(value.length * 2));
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    encoded[index * 2] = codeUnit >>> 8;
    encoded[index * 2 + 1] = codeUnit & 0xff;
  }
  return encoded;
}

function frame(value: string): string {
  return `${value.length}:${value}`;
}

function encodeScope(scopeId: string): string {
  return base64urlEncodeBytes(encodeExactString(scopeId));
}

function reusableWorkerPrefix(kind: WorkerKind, scopeId: string): string {
  return `${WORKER_KEY_PREFIX}:kind=${frame(kind)}:scope=${
    frame(encodeScope(scopeId))
  }:generation=`;
}

function isValidGenerationScope(scopeId: unknown): scopeId is string {
  return typeof scopeId === "string" &&
    scopeId.length > 0 &&
    scopeId.length <= MAX_WORKER_GENERATION_ID_LENGTH;
}

function matchesFramedGeneration(workerId: string, scopeId: string): boolean {
  for (const kind of WORKER_KINDS) {
    const prefix = reusableWorkerPrefix(kind, scopeId);
    if (!workerId.startsWith(prefix)) continue;

    const digestFrame = workerId.slice(prefix.length);
    if (!digestFrame.startsWith(SHA_256_FRAME_PREFIX)) return false;
    return isSha256Hex(digestFrame.slice(SHA_256_FRAME_PREFIX.length));
  }
  return false;
}

function isSha256Hex(value: string): boolean {
  return value.length === SHA_256_HEX_LENGTH &&
    LOWERCASE_HEX_PATTERN.test(value);
}

/**
 * Return whether an exact reusable worker identity belongs to `scopeId`.
 *
 * This is intentionally a complete-key match rather than a raw prefix check.
 * It is used by WorkerPool retirement, where confusing nested scopes would
 * otherwise terminate unrelated tenant work.
 */
export function isWorkerGenerationInScope(
  workerId: unknown,
  scopeId: unknown,
): boolean {
  if (typeof workerId !== "string" || !isValidGenerationScope(scopeId)) {
    return false;
  }

  return matchesFramedGeneration(workerId, scopeId);
}

/**
 * Resolve the exact WorkerPool key for one immutable source generation.
 *
 * The versioned, length-framed identity includes the execution kind and an
 * exact opaque encoding of the scope. The generation digest keeps release and
 * branch identities out of telemetry. Without a proven generation, a unique
 * single-use key prevents stale dependency graphs from crossing requests.
 */
export async function resolveWorkerGeneration(
  kind: WorkerKind,
  identity?: Readonly<WorkerGenerationIdentity>,
): Promise<Readonly<ResolvedWorkerGeneration>> {
  const workerKind = requireWorkerKind(kind);
  if (!identity) {
    return Object.freeze({
      workerId: `${workerKind}-ephemeral-${crypto.randomUUID()}`,
      reusable: false,
    });
  }

  const snapshot = snapshotWorkerGenerationIdentity(
    identity.scopeId,
    identity.generationId,
  );
  if (!snapshot) {
    throw new TypeError("Reusable worker generation identity is required");
  }

  return Object.freeze({
    workerId: `${reusableWorkerPrefix(workerKind, snapshot.scopeId)}${
      frame(await sha256Hex(snapshot.generationId))
    }`,
    reusable: true,
  });
}
