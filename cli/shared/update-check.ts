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
import { isJsonMode } from "./json-output.ts";
import { isQuiet } from "../utils/index.ts";
import { detectCI } from "./interactive.ts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = "https://jsr.io/@nicolo-ribaudo/veryfront/meta.json";
const INSTALL_CMD = "deno install -gArf jsr:@nicolo-ribaudo/veryfront";

interface UpdateCache {
  lastCheck: number;
  latestVersion: string | null;
}

function getCacheFile(): string | null {
  const env = getEnvironmentConfig();
  if (!env.homeDir) return null;
  const cacheDir = join(env.homeDir, ".cache", "veryfront");
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
  if (detectCI()) return true;
  if (isJsonMode()) return true;
  if (isQuiet()) return true;
  return false;
}

function printUpdateNotice(current: string, latest: string): void {
  console.error(`\n  Update available: ${current} → ${latest}`);
  console.error(`  Run: ${INSTALL_CMD}\n`);
}

export async function checkForUpdates(
  currentVersion: string,
): Promise<void> {
  if (shouldSkip()) return;

  const cacheFile = getCacheFile();
  if (!cacheFile) return;

  const fs = createFileSystem();

  try {
    const raw = await fs.readTextFile(cacheFile);
    const cache: UpdateCache = JSON.parse(raw);
    if (Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (
        cache.latestVersion &&
        compareVersions(currentVersion, cache.latestVersion)
      ) {
        printUpdateNotice(currentVersion, cache.latestVersion);
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

    const env = getEnvironmentConfig();
    if (!env.homeDir) return;
    const cacheDir = join(env.homeDir, ".cache", "veryfront");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeTextFile(
      cacheFile,
      JSON.stringify({ lastCheck: Date.now(), latestVersion }),
    );

    if (compareVersions(currentVersion, latestVersion)) {
      printUpdateNotice(currentVersion, latestVersion);
    }
  } catch {
    // Network error — silently ignore
  }
}
