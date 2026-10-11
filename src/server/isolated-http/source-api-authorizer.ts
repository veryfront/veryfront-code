import { readProxyResponseJson, settleProxyResponseBody } from "#veryfront/proxy/response-body.ts";
import { snapshotInstalledProjectHttpBinding } from "../runtime-handler/installed-project.ts";
import type { HostedHttpRequestAuthority } from "./hosted-http-ingress.ts";

const SOURCE_RESPONSE_BYTES = 16 * 1024;
// Match the bounded project metadata accepted by proxy routing.
const PROJECT_RESPONSE_BYTES = 512 * 1024;
const MAX_PROJECT_ENVIRONMENTS = 1_000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = () => new Error("Runtime source authorization failed");

/** Revalidate exact source access and active environment binding through existing read-only APIs. */
export function createRuntimeSourceAuthorizer(options: {
  baseUrl: string;
  timeoutMs?: number;
  /** Raw source HTTP and credential IO retain their reservation until settlement; 1 through 64, default 16. */
  maxPendingOperations?: number;
  /** Host-only project-read credential. Never use the caller's source grant to read environments. */
  readProjectToken(projectId: string, signal: AbortSignal): Promise<string>;
  /** Host-owned transport injection; production defaults to verified native HTTPS fetch. */
  fetch?: typeof globalThis.fetch;
}) {
  const origin = new URL(options.baseUrl);
  if (
    origin.protocol !== "https:" || origin.username || origin.password ||
    origin.pathname !== "/" || origin.search || origin.hash || origin.port === "0"
  ) throw new TypeError("Runtime source API requires a fixed HTTPS origin");
  const base = origin.origin;
  const fetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const readProjectToken = options.readProjectToken;
  const maxPendingOperations = options.maxPendingOperations ?? 16;
  if (
    typeof fetch !== "function" || typeof readProjectToken !== "function" ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 30_000 || !Number.isSafeInteger(maxPendingOperations) ||
    maxPendingOperations < 1 || maxPendingOperations > 64
  ) {
    throw new TypeError("Invalid runtime source authorization limits");
  }
  const pendingOperations = new Set<Promise<unknown>>();
  async function ownedOperation<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    if (pendingOperations.size >= maxPendingOperations) throw unavailable();
    const raw = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation();
    });
    pendingOperations.add(raw);
    void raw.then(() => pendingOperations.delete(raw), () => pendingOperations.delete(raw));
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(unavailable());
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      return await Promise.race([raw, cancelled]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }
  async function readJson(url: URL, token: string, maximum: number, signal: AbortSignal) {
    return await ownedOperation(async () => {
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          "accept-encoding": "identity",
        },
      });
      try {
        signal.throwIfAborted();
        const length = response.headers.get("content-length");
        if (
          response.status !== 200 ||
          response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
            "application/json" ||
          ![null, "identity"].includes(response.headers.get("content-encoding")) ||
          (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
        ) throw unavailable();
        return await readProxyResponseJson(response, maximum, signal);
      } finally {
        if (!response.bodyUsed) await settleProxyResponseBody(response);
      }
    }, signal);
  }
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const authorize = async (
    authority: HostedHttpRequestAuthority,
    signal: AbortSignal,
  ): Promise<void> => {
    const binding = snapshotInstalledProjectHttpBinding({
      projectId: authority.projectId,
      projectSlug: authority.projectSlug,
      environmentId: authority.environmentId,
      environmentName: authority.environmentName,
      releaseId: authority.releaseId,
    });
    const token = authority.sourceToken;
    if (
      !UUID.test(binding.projectId) || !UUID.test(binding.environmentId) ||
      !UUID.test(binding.releaseId) ||
      typeof token !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(token)
    ) throw unavailable();
    signal.throwIfAborted();
    const lifetime = new AbortController();
    const deadline = setTimeout(() => lifetime.abort(), timeoutMs);
    const cancel = () => lifetime.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const combined = lifetime.signal;
    try {
      const sourceUrl = new URL(
        `/projects/${binding.projectId}/releases/${binding.releaseId}/files`,
        base,
      );
      sourceUrl.searchParams.set("limit", "1");
      sourceUrl.searchParams.set("fields", "(id)");
      const source = await readJson(sourceUrl, token, SOURCE_RESPONSE_BYTES, combined);
      if (
        !isRecord(source) ||
        source.release_id !== binding.releaseId || !Array.isArray(source.data) ||
        source.data.length > 1 ||
        source.data.some((row: unknown) =>
          !row || typeof row !== "object" || Array.isArray(row) ||
          Object.keys(row).length !== 1 || typeof (row as { id?: unknown }).id !== "string"
        )
      ) throw unavailable();
      combined.throwIfAborted();
      const projectToken = await ownedOperation(
        () => readProjectToken(binding.projectId, combined),
        combined,
      );
      combined.throwIfAborted();
      if (typeof projectToken !== "string" || !/^[\x21-\x7e]{1,8192}$/.test(projectToken)) {
        throw unavailable();
      }
      const project = await readJson(
        new URL(`/projects/${binding.projectId}`, base),
        projectToken,
        PROJECT_RESPONSE_BYTES,
        combined,
      );
      if (
        !isRecord(project) ||
        project.id !== binding.projectId || project.slug !== binding.projectSlug ||
        !Array.isArray(project.environments) ||
        project.environments.length > MAX_PROJECT_ENVIRONMENTS
      ) throw unavailable();
      const environments = project.environments.filter((entry: unknown) =>
        entry && typeof entry === "object" &&
        !Array.isArray(entry) && (entry as { id?: unknown }).id === binding.environmentId
      );
      if (
        environments.length !== 1 || environments[0].name !== binding.environmentName ||
        environments[0].active_release_id !== binding.releaseId
      ) throw unavailable();
    } catch {
      // Denial is explicit; transport errors and response bodies cannot disclose source credentials.
      throw unavailable();
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      lifetime.abort();
    }
  };
  // A deadline releases admission, but never claims that uncooperative host IO has retired.
  return Object.defineProperties(authorize, {
    pending: { get: () => pendingOperations.size },
    settled: { get: () => Promise.allSettled([...pendingOperations]).then(() => {}) },
  }) as typeof authorize & { readonly pending: number; readonly settled: Promise<void> };
}
