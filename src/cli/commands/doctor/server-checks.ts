import type { DiagnosticResult } from "./types.ts";
import { cliLogger } from "#veryfront/utils";

const FETCH_TIMEOUT_MS = 2000;

/**
 * Safely cancel response body to prevent resource leaks
 */
async function safeCancelBody(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch (error) {
    // Body cancellation can fail safely, just log for debugging
    cliLogger.debug("Failed to cancel response body:", error);
  }
}

/**
 * Fetch with timeout to prevent hanging on unresponsive servers
 */
async function fetchWithTimeout(
  url: URL,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Check RSC experimental flag status
 */
export async function checkRSCFlag(): Promise<DiagnosticResult> {
  try {
    const { isRscExperimentalEnabled } = await import("#veryfront/config/env.ts");
    const isEnabled = isRscExperimentalEnabled();
    return {
      name: "RSC Flag",
      status: isEnabled ? "pass" : "warn",
      message: isEnabled ? "enabled" : "VERYFRONT_EXPERIMENTAL_RSC not set",
    };
  } catch (e) {
    return {
      name: "RSC Flag",
      status: "warn",
      message: `env read failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Probe RSC unified endpoints (manifest, stream, Flight status)
 */
export async function checkRSCEndpoints(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  try {
    const base = new URL("http://127.0.0.1:3000/"); // assume default dev port
    const t0m = Date.now();
    const manifest = await fetchWithTimeout(new URL("/_veryfront/rsc/manifest", base));
    const dm = Date.now() - t0m;
    if (manifest?.ok) {
      let msg = "200";
      try {
        const j = await manifest.json();
        if (j && typeof j.hash === "string") {
          msg = `200 (hash:${j.hash}, ${dm}ms)`;
        } else msg = `200 (${dm}ms)`;
      } catch (error) {
        cliLogger.debug("Failed to parse RSC manifest JSON:", error);
        msg = `200 (${dm}ms)`;
      }
      results.push({ name: "RSC manifest", status: "pass", message: msg });
    } else {
      results.push({
        name: "RSC manifest",
        status: "warn",
        message: `${manifest?.status ?? "unreachable"} (${dm}ms)`,
      });
    }
    await safeCancelBody(manifest);

    const t0s = Date.now();
    const stream = await fetchWithTimeout(new URL("/_veryfront/rsc/stream", base));
    const ds = Date.now() - t0s;
    if (stream && stream.status === 200) {
      results.push({
        name: "RSC stream",
        status: "pass",
        message: `200 (${ds}ms)`,
      });
    } else {
      results.push({
        name: "RSC stream",
        status: "warn",
        message: `${stream?.status ?? "unreachable"} (${ds}ms)`,
      });
    }
    await safeCancelBody(stream);

    results.push({
      name: "RSC Flight",
      status: "pass",
      message: "removed (using custom RSC)",
    });
  } catch (error) {
    cliLogger.debug("Failed to check RSC endpoints:", error);
    results.push({
      name: "RSC manifest",
      status: "warn",
      message: `probe failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return results;
}

/**
 * Check RSC counters snapshot (metrics endpoint)
 */
export async function checkRSCCounters(): Promise<DiagnosticResult> {
  const base = new URL("http://127.0.0.1:3000/");
  const response = await fetchWithTimeout(new URL("/_metrics", base));

  try {
    if (response?.ok) {
      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      const counters = (json?.counters as Record<string, number>) ?? {};
      const msg = `manifest:${counters.rscManifest ?? 0} page:${counters.rscPage ?? 0} stream:${
        counters.rscStream ?? 0
      } action:${counters.rscAction ?? 0} errors:${counters.rscErrors ?? 0}`;
      return { name: "RSC Counters", status: "pass", message: msg };
    }

    return {
      name: "RSC Counters",
      status: "warn",
      message: `${response?.status ?? "unreachable"}`,
    };
  } catch (error) {
    cliLogger.debug("Failed to check RSC counters:", error);
    return { name: "RSC Counters", status: "warn", message: "probe failed" };
  } finally {
    await safeCancelBody(response);
  }
}
