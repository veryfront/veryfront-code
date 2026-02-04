/**
 * HTTP client for pulling runtime data from the Veryfront dev server's Dashboard API.
 *
 * Used by the standalone `veryfront mcp` process to access ErrorCollector,
 * LogBuffer, and HMR data over HTTP from the user's running `veryfront` process.
 */

const REQUEST_TIMEOUT_MS = 3000;
const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [200, 500];

export interface DevServerClientOptions {
  port: number;
}

export class DevServerClient {
  private baseUrl: string;

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
    return this.pull("/_dev/api/hmr-trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(path ? { path } : {}),
    });
  }

  private async pull(path: string, init?: RequestInit): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          ...init,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        return await response.json();
      } catch (error) {
        lastError = error;

        if (attempt >= MAX_RETRIES) break;

        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      }
    }

    throw lastError;
  }
}
