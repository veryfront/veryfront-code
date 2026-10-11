import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { snapshotInstalledProjectHttpBinding } from "../runtime-handler/installed-project.ts";
import type { HostedHttpRequestAuthority } from "./hosted-http-ingress.ts";

const MAX_RESPONSE_BYTES = 16 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const unavailable = () => new Error("Runtime source authorization failed");

/** Revalidate one binding through the narrow source-read API; credentials never enter executor input. */
export function createRuntimeSourceAuthorizer(options: {
  baseUrl: string;
  timeoutMs?: number;
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
  if (
    typeof fetch !== "function" || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    timeoutMs > 30_000
  ) {
    throw new TypeError("Invalid runtime source authorization limits");
  }
  return async (authority: HostedHttpRequestAuthority, signal: AbortSignal): Promise<void> => {
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
      const url = new URL(
        `/projects/${binding.projectId}/releases/${binding.releaseId}/runtime-binding`,
        base,
      );
      url.searchParams.set("environment_id", binding.environmentId);
      const response = await fetch(url, {
        method: "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        signal: combined,
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json",
          "accept-encoding": "identity",
        },
      });
      combined.throwIfAborted();
      const length = response.headers.get("content-length");
      if (
        response.status !== 200 ||
        response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
          "application/json" ||
        ![null, "identity"].includes(response.headers.get("content-encoding")) ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES))
      ) throw unavailable();
      const { text, truncated } = await readResponseTextPrefix(
        response,
        MAX_RESPONSE_BYTES + 1,
        combined,
        { fatalUtf8: true },
      );
      combined.throwIfAborted();
      if (truncated || new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw unavailable();
      }
      const result = JSON.parse(text);
      if (
        !result || typeof result !== "object" || Array.isArray(result) ||
        Object.keys(result).length !== 5 ||
        result.project_id !== binding.projectId || result.project_slug !== binding.projectSlug ||
        result.environment_id !== binding.environmentId ||
        result.environment_name !== binding.environmentName ||
        result.release_id !== binding.releaseId
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
}
