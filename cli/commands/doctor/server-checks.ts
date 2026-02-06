import type { DiagnosticResult } from "./types.ts";
import { cliLogger } from "#veryfront/utils";
import { formatError } from "../../utils/string.ts";

const FETCH_TIMEOUT_MS = 2000;

async function safeCancelBody(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch (error) {
    cliLogger.debug("Failed to cancel response body:", error);
  }
}

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

function getHashFromManifest(json: unknown): string | null {
  if (!json || typeof json !== "object" || !("hash" in json)) return null;
  const hash = (json as { hash?: unknown }).hash;
  return typeof hash === "string" ? hash : null;
}

export async function checkRSCFlag(): Promise<DiagnosticResult> {
  try {
    const { isRscExperimentalEnabled } = await import("#veryfront/config/env.ts");
    const isEnabled = isRscExperimentalEnabled();

    return {
      name: "RSC Flag",
      status: isEnabled ? "pass" : "warn",
      message: isEnabled ? "enabled" : "VERYFRONT_EXPERIMENTAL_RSC not set",
    };
  } catch (error) {
    return {
      name: "RSC Flag",
      status: "warn",
      message: `env read failed: ${formatError(error)}`,
    };
  }
}

export async function checkRSCEndpoints(): Promise<DiagnosticResult[]> {
  const results: DiagnosticResult[] = [];
  const base = new URL("http://127.0.0.1:3000/");

  try {
    const t0m = Date.now();
    const manifest = await fetchWithTimeout(new URL("/_veryfront/rsc/manifest", base));
    const dm = Date.now() - t0m;

    if (manifest?.ok) {
      let msg = `200 (${dm}ms)`;
      try {
        const hash = getHashFromManifest(await manifest.json());
        if (hash) msg = `200 (hash:${hash}, ${dm}ms)`;
      } catch (error) {
        cliLogger.debug("Failed to parse RSC manifest JSON:", error);
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

    if (stream?.status === 200) {
      results.push({ name: "RSC stream", status: "pass", message: `200 (${ds}ms)` });
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
      message: `probe failed: ${formatError(error)}`,
    });
  }

  return results;
}

export async function checkRSCCounters(): Promise<DiagnosticResult> {
  const base = new URL("http://127.0.0.1:3000/");
  const response = await fetchWithTimeout(new URL("/_metrics", base));

  try {
    if (!response?.ok) {
      return {
        name: "RSC Counters",
        status: "warn",
        message: `${response?.status ?? "unreachable"}`,
      };
    }

    const json = (await response.json().catch(() => null)) as { counters?: unknown } | null;
    const counters = (json?.counters as Record<string, number> | undefined) ?? {};

    const msg = `manifest:${counters.rscManifest ?? 0} page:${counters.rscPage ?? 0} stream:${
      counters.rscStream ?? 0
    } action:${counters.rscAction ?? 0} errors:${counters.rscErrors ?? 0}`;
    return { name: "RSC Counters", status: "pass", message: msg };
  } catch (error) {
    cliLogger.debug("Failed to check RSC counters:", error);
    return { name: "RSC Counters", status: "warn", message: "probe failed" };
  } finally {
    await safeCancelBody(response);
  }
}
