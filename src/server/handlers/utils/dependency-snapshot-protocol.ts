/**
 * The HTTP protocol that binds a request to one dependency snapshot.
 *
 * A page and every asset it pulls must be built from the same dependency set,
 * so each request carries the snapshot key its document was built from. This
 * module owns that wire contract end to end: the header and query parameter
 * that carry the key, how a carried key is validated, how it is resolved into a
 * snapshot, what a conflict looks like on the wire, and which response headers
 * keep the answer cacheable.
 *
 * Handlers adapt their own transport to this module rather than restating the
 * protocol. Document, page-data, and data requests carry the key in a header;
 * module URLs carry it in a query parameter because the browser imports them
 * and cannot attach headers.
 */
import type { HandlerContext } from "../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";

/** Request and response header carrying the dependency snapshot key. */
export const DEPENDENCY_PINS_HEADER = "x-veryfront-dependency-pins";

/** Query parameter carrying the snapshot key on browser-imported module URLs. */
export const DEPENDENCY_PINS_QUERY_PARAM = "pins";

/**
 * Body of a snapshot-conflict response.
 *
 * The client recovers from a snapshot conflict by reloading the document, and
 * it tells a conflict apart from any other 409 by matching this exact body. Any
 * change here has to land in the client recovery paths first — see
 * `src/rendering/rsc/dependency-snapshot-recovery.ts` and the router template
 * in `src/html/hydration-script-builder/templates/`.
 */
export const SNAPSHOT_CONFLICT_BODY = "Unknown dependency snapshot";

/**
 * Canonical keys are `on:` plus a base36 hash. The pattern is deliberately
 * wider than the canonical form so that resolution, not parsing, decides
 * whether a well-formed key is one this server actually knows.
 */
const SNAPSHOT_KEY_PATTERN = /^on:[A-Za-z0-9._-]+$/;

/** What a request carries, before it is resolved against known snapshots. */
export type SnapshotRequest =
  /** No key at all: an unpinned caller, or a first document request. */
  | { readonly kind: "absent" }
  /** A well-formed key the caller wants this response bound to. */
  | { readonly kind: "pinned"; readonly key: string }
  /** A key this server will not act on; always answered with a conflict. */
  | { readonly kind: "unusable" };

/** Outcome of pairing a carried key with the snapshots this server holds. */
export type SnapshotResolution =
  | { readonly kind: "ready"; readonly snapshot: DependencyPinningSnapshot }
  | { readonly kind: "conflict" };

export interface SnapshotResolutionOptions {
  /**
   * How to treat a request that carries no key while the project is pinning.
   *
   * `"conflict"` (the default) suits assets and data: the caller would receive
   * content built from a snapshot it never asked for and cannot reconcile with
   * the document it is rendering into. `"adopt"` suits the document request
   * itself, which is where the client learns the current key in the first
   * place.
   */
  readonly unpinnedRequest?: "adopt" | "conflict";
}

const ABSENT: SnapshotRequest = { kind: "absent" };
const UNUSABLE: SnapshotRequest = { kind: "unusable" };
const CONFLICT: SnapshotResolution = { kind: "conflict" };

function classifyKey(key: string): SnapshotRequest {
  return SNAPSHOT_KEY_PATTERN.test(key) ? { kind: "pinned", key } : UNUSABLE;
}

/** Read the snapshot key a header-carrying request asked for. */
export function readSnapshotHeader(headers: Headers): SnapshotRequest {
  const raw = headers.get(DEPENDENCY_PINS_HEADER);
  return raw === null ? ABSENT : classifyKey(raw);
}

/**
 * Read the snapshot key a module URL asked for.
 *
 * Two keys would ask one module to be built from two dependency sets at once,
 * so the request is refused rather than resolved to whichever came first.
 */
export function readSnapshotQuery(url: URL): SnapshotRequest {
  const keys = url.searchParams.getAll(DEPENDENCY_PINS_QUERY_PARAM);
  const key = keys[0];
  if (key === undefined) return ABSENT;
  if (keys.length > 1) return UNUSABLE;
  return classifyKey(key);
}

/**
 * Copy headers for forwarding to application code with the snapshot key
 * removed, so the transport token never reaches application-visible state.
 */
export function stripSnapshotHeader(headers: Headers): Headers {
  const forwarded = new Headers(headers);
  forwarded.delete(DEPENDENCY_PINS_HEADER);
  return forwarded;
}

/** The same removal for module URLs, whose key rides in the query string. */
export function stripSnapshotQuery(url: URL): URL {
  const forwarded = new URL(url);
  forwarded.searchParams.delete(DEPENDENCY_PINS_QUERY_PARAM);
  return forwarded;
}

/**
 * Mark a response as snapshot-dependent and, when the snapshot is pinned, tell
 * the caller which one answered it.
 *
 * The `Vary` entry is what keeps a pinned answer from being served to a caller
 * asking for a different snapshot, so it is applied to conflicts and errors too
 * — not only to successful responses.
 */
export function applySnapshotResponseHeaders(
  headers: Headers,
  snapshotCacheKey?: string,
): void {
  const existing = headers.get("vary");
  const values = existing?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (!values.includes(DEPENDENCY_PINS_HEADER)) {
    headers.set(
      "vary",
      existing ? `${existing}, ${DEPENDENCY_PINS_HEADER}` : DEPENDENCY_PINS_HEADER,
    );
  }
  if (snapshotCacheKey?.startsWith("on:")) {
    headers.set(DEPENDENCY_PINS_HEADER, snapshotCacheKey);
  }
}

/** The one conflict response every snapshot-aware endpoint answers with. */
export function snapshotConflictResponse(
  builder: ResponseBuilder,
  req: Request,
  securityConfig: HandlerContext["securityConfig"],
): Response {
  const prepared = builder
    .withCORS(req, securityConfig?.cors)
    .withSecurity(securityConfig ?? undefined, req)
    .withCache("no-store");
  applySnapshotResponseHeaders(prepared.headers);
  if (req.method === "HEAD") return prepared.build(null, 409);
  return prepared.text(SNAPSHOT_CONFLICT_BODY, 409);
}

/** Copy a response with the snapshot headers applied. */
export function withSnapshotResponseHeaders(
  response: Response,
  snapshotCacheKey?: string,
): Response {
  const headers = new Headers(response.headers);
  applySnapshotResponseHeaders(headers, snapshotCacheKey);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Pair a carried key with a snapshot this server can actually build from. */
export async function resolveSnapshotForRequest(
  source: DependencyPinningSourceInput,
  requested: SnapshotRequest,
  options: SnapshotResolutionOptions = {},
): Promise<SnapshotResolution> {
  if (requested.kind === "unusable") return CONFLICT;

  const snapshot = await resolveRequestedDependencyPinningSnapshot(
    source,
    requested.kind === "pinned" ? requested.key : undefined,
  );
  if (!snapshot) return CONFLICT;

  const adoptsCurrentSnapshot = (options.unpinnedRequest ?? "conflict") === "adopt";
  if (
    requested.kind === "absent" && !adoptsCurrentSnapshot &&
    snapshot.cacheKey.startsWith("on:")
  ) {
    return CONFLICT;
  }

  return { kind: "ready", snapshot };
}
