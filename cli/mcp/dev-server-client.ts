/**
 * HTTP client for pulling runtime data from the Veryfront dev server's Dashboard API.
 *
 * Used by the standalone `veryfront mcp` process to access ErrorCollector,
 * LogBuffer, and HMR data over HTTP from the user's running `veryfront` process.
 */

import { REQUEST_TIMEOUT_MS } from "#cli/shared/constants";
import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_TOKEN_PATTERN,
  DASHBOARD_SESSION_PATH,
  getDashboardSessionCookieName,
} from "veryfront/extensions/dev-ui/protocol";
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 500];
const MAX_DASHBOARD_SET_COOKIE_CHARACTERS = 1024;
export const MAX_DEV_SERVER_JSON_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_DEV_SERVER_REQUEST_PATH_CHARACTERS = 8 * 1024;
const MAX_DEV_SERVER_FILTER_CHARACTERS = 1024;
const MAX_HMR_PATH_CHARACTERS = 4 * 1024;
const MAX_LOG_ENTRY_LIMIT = 10_000;
const CANONICAL_CONTENT_LENGTH_PATTERN = /^(?:0|[1-9]\d*)$/;
const ASCII_CONTROL_END = 0x1f;
const ASCII_DELETE = 0x7f;

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= ASCII_CONTROL_END || codeUnit === ASCII_DELETE) return true;
  }
  return false;
}

interface DashboardSession {
  cookie: string;
  csrfToken: string;
}

export interface DevServerClientOptions {
  port: number;
}

export class DevServerClient {
  private readonly baseUrl: string;
  private readonly dashboardCookieName: string;
  private dashboardSessionPromise: Promise<DashboardSession> | undefined;

  constructor(options: DevServerClientOptions) {
    this.dashboardCookieName = getDashboardSessionCookieName(options.port);
    this.baseUrl = new URL(`http://localhost:${options.port}`).origin;
  }

  getLiveErrors(type?: string): Promise<unknown> {
    const admittedType = type === undefined
      ? undefined
      : admitQueryValue("Error type", type, MAX_DEV_SERVER_FILTER_CHARACTERS);
    const params = admittedType ? `?type=${encodeURIComponent(admittedType)}` : "";
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

    if (options?.level !== undefined) {
      params.set("level", admitQueryValue("Log level", options.level, 16));
    }
    if (options?.source !== undefined) {
      params.set(
        "source",
        admitQueryValue("Log source", options.source, MAX_DEV_SERVER_FILTER_CHARACTERS),
      );
    }
    if (options?.pattern !== undefined) {
      params.set(
        "pattern",
        admitQueryValue("Log pattern", options.pattern, MAX_DEV_SERVER_FILTER_CHARACTERS),
      );
    }
    if (options?.limit !== undefined) {
      if (
        !Number.isSafeInteger(options.limit) ||
        options.limit < 1 ||
        options.limit > MAX_LOG_ENTRY_LIMIT
      ) {
        throw new RangeError(`Log limit must be an integer from 1 to ${MAX_LOG_ENTRY_LIMIT}`);
      }
      params.set("limit", String(options.limit));
    }
    if (options?.since !== undefined) {
      if (!Number.isSafeInteger(options.since) || options.since < 0) {
        throw new RangeError("Log timestamp must be a non-negative safe integer");
      }
      params.set("since", String(options.since));
    }

    const qs = params.toString();
    return this.pull(`/_dev/api/live-logs${qs ? `?${qs}` : ""}`);
  }

  getStats(): Promise<unknown> {
    return this.pull("/_dev/api/stats");
  }

  async triggerHmr(path?: string): Promise<unknown> {
    if (path !== undefined) admitQueryValue("HMR path", path, MAX_HMR_PATH_CHARACTERS, true);
    let session = await this.getDashboardSession();
    let result = await this.pullWithResponse(
      "/_dev/api/hmr-trigger",
      this.createHmrRequest(session, path),
    );

    // A restarted dev server has a new process-lifetime dashboard session.
    // Refresh once instead of keeping a stale credential until CLI restart.
    if (result.response.status === 403) {
      this.dashboardSessionPromise = undefined;
      session = await this.getDashboardSession();
      result = await this.pullWithResponse(
        "/_dev/api/hmr-trigger",
        this.createHmrRequest(session, path),
      );
    }

    return result.data;
  }

  private async pull(path: string, init?: RequestInit): Promise<unknown> {
    return (await this.pullWithResponse(path, init)).data;
  }

  private async pullWithResponse(
    path: string,
    init?: RequestInit,
  ): Promise<{ response: Response; data: unknown }> {
    const response = await this.fetchWithRetry(path, init);
    return { response, data: await readBoundedJsonResponse(response) };
  }

  private async fetchWithRetry(path: string, init?: RequestInit): Promise<Response> {
    if (
      path.length === 0 ||
      path.length > MAX_DEV_SERVER_REQUEST_PATH_CHARACTERS ||
      !path.startsWith("/") ||
      path.startsWith("//") ||
      containsAsciiControlCharacter(path)
    ) {
      throw new TypeError("Dev server request path is invalid or exceeds its limit");
    }
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fetch(`${this.baseUrl}${path}`, {
          ...init,
          redirect: "error",
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

  private createHmrRequest(session: DashboardSession, path?: string): RequestInit {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        Origin: this.baseUrl,
        [DASHBOARD_CSRF_HEADER_NAME]: session.csrfToken,
      },
      body: JSON.stringify(path ? { path } : {}),
    };
  }

  private getDashboardSession(): Promise<DashboardSession> {
    if (this.dashboardSessionPromise) return this.dashboardSessionPromise;

    const pending = this.loadDashboardSession();
    this.dashboardSessionPromise = pending;
    void pending.catch(() => {
      if (this.dashboardSessionPromise === pending) this.dashboardSessionPromise = undefined;
    });
    return pending;
  }

  private async loadDashboardSession(): Promise<DashboardSession> {
    const response = await this.fetchWithRetry(DASHBOARD_SESSION_PATH);
    try {
      if (!response.ok) {
        throw new Error(`Dashboard session request failed with status ${response.status}`);
      }

      const setCookie = response.headers.get("set-cookie");
      if (setCookie !== null && setCookie.length > MAX_DASHBOARD_SET_COOKIE_CHARACTERS) {
        throw new Error("Dev server did not issue a valid dashboard session cookie");
      }
      const cookie = setCookie?.split(";", 1)[0]?.trim() ?? "";
      const separator = cookie.indexOf("=");
      const cookieName = separator === -1 ? "" : cookie.slice(0, separator);
      const csrfToken = separator === -1 ? "" : cookie.slice(separator + 1);
      if (
        cookieName !== this.dashboardCookieName ||
        !DASHBOARD_CSRF_TOKEN_PATTERN.test(csrfToken)
      ) {
        throw new Error("Dev server did not issue a valid dashboard session cookie");
      }

      return { cookie, csrfToken };
    } finally {
      await response.body?.cancel().catch(() => {});
    }
  }
}

function admitQueryValue(
  label: string,
  value: string,
  maxCharacters: number,
  allowEmpty = false,
): string {
  if (
    (!allowEmpty && value.length === 0) ||
    value.length > maxCharacters ||
    containsAsciiControlCharacter(value)
  ) {
    throw new TypeError(`${label} is invalid or exceeds its ${maxCharacters}-character limit`);
  }
  return value;
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The bounded reader still fails closed if a hostile stream cannot cancel.
  }
}

async function readBoundedJsonResponse(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length")?.trim();
  if (declaredLength !== undefined) {
    if (
      declaredLength.length > 16 ||
      !CANONICAL_CONTENT_LENGTH_PATTERN.test(declaredLength) ||
      !Number.isSafeInteger(Number(declaredLength))
    ) {
      await cancelResponseBody(response);
      throw new TypeError("Dev server response has an invalid Content-Length header");
    }
    if (Number(declaredLength) > MAX_DEV_SERVER_JSON_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      throw new RangeError(
        `Dev server response exceeds the ${MAX_DEV_SERVER_JSON_RESPONSE_BYTES}-byte limit`,
      );
    }
  }

  if (!response.body) {
    throw new SyntaxError("Dev server response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        chunks.push(decoder.decode());
        completed = true;
        break;
      }
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_DEV_SERVER_JSON_RESPONSE_BYTES) {
        throw new RangeError(
          `Dev server response exceeds the ${MAX_DEV_SERVER_JSON_RESPONSE_BYTES}-byte limit`,
        );
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the admission or decoding error that stopped the read.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // The reader is already terminal; there is no remaining owned lock.
    }
  }

  try {
    return JSON.parse(chunks.join(""));
  } catch (cause) {
    throw new SyntaxError("Dev server response must contain valid bounded JSON", { cause });
  }
}
