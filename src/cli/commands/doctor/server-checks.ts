import type { DiagnosticResult } from "./types.ts";
import { cliLogger } from "@veryfront/utils";

/** Default local server URL for health checks */
const DEFAULT_SERVER_URL = "http://127.0.0.1:3000";

/** RSC counter metrics shape */
interface RSCCounters {
  rscManifest?: number;
  rscPage?: number;
  rscStream?: number;
  rscAction?: number;
  rscErrors?: number;
}

/** Metrics response shape */
interface MetricsResponse {
  counters?: RSCCounters;
}

async function safeCancelBody(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch (error) {
    cliLogger.debug("Failed to cancel response body:", error);
  }
}

export async function checkRSCFlag(): Promise<DiagnosticResult> {
  try {
    const { getEnv } = await import("@veryfront/platform/compat/process.ts");
    const rscFlag = getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
    if (!rscFlag) {
      return {
        name: "RSC Flag",
        status: "warn",
        message: "VERYFRONT_EXPERIMENTAL_RSC not set",
      };
    } else {
      return { name: "RSC Flag", status: "pass", message: "enabled" };
    }
  } catch (e) {
    return {
      name: "RSC Flag",
      status: "warn",
      message: `env read failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function checkRSCEndpoints(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];

  try {
    const base = new URL(DEFAULT_SERVER_URL + "/");
    const t0m = Date.now();
    const manifest = await fetch(new URL("/_veryfront/rsc/manifest", base)).catch(() => null);
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
    const stream = await fetch(new URL("/_veryfront/rsc/stream", base)).catch(() => null);
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

export async function checkRSCCounters(): Promise<DiagnosticResult> {
  try {
    const base = new URL(DEFAULT_SERVER_URL + "/");
    const met = await fetch(new URL("/_metrics", base)).catch(() => null);
    if (met?.ok) {
      const metricsData = (await met.json().catch(() => null)) as MetricsResponse | null;
      const counters: RSCCounters = metricsData?.counters ?? {};
      const msg = `manifest:${counters.rscManifest ?? 0} page:${counters.rscPage ?? 0} stream:${
        counters.rscStream ?? 0
      } action:${counters.rscAction ?? 0} errors:${counters.rscErrors ?? 0}`;
      return { name: "RSC Counters", status: "pass", message: msg };
    } else {
      return {
        name: "RSC Counters",
        status: "warn",
        message: `${met?.status ?? "unreachable"}`,
      };
    }
  } catch (error) {
    cliLogger.debug("Failed to check RSC counters:", error);
    return {
      name: "RSC Counters",
      status: "warn",
      message: "probe failed",
    };
  }
}
