/**
 * Non-blocking update check
 *
 * Checks for newer CLI versions after command execution.
 * Cached for 24 hours. Never blocks command output.
 *
 * @module cli/shared/update-check
 */

import { getEnv } from "veryfront/platform";
import { createFileSystem } from "veryfront/platform";
import { join } from "veryfront/platform/path";
import { getEnvironmentConfig } from "veryfront/config";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://jsr.io/@nicolo-ribaudo/veryfront/meta.json";

interface UpdateCache {
  lastCheck: number;
  latestVersion: string | null;
}

function getCacheFile(): string {
  const env = getEnvironmentConfig();
  const cacheDir = join(env.homeDir!, ".cache", "veryfront");
  return join(cacheDir, "update-check.json");
}

export function compareVersions(current: string, latest: string): boolean {
  const c = current.split(".").map(Number);
  const l = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export function shouldSkip(): boolean {
  if (getEnv("VERYFRONT_NO_UPDATE_CHECK") === "1") return true;
  if (getEnv("CI") === "true") return true;
  if (getEnv("GITHUB_ACTIONS") !== undefined) return true;
  return false;
}

export async function checkForUpdates(
  currentVersion: string,
): Promise<void> {
  if (shouldSkip()) return;

  const fs = createFileSystem();
  const cacheFile = getCacheFile();

  try {
    const raw = await fs.readTextFile(cacheFile);
    const cache: UpdateCache = JSON.parse(raw);
    if (Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (
        cache.latestVersion &&
        compareVersions(currentVersion, cache.latestVersion)
      ) {
        console.error(
          `\n  Update available: ${currentVersion} → ${cache.latestVersion}`,
        );
        console.error(
          `  Run: deno install -gArf jsr:@nicolo-ribaudo/veryfront\n`,
        );
      }
      return;
    }
  } catch {
    // No cache — proceed
  }

  try {
    const resp = await fetch(REGISTRY_URL);
    if (!resp.ok) return;
    const data = await resp.json();
    const latestVersion = data.latest as string | undefined;
    if (!latestVersion) return;

    const cacheDir = join(getEnvironmentConfig().homeDir!, ".cache", "veryfront");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(
      cacheFile,
      JSON.stringify({ lastCheck: Date.now(), latestVersion }),
    );

    if (compareVersions(currentVersion, latestVersion)) {
      console.error(
        `\n  Update available: ${currentVersion} → ${latestVersion}`,
      );
      console.error(
        `  Run: deno install -gArf jsr:@nicolo-ribaudo/veryfront\n`,
      );
    }
  } catch {
    // Network error — silently ignore
  }
}
