/**
 * HTTP client for pulling runtime data from the Veryfront dev server's Dashboard API.
 *
 * Used by the standalone `veryfront mcp` process to access ErrorCollector,
 * LogBuffer, and HMR data over HTTP from the user's running `veryfront` process.
 */

import { REQUEST_TIMEOUT_MS } from "#cli/shared/constants";
import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_SESSION_PATH,
} from "veryfront/extensions/dev-ui/protocol";

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 500];
const MAX_ERROR_BODY_BYTES = 2_048;
const MAX_ERROR_DETAIL_CHARS = 512;

async function readErrorBodyPrefix(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body) return { text: "", truncated: false };

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let remaining = maxBytes;
  let text = "";
  let completed = false;
  let truncated = false;

  try {
    while (remaining > 0) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        text += decoder.decode();
        break;
      }

      const selected = value.byteLength <= remaining ? value : value.subarray(0, remaining);
      text += decoder.decode(selected, { stream: true });
      remaining -= selected.byteLength;
      if (selected.byteLength < value.byteLength) {
        truncated = true;
        break;
      }
    }
    if (!completed && remaining === 0) truncated = true;
  } finally {
    if (!completed) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        // Response-stream cancellation is best-effort cleanup.
      }
    }
    reader.releaseLock();
  }

  return { text, truncated };
}

export interface DevServerClientOptions {
  port: number;
}

export class DevServerClient {
  private baseUrl: string;
  private dashboardSession?: { cookieHeader: string; csrfToken: string };

  constructor(options: DevServerClientOptions) {
    this.baseUrl = `http://localhost:${options.port}`;
  }

  getLiveErrors(type?: string): Promise<unknown> {
    const params = type ? `?type=${encodeURIComponent(type)}` : "";
    return this.pull(`/_dev/api/live-errors${params}`);
  }

  getLiveLogs(options?: {
    level?: string;
    source?: string;
    pattern?: string;
    limit?: number;
    since?: number;
  }): Promise<unknown> {
    const params = new URLSearchParams();

    if (options?.level) params.set("level", options.level);
    if (options?.source) params.set("source", options.source);
    if (options?.pattern) params.set("pattern", options.pattern);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.since) params.set("since", String(options.since));

    const qs = params.toString();
    return this.pull(`/_dev/api/live-logs${qs ? `?${qs}` : ""}`);
  }

  getStats(): Promise<unknown> {
    return this.pull("/_dev/api/stats");
  }

  triggerHmr(path?: string): Promise<unknown> {
    return this.mutate("/_dev/api/hmr-trigger", JSON.stringify(path ? { path } : {}));
  }

  private async mutate(path: string, body: string): Promise<unknown> {
    const buildInit = (
      session: { cookieHeader: string; csrfToken: string },
    ): RequestInit => ({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session.cookieHeader,
        [DASHBOARD_CSRF_HEADER_NAME]: session.csrfToken,
      },
      body,
    });

    const session = await this.ensureDashboardMutationSession();
    let response = await this.fetchWithRetries(path, buildInit(session));

    // The server's dashboard session token lives for its process lifetime, so
    // a dev-server restart while this MCP process stays up invalidates the
    // cached credential and yields HTTP 403. Discard the stale session,
    // re-bootstrap once, and retry the mutation exactly once.
    if (response.status === 403) {
      try {
        await response.body?.cancel();
      } catch {
        // Response-stream cancellation is best-effort cleanup.
      }
      this.dashboardSession = undefined;
      const freshSession = await this.ensureDashboardMutationSession();
      response = await this.fetchWithRetries(path, buildInit(freshSession));
    }

    await this.throwForHttpError(path, response);
    return await this.readSuccessBody(response);
  }

  private async pull(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchWithRetries(path, init);
    await this.throwForHttpError(path, response);
    return await this.readSuccessBody(response);
  }

  private async readSuccessBody(response: Response): Promise<unknown> {
    const mediaType = response.headers.get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType === "application/json" || mediaType?.endsWith("+json")) {
      return await response.json();
    }
    return await response.text();
  }

  private async throwForHttpError(path: string, response: Response): Promise<void> {
    if (response.ok) return;

    const { text, truncated } = await readErrorBodyPrefix(response, MAX_ERROR_BODY_BYTES);
    const normalized = text.replace(/\s+/g, " ").trim();
    const detail = normalized.slice(0, MAX_ERROR_DETAIL_CHARS);
    const suffix = truncated || normalized.length > MAX_ERROR_DETAIL_CHARS ? "…" : "";
    throw new Error(
      `Dev server request ${path} failed with HTTP ${response.status}${
        detail ? `: ${detail}${suffix}` : ""
      }`,
    );
  }

  private async ensureDashboardMutationSession(): Promise<
    { cookieHeader: string; csrfToken: string }
  > {
    if (this.dashboardSession) return this.dashboardSession;

    const response = await this.fetchWithRetries(DASHBOARD_SESSION_PATH, { method: "GET" });
    await this.throwForHttpError(DASHBOARD_SESSION_PATH, response);
    const setCookie = response.headers.get("set-cookie");
    const cookiePair = setCookie?.split(";", 1)[0]?.trim();
    const separator = cookiePair?.indexOf("=") ?? -1;
    if (!cookiePair || separator <= 0) {
      throw new Error("Dev server did not issue a dashboard session");
    }

    this.dashboardSession = {
      cookieHeader: cookiePair,
      csrfToken: cookiePair.slice(separator + 1),
    };
    return this.dashboardSession;
  }

  private async fetchWithRetries(path: string, init?: RequestInit): Promise<Response> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = error;

        if (attempt >= MAX_RETRIES) break;

        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }

    throw lastError;
  }
}
