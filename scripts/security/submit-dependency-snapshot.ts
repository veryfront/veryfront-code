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

interface DenoLockV5 {
  version: string;
  specifiers?: Record<string, string>;
  npm?: Record<string, { integrity?: string; dependencies?: string[] }>;
}

interface ResolvedDependency {
  package_url: string;
  relationship: "direct" | "indirect";
  scope: "runtime" | "development";
  dependencies?: string[];
}

interface Manifest {
  name: string;
  file: { source_location: string };
  resolved: Record<string, ResolvedDependency>;
}

interface Snapshot {
  version: 0;
  sha: string;
  ref: string;
  job: { correlator: string; id: string };
  detector: { name: string; version: string; url: string };
  scanned: string;
  manifests: Record<string, Manifest>;
}

const DETECTOR = {
  name: "veryfront-deno-lock",
  version: "1.0.0",
  url: "https://github.com/veryfront/veryfront-code",
} as const;

function parseNameVersion(
  key: string,
): { name: string; version: string } | null {
  let scope = "";
  let rest = key;
  if (key.startsWith("@")) {
    const slash = key.indexOf("/");
    if (slash < 0) return null;
    scope = key.slice(0, slash + 1);
    rest = key.slice(slash + 1);
  }
  const at = rest.indexOf("@");
  if (at <= 0) return null;
  const name = scope + rest.slice(0, at);
  let version = rest.slice(at + 1);
  const underscore = version.indexOf("_");
  if (underscore >= 0) version = version.slice(0, underscore);
  return { name, version };
}

function purl(name: string, version: string): string {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return `pkg:npm/${encoded}@${version}`;
}

export function snapshotFromLock(
  lockText: string,
  ctx: {
    sha: string;
    ref: string;
    correlator: string;
    runId: string;
  },
): Snapshot {
  const lock = JSON.parse(lockText) as DenoLockV5;
  if (lock.version !== "5") {
    throw new Error(
      `Unsupported deno.lock version: "${lock.version}" (expected "5")`,
    );
  }

  const npm = lock.npm ?? {};
  const directKeys = new Set<string>();
  for (const [spec, resolvedVersion] of Object.entries(lock.specifiers ?? {})) {
    if (!spec.startsWith("npm:")) continue;
    const bare = spec.slice("npm:".length);
    const lastAt = bare.lastIndexOf("@");
    if (lastAt <= 0) continue;
    const name = bare.slice(0, lastAt);
    directKeys.add(`${name}@${resolvedVersion}`);
  }

  // Deno v5 lockfiles use bare child names ("zod") instead of "zod@x.y.z" for
  // most transitive edges. Build a name → versions index so we can resolve
  // them. When a name has multiple resolved versions we emit edges to all of
  // them — over-approximating preserves reachability for vuln correlation.
  const versionsByName = new Map<string, Set<string>>();
  for (const key of Object.keys(npm)) {
    const nv = parseNameVersion(key);
    if (!nv) continue;
    let versions = versionsByName.get(nv.name);
    if (!versions) {
      versions = new Set();
      versionsByName.set(nv.name, versions);
    }
    versions.add(nv.version);
  }

  function resolveDepEdge(depKey: string): string[] {
    const qualified = parseNameVersion(depKey);
    if (qualified) return [purl(qualified.name, qualified.version)];
    const versions = versionsByName.get(depKey);
    if (!versions) return [];
    return [...versions].map((v) => purl(depKey, v));
  }

  const resolved: Record<string, ResolvedDependency> = {};
  for (const [key, info] of Object.entries(npm)) {
    const nv = parseNameVersion(key);
    if (!nv) continue;

    const deps: string[] = [];
    for (const depKey of info.dependencies ?? []) {
      for (const purlStr of resolveDepEdge(depKey)) deps.push(purlStr);
    }

    resolved[`${nv.name}@${nv.version}`] = {
      package_url: purl(nv.name, nv.version),
      relationship: directKeys.has(key) ? "direct" : "indirect",
      scope: "runtime",
      ...(deps.length ? { dependencies: deps } : {}),
    };
  }

  return {
    version: 0,
    sha: ctx.sha,
    ref: ctx.ref,
    job: { correlator: ctx.correlator, id: ctx.runId },
    detector: DETECTOR,
    scanned: new Date().toISOString(),
    manifests: {
      "deno.lock": {
        name: "deno.lock",
        file: { source_location: "deno.lock" },
        resolved,
      },
    },
  };
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
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
  const snapshot = snapshotFromLock(lockText, { sha, ref, correlator, runId });

  const componentCount = Object.keys(snapshot.manifests["deno.lock"].resolved)
    .length;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/dependency-graph/snapshots`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(snapshot),
    },
  );

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
