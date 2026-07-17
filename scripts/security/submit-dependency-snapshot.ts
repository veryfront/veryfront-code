/**
 * Submit deno.lock npm graph to GitHub's Dependency Submission API.
 *
 * Reads deno.lock, builds a snapshot in GitHub's format, and POSTs to
 * /repos/{owner}/{repo}/dependency-graph/snapshots. The result is visible
 * under Insights → Dependency graph and feeds Dependabot alerts.
 *
 * Usage:
 *   deno run --allow-read --allow-env --allow-net=api.github.com \
 *     scripts/security/submit-dependency-snapshot.ts
 *
 * Required env (GitHub Actions provides all of these):
 *   GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF,
 *   GITHUB_RUN_ID, GITHUB_JOB, GITHUB_WORKFLOW
 *
 * Token needs `contents: write` permission.
 */

import {
  canonicalNpmKey,
  npmNameFromSpecifier,
  parseLock,
  parseNameVersion,
  purl,
} from "../lib/deno-lock.ts";

export interface ResolvedDependency {
  package_url: string;
  relationship: "direct" | "indirect";
  scope: "runtime" | "development";
  dependencies?: string[];
}

export interface Manifest {
  name: string;
  file: { source_location: string };
  resolved: Record<string, ResolvedDependency>;
}

export interface Snapshot {
  version: 0;
  sha: string;
  ref: string;
  job: { correlator: string; id: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: Record<string, Manifest>;
}

type SnapshotFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DependencySnapshotSubmissionOptions {
  repository: string;
  token: string;
  fetch?: SnapshotFetch;
  sleep?: (delayMs: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

const DEFAULT_SUBMISSION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

const DETECTOR = {
  name: "veryfront-deno-lock",
  version: "1.0.0",
  url: "https://github.com/veryfront/veryfront-code",
} as const;

type NpmEntries = NonNullable<ReturnType<typeof parseLock>["npm"]>;

export interface ManifestGenerationOptions {
  workspaceMembers?: string[];
}

function buildVersionsByName(npm: NpmEntries): Map<string, string[]> {
  const keysByName = new Map<string, string[]>();
  for (const key of Object.keys(npm).sort()) {
    const nv = parseNameVersion(key);
    if (!nv) continue;
    const keys = keysByName.get(nv.name) ?? [];
    keys.push(key);
    keysByName.set(nv.name, keys);
  }
  return keysByName;
}

function buildSpecifierToNpmKey(
  specifiers: Record<string, string>,
  npm: NpmEntries,
): Map<string, string> {
  const npmKeys = new Set(Object.keys(npm));
  const keyBySpecifier = new Map<string, string>();
  for (const [specifier, resolvedVersion] of Object.entries(specifiers)) {
    const name = npmNameFromSpecifier(specifier);
    if (!name) continue;
    const exactKey = `${name}@${resolvedVersion}`;
    if (npmKeys.has(exactKey)) {
      keyBySpecifier.set(specifier, exactKey);
      continue;
    }

    const fallback = Object.keys(npm).find((key) => {
      const nv = parseNameVersion(key);
      return nv?.name === name && nv.version === resolvedVersion;
    });
    if (fallback) keyBySpecifier.set(specifier, fallback);
  }
  return keyBySpecifier;
}

function resolveDepKeys(
  depKey: string,
  npm: NpmEntries,
  keysByName: Map<string, string[]>,
): string[] {
  if (npm[depKey]) return [depKey];

  const canonical = canonicalNpmKey(depKey);
  if (canonical) {
    return Object.keys(npm)
      .filter((key) => canonicalNpmKey(key) === canonical)
      .sort();
  }

  return [...(keysByName.get(depKey) ?? [])].sort();
}

function collectReachableNpmKeys(
  directKeys: string[],
  npm: NpmEntries,
  keysByName: Map<string, string[]>,
): string[] {
  const seen = new Set<string>();
  const queue = [...directKeys].sort();

  for (let index = 0; index < queue.length; index++) {
    const key = queue[index];
    if (seen.has(key) || !npm[key]) continue;
    seen.add(key);

    const dependencies = [...(npm[key].dependencies ?? [])].sort();
    for (const depKey of dependencies) {
      for (const resolvedKey of resolveDepKeys(depKey, npm, keysByName)) {
        if (!seen.has(resolvedKey)) queue.push(resolvedKey);
      }
    }
  }

  return [...seen].sort((a, b) => {
    const left = canonicalNpmKey(a) ?? a;
    const right = canonicalNpmKey(b) ?? b;
    return left.localeCompare(right) || a.localeCompare(b);
  });
}

function dependencyEdges(
  key: string,
  npm: NpmEntries,
  keysByName: Map<string, string[]>,
): Pick<ResolvedDependency, "dependencies"> {
  const dependencies = new Set<string>();
  for (const depKey of npm[key]?.dependencies ?? []) {
    for (const resolvedKey of resolveDepKeys(depKey, npm, keysByName)) {
      const nv = parseNameVersion(resolvedKey);
      if (nv) dependencies.add(purl(nv.name, nv.version));
    }
  }

  const sorted = [...dependencies].sort();
  return sorted.length ? { dependencies: sorted } : {};
}

export function manifestsFromLock(
  lockText: string,
  _ctx: { sha: string; ref: string; correlator: string; runId: string },
  options: ManifestGenerationOptions = {},
): Record<string, Manifest> {
  const lock = parseLock(lockText);
  const npm = lock.npm ?? {};
  const manifests: Record<string, Manifest> = {};

  const keysByName = buildVersionsByName(npm);
  const specifierToKey = buildSpecifierToNpmKey(lock.specifiers ?? {}, npm);

  const addManifest = (sourceLocation: string, directSpecifiers: string[]) => {
    const directKeys = directSpecifiers
      .map((specifier) => specifierToKey.get(specifier))
      .filter((key): key is string => typeof key === "string");
    const reachable = collectReachableNpmKeys(directKeys, npm, keysByName);
    const directCanonical = new Set(
      directKeys
        .map((key) => canonicalNpmKey(key))
        .filter((key): key is string => typeof key === "string"),
    );
    const resolved: Record<string, ResolvedDependency> = {};

    for (const key of reachable) {
      const nv = parseNameVersion(key);
      if (!nv) continue;
      const canonical = `${nv.name}@${nv.version}`;
      resolved[canonical] = {
        package_url: purl(nv.name, nv.version),
        relationship: directCanonical.has(canonical) ? "direct" : "indirect",
        scope: "runtime",
        ...dependencyEdges(key, npm, keysByName),
      };
    }

    manifests[sourceLocation] = {
      name: sourceLocation,
      file: { source_location: sourceLocation },
      resolved,
    };
  };

  const workspaceDependencies = lock.workspace?.dependencies ??
    Object.keys(lock.specifiers ?? {});
  addManifest("deno.json", workspaceDependencies);
  const memberDependencies = new Map(
    Object.entries(lock.workspace?.members ?? {}),
  );
  for (const memberPath of options.workspaceMembers ?? []) {
    if (!memberDependencies.has(memberPath)) {
      memberDependencies.set(memberPath, { dependencies: [] });
    }
  }

  for (
    const [memberPath, member] of [...memberDependencies].sort((
      [left],
      [right],
    ) => left.localeCompare(right))
  ) {
    addManifest(`${memberPath}/deno.json`, member.dependencies ?? []);
  }

  return manifests;
}

export function snapshotFromLock(
  lockText: string,
  ctx: {
    sha: string;
    ref: string;
    correlator: string;
    runId: string;
  },
  options: ManifestGenerationOptions = {},
): Snapshot {
  const manifests = manifestsFromLock(lockText, ctx, options);

  return {
    version: 0,
    sha: ctx.sha,
    ref: ctx.ref,
    job: { correlator: ctx.correlator, id: ctx.runId },
    detector: DETECTOR,
    scanned: new Date().toISOString(),
    manifests,
  };
}

function isTransientSubmissionStatus(status: number): boolean {
  return status === 429 || status >= 500 && status <= 599;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function submitDependencySnapshot(
  snapshot: Snapshot,
  options: DependencySnapshotSubmissionOptions,
): Promise<Response> {
  const fetchSnapshot = options.fetch ?? globalThis.fetch;
  const wait = options.sleep ?? sleep;
  const retryDelays = options.retryDelaysMs ??
    DEFAULT_SUBMISSION_RETRY_DELAYS_MS;
  const url =
    `https://api.github.com/repos/${options.repository}/dependency-graph/snapshots`;

  for (let attempt = 0;; attempt++) {
    try {
      const response = await fetchSnapshot(url, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github+json",
          "Authorization": `Bearer ${options.token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(snapshot),
      });

      if (
        !isTransientSubmissionStatus(response.status) ||
        attempt >= retryDelays.length
      ) {
        return response;
      }
      await response.body?.cancel();
    } catch (error) {
      if (attempt >= retryDelays.length) throw error;
    }

    await wait(retryDelays[attempt]);
  }
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function normalizeWorkspaceMemberPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function workspaceMembersFromDenoConfig(
  config: { workspace?: unknown },
): string[] {
  if (!Array.isArray(config.workspace)) return [];
  return config.workspace
    .filter((entry): entry is string => typeof entry === "string")
    .map(normalizeWorkspaceMemberPath)
    .filter((entry) => entry.length > 0)
    .sort();
}

if (import.meta.main) {
  const token = requireEnv("GITHUB_TOKEN");
  const repo = requireEnv("GITHUB_REPOSITORY");
  const sha = requireEnv("GITHUB_SHA");
  const ref = requireEnv("GITHUB_REF");
  const runId = requireEnv("GITHUB_RUN_ID");
  const correlator = `${Deno.env.get("GITHUB_WORKFLOW") ?? "ci"}/${
    Deno.env.get("GITHUB_JOB") ?? "submit-dependency-snapshot"
  }`;

  const lockText = await Deno.readTextFile("deno.lock");
  const denoConfig = JSON.parse(await Deno.readTextFile("deno.json"));
  const snapshot = snapshotFromLock(
    lockText,
    { sha, ref, correlator, runId },
    { workspaceMembers: workspaceMembersFromDenoConfig(denoConfig) },
  );

  const componentCount = Object.values(snapshot.manifests)
    .reduce(
      (total, manifest) => total + Object.keys(manifest.resolved).length,
      0,
    );

  const res = await submitDependencySnapshot(snapshot, {
    repository: repo,
    token,
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`❌ Submission failed: ${res.status} ${res.statusText}`);
    console.error(body);
    Deno.exit(1);
  }

  console.log(
    `✅ Submitted dependency snapshot: ${componentCount} packages, ref=${ref}`,
  );
  console.log(`   Response: ${body}`);
}
