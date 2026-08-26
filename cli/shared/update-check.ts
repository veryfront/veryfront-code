/**
 * Non-blocking update check
 *
 * Checks for newer CLI versions after command execution.
 * Cached for 24 hours. Never blocks command output.
 *
 * @module cli/shared/update-check
 */

import { createFileSystem, type FileSystem } from "veryfront/platform";
import { type HostRuntime, liveHostRuntime } from "#cli/host-runtime";
import { join } from "veryfront/platform/path";
import { getEnvironmentConfig } from "veryfront/config";
import { isJsonMode } from "./json-output.ts";
import { brand, dim, warning as warningColor } from "../ui/colors.ts";
import { cliLogger, isQuiet } from "../utils/index.ts";
import { detectCI } from "./interactive.ts";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_REGISTRY_URL = "https://registry.npmjs.org/veryfront/latest";
export const UPDATE_INSTALL_COMMAND = "npm install -g veryfront@latest";
const HOMEBREW_UPDATE_COMMAND = "brew upgrade veryfront/tap/veryfront";
const INSTALL_SCRIPT_COMMAND = "curl -fsSL https://veryfront.com/install.sh | sh";
const STABLE_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

interface UpdateCache {
  lastCheck: number;
  latestVersion: string | null;
}

interface UpdateCacheLocation {
  directory: string;
  file: string;
}

type UpdateCheckFileSystem = Pick<FileSystem, "readTextFile" | "mkdir" | "writeTextFile">;
type UpdateCheckFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface UpdateCheckOptions {
  shouldSkip?: () => boolean;
  cacheLocation?: UpdateCacheLocation | null;
  fileSystem?: UpdateCheckFileSystem;
  fetcher?: UpdateCheckFetcher;
  now?: () => number;
  printNotice?: (current: string, latest: string) => void;
  debug?: (message: string) => void;
}

class UpdateCheckFailure extends Error {}

function getCacheLocation(): UpdateCacheLocation | null {
  const env = getEnvironmentConfig();
  if (!env.homeDir) return null;
  const directory = join(env.homeDir, ".cache", "veryfront");
  return { directory, file: join(directory, "update-check.json") };
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

export function shouldSkip(host: HostRuntime = liveHostRuntime()): boolean {
  if (host.env.get("VERYFRONT_NO_UPDATE_CHECK") === "1") return true;
  if (detectCI(host)) return true;
  if (isJsonMode()) return true;
  if (isQuiet()) return true;
  return false;
}

export function getUpdateInstallCommand(
  context: { standalone: boolean; executablePath: string } = {
    standalone: Deno.build.standalone ?? false,
    executablePath: Deno.execPath(),
  },
): string {
  if (!context.standalone) return UPDATE_INSTALL_COMMAND;

  const executablePath = context.executablePath.replaceAll("\\", "/").toLowerCase();
  if (executablePath.includes("/node_modules/veryfront/bin/")) {
    return UPDATE_INSTALL_COMMAND;
  }

  if (
    executablePath.includes("/cellar/") ||
    executablePath.includes("/homebrew/") ||
    executablePath.includes("/linuxbrew/")
  ) {
    return HOMEBREW_UPDATE_COMMAND;
  }

  if (!executablePath.endsWith(".exe")) return INSTALL_SCRIPT_COMMAND;
  return UPDATE_INSTALL_COMMAND;
}

function printUpdateNotice(current: string, latest: string): void {
  console.error();
  console.error(`  ${warningColor("!")} Update available: ${current} → ${latest}`);
  console.error(`  ${dim("Run:")} ${brand(getUpdateInstallCommand())}`);
  console.error();
}

async function fetchLatestVersion(fetcher: UpdateCheckFetcher): Promise<string> {
  const response = await fetcher(UPDATE_REGISTRY_URL);
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpdateCheckFailure(
      `Veryfront could not check for updates: npm registry returned ${response.status}.`,
    );
  }

  const data: unknown = await response.json();
  const latestVersion = data && typeof data === "object" && "version" in data
    ? (data as { version?: unknown }).version
    : undefined;
  if (typeof latestVersion !== "string" || !STABLE_SEMVER_PATTERN.test(latestVersion)) {
    throw new UpdateCheckFailure(
      "Veryfront could not check for updates: npm registry returned an invalid version.",
    );
  }

  return latestVersion;
}

export async function checkForUpdates(
  currentVersion: string,
  options: UpdateCheckOptions = {},
): Promise<void> {
  if ((options.shouldSkip ?? shouldSkip)()) return;

  const cacheLocation = options.cacheLocation === undefined
    ? getCacheLocation()
    : options.cacheLocation;
  if (!cacheLocation) return;

  const fs = options.fileSystem ?? createFileSystem();
  const now = options.now ?? Date.now;
  const notice = options.printNotice ?? printUpdateNotice;
  const debug = options.debug ?? ((message: string) => cliLogger.debug(message));

  try {
    const raw = await fs.readTextFile(cacheLocation.file);
    const cache: UpdateCache = JSON.parse(raw);
    if (now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      if (
        cache.latestVersion &&
        compareVersions(currentVersion, cache.latestVersion)
      ) {
        notice(currentVersion, cache.latestVersion);
      }
      return;
    }
  } catch {
    // No cache. Continue with the registry check.
  }

  try {
    const latestVersion = await fetchLatestVersion(options.fetcher ?? fetch);
    if (compareVersions(currentVersion, latestVersion)) {
      notice(currentVersion, latestVersion);
    }

    try {
      await fs.mkdir(cacheLocation.directory, { recursive: true });
      await fs.writeTextFile(
        cacheLocation.file,
        JSON.stringify({ lastCheck: now(), latestVersion }),
      );
    } catch {
      debug("Veryfront could not cache the update check.");
    }
  } catch (error) {
    debug(
      error instanceof UpdateCheckFailure
        ? error.message
        : "Veryfront could not complete the update check.",
    );
  }
}
