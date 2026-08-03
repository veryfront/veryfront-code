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

  async triggerHmr(path?: string): Promise<unknown> {
    const session = await this.ensureDashboardMutationSession();
    return await this.pull("/_dev/api/hmr-trigger", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session.cookieHeader,
        [DASHBOARD_CSRF_HEADER_NAME]: session.csrfToken,
      },
      body: JSON.stringify(path ? { path } : {}),
    });
  }

  private async pull(path: string, init?: RequestInit): Promise<unknown> {
    const response = await this.fetchWithRetries(path, init);
    return await response.json();
  }

  private async ensureDashboardMutationSession(): Promise<
    { cookieHeader: string; csrfToken: string }
  > {
    if (this.dashboardSession) return this.dashboardSession;

    const response = await this.fetchWithRetries(DASHBOARD_SESSION_PATH, { method: "GET" });
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
