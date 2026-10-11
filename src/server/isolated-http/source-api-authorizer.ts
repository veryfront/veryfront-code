import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
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
  /** Raw host credential reads retain their reservation until settlement; 1 through 64, default 16. */
  maxPendingCredentialReads?: number;
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
  const maxPendingCredentialReads = options.maxPendingCredentialReads ?? 16;
  if (
    typeof fetch !== "function" || typeof readProjectToken !== "function" ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 30_000 || !Number.isSafeInteger(maxPendingCredentialReads) ||
    maxPendingCredentialReads < 1 || maxPendingCredentialReads > 64
  ) {
    throw new TypeError("Invalid runtime source authorization limits");
  }
  const credentialReads = new Set<Promise<string>>();
  async function readCredential(projectId: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    if (credentialReads.size >= maxPendingCredentialReads) throw unavailable();
    const raw = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return readProjectToken(projectId, signal);
    });
    credentialReads.add(raw);
    void raw.then(() => credentialReads.delete(raw), () => credentialReads.delete(raw));
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
    signal.throwIfAborted();
    const length = response.headers.get("content-length");
    if (
      response.status !== 200 ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json" ||
      ![null, "identity"].includes(response.headers.get("content-encoding")) ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum))
    ) throw unavailable();
    const { text, truncated } = await readResponseTextPrefix(response, maximum + 1, signal, {
      fatalUtf8: true,
    });
    signal.throwIfAborted();
    if (truncated || new TextEncoder().encode(text).byteLength > maximum) throw unavailable();
    return JSON.parse(text);
  }
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
        !source || typeof source !== "object" || Array.isArray(source) ||
        source.release_id !== binding.releaseId || !Array.isArray(source.data) ||
        source.data.length > 1 ||
        source.data.some((row: unknown) =>
          !row || typeof row !== "object" || Array.isArray(row) ||
          Object.keys(row).length !== 1 || typeof (row as { id?: unknown }).id !== "string"
        )
      ) throw unavailable();
      combined.throwIfAborted();
      const projectToken = await readCredential(binding.projectId, combined);
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
        !project || typeof project !== "object" || Array.isArray(project) ||
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
    pending: { get: () => credentialReads.size },
    settled: { get: () => Promise.allSettled([...credentialReads]).then(() => {}) },
  }) as typeof authorize & { readonly pending: number; readonly settled: Promise<void> };
}
