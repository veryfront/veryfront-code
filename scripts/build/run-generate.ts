#!/usr/bin/env -S deno run -A
/**
 * Orchestrates the `generate` task: skip-when-unchanged, run-when-needed,
 * and run independent generators concurrently.
 *
 * The stock chain ran six generator processes serially on every invocation,
 * which put a multi-minute prefix in front of `deno task test` even when no
 * input had changed. Each generator is deterministic over its inputs, so a
 * generator whose inputs are byte-for-byte where they were after its last
 * successful run cannot produce different output and is safe to skip.
 *
 * Inputs are fingerprinted by content digest (path + SHA-256 of bytes) over
 * coarse input roots — a superset of what each generator actually reads.
 * That direction of error is deliberate: an input-set superset can only
 * over-trigger, never skip a needed run. The fingerprint also folds in the
 * Deno version (bundler and gzip output change across versions) and
 * deno.json (import map changes reach every bundle). A stamp is honored
 * only while every declared output exists on disk — deleting a generated
 * artifact forces its unit to rebuild.
 *
 * Generator OUTPUTS under the input roots are excluded from fingerprints —
 * `*.generated.*` plus the two outputs that don't follow that naming
 * (`templates/manifest.json`, `src/build/production-build/templates.ts`).
 * Without this, a unit would invalidate itself by running. Test files are
 * excluded too: no bundle imports them.
 *
 * Stamps live in `.cache/generate-stamps.json` (gitignored). CI checkouts
 * are cold, so CI always runs everything, exactly as before. `--force`
 * bypasses the stamps locally.
 */

import { fromFileUrl } from "#std/path";

export interface GeneratorUnit {
  name: string;
  /** argv lists run sequentially within the unit. */
  commands: string[][];
  /** Directories whose files form the input fingerprint (coarse superset). */
  inputRoots: string[];
  /** Individual files folded into the fingerprint (the generator itself, config). */
  inputFiles: string[];
  /** Files the unit writes. A missing output forces a run, whatever the stamp says. */
  outputs: string[];
}

export const UNITS: GeneratorUnit[] = [
  {
    name: "templates-manifest",
    commands: [["deno", "run", "-A", "scripts/build/generate-templates-manifest.ts"]],
    inputRoots: ["templates"],
    inputFiles: ["scripts/build/generate-templates-manifest.ts", "deno.json"],
    outputs: ["templates/manifest.json", "templates/manifest.generated.ts"],
  },
  {
    name: "dev-ui",
    commands: [
      ["deno", "run", "-A", "extensions/ext-dev-ui-react/scripts/generate-styles.ts"],
      ["deno", "run", "-A", "extensions/ext-dev-ui-react/scripts/prebundle.ts"],
    ],
    inputRoots: [
      "extensions/ext-dev-ui-react",
      "extensions/ext-css-lightning",
      "extensions/ext-css-tailwind",
      "src",
    ],
    inputFiles: ["deno.json"],
    outputs: [
      "extensions/ext-dev-ui-react/src/dev-ui-styles.generated.ts",
      "extensions/ext-dev-ui-react/src/dev-ui-bundle.generated.ts",
    ],
  },
  {
    name: "client-scripts",
    commands: [["deno", "run", "-A", "scripts/build/prebundle-client-scripts.ts"]],
    inputRoots: ["src", "extensions/ext-bundler-esbuild"],
    inputFiles: ["scripts/build/prebundle-client-scripts.ts", "deno.json"],
    outputs: [
      "src/build/production-build/templates.ts",
      "src/server/handlers/dev/framework-candidates.generated.ts",
    ],
  },
  {
    name: "bridge",
    commands: [["deno", "run", "-A", "scripts/build/prebundle-bridge.ts"]],
    inputRoots: ["src"],
    inputFiles: ["scripts/build/prebundle-bridge.ts", "deno.json"],
    outputs: ["src/studio/bridge/bridge-bundle.generated.ts"],
  },
  {
    name: "rsc-scripts",
    commands: [["deno", "run", "-A", "scripts/build/prebundle-rsc-scripts.ts"]],
    inputRoots: ["src"],
    inputFiles: ["scripts/build/prebundle-rsc-scripts.ts", "deno.json"],
    outputs: ["src/server/services/rsc/endpoints/rsc-bundles.generated.ts"],
  },
  {
    name: "hydration-runtime",
    commands: [["deno", "run", "-A", "scripts/build/prebundle-hydration-runtime.ts"]],
    inputRoots: ["src"],
    inputFiles: ["scripts/build/prebundle-hydration-runtime.ts", "deno.json"],
    outputs: ["src/html/hydration-script-builder/hydration-runtime.generated.ts"],
  },
];

/** Generator outputs that do not follow the `*.generated.*` naming. */
const OUTPUT_FILES = new Set([
  "templates/manifest.json",
  "src/build/production-build/templates.ts",
]);

/** True for files that must not participate in an input fingerprint. */
export function isFingerprintExcluded(relPath: string): boolean {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (base.includes(".generated.")) return true;
  if (OUTPUT_FILES.has(relPath)) return true;
  return base.endsWith(".test.ts") || base.endsWith(".test.tsx");
}

export interface FileEntry {
  path: string;
  /** Hex SHA-256 of the file's bytes — content, not metadata. */
  digest: string;
}

/**
 * A stable digest over file entries. Order-independent: entries are sorted
 * by path before hashing, so directory-walk order cannot flip the hash.
 * Entries carry content digests, so a same-length in-place edit — invisible
 * to mtime/size fingerprints — still changes the unit hash.
 */
export async function digestEntries(
  entries: readonly FileEntry[],
  salt: string,
): Promise<string> {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  const text = salt + "\n" +
    sorted.map((e) => `${e.path}|${e.digest}`).join("\n");
  return await sha256Hex(new TextEncoder().encode(text));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Units whose stamp is missing or stale, whose declared outputs are not all
 * present on disk, or all of them under `force`. The output check keeps a
 * stamp from vouching for artifacts that were deleted after it was written.
 */
export function selectUnitsToRun(
  hashes: Record<string, string>,
  stamps: Record<string, string>,
  force: boolean,
  missingOutputs: (name: string) => boolean = () => false,
): string[] {
  return Object.keys(hashes).filter((name) =>
    force || stamps[name] !== hashes[name] || missingOutputs(name)
  );
}

async function walkPaths(
  repoRoot: string,
  root: string,
  out: string[],
): Promise<void> {
  let entries: AsyncIterable<Deno.DirEntry>;
  try {
    entries = Deno.readDir(`${repoRoot}${root}`);
  } catch {
    return; // an input root may not exist in every checkout
  }
  for await (const entry of entries) {
    const rel = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      await walkPaths(repoRoot, rel, out);
    } else if (entry.isFile && !isFingerprintExcluded(rel)) {
      out.push(rel);
    }
  }
}

const HASH_CONCURRENCY = 64;

/** Content-digest a set of files with bounded concurrency. */
async function hashFiles(
  repoRoot: string,
  paths: readonly string[],
): Promise<FileEntry[]> {
  const out: FileEntry[] = [];
  for (let i = 0; i < paths.length; i += HASH_CONCURRENCY) {
    const batch = paths.slice(i, i + HASH_CONCURRENCY);
    out.push(...await Promise.all(batch.map(async (path) => {
      try {
        return { path, digest: await sha256Hex(await Deno.readFile(`${repoRoot}${path}`)) };
      } catch {
        // a missing declared input keeps the unit running every time
        return { path, digest: "missing" };
      }
    })));
  }
  return out;
}

const STAMP_PATH = ".cache/generate-stamps.json";

async function main(): Promise<void> {
  const repoRoot = fromFileUrl(new URL("../../", import.meta.url));
  const force = Deno.args.includes("--force");

  const rootCache = new Map<string, Promise<FileEntry[]>>();
  const entriesFor = (root: string): Promise<FileEntry[]> => {
    let cached = rootCache.get(root);
    if (cached === undefined) {
      cached = (async () => {
        const paths: string[] = [];
        await walkPaths(repoRoot, root, paths);
        return await hashFiles(repoRoot, paths);
      })();
      rootCache.set(root, cached);
    }
    return cached;
  };

  const salt = `deno=${Deno.version.deno}`;
  const hashes: Record<string, string> = {};
  for (const unit of UNITS) {
    const entries: FileEntry[] = [];
    for (const root of unit.inputRoots) entries.push(...await entriesFor(root));
    entries.push(...await hashFiles(repoRoot, unit.inputFiles));
    hashes[unit.name] = await digestEntries(entries, salt);
  }

  let stamps: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(
      await Deno.readTextFile(`${repoRoot}${STAMP_PATH}`),
    );
    if (
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) &&
      Object.values(parsed).every((v) => typeof v === "string")
    ) {
      stamps = parsed as Record<string, string>;
    }
  } catch {
    // no stamps yet (or an unreadable file): every unit runs
  }

  const outputExists = (path: string): boolean => {
    try {
      Deno.statSync(`${repoRoot}${path}`);
      return true;
    } catch {
      return false;
    }
  };
  const unitsByName = new Map(UNITS.map((u) => [u.name, u]));
  const toRun = new Set(selectUnitsToRun(
    hashes,
    stamps,
    force,
    (name) => {
      const missing = unitsByName.get(name)?.outputs.some((o) => !outputExists(o)) ?? false;
      if (missing) console.log(`[generate] output missing, rebuilding: ${name}`);
      return missing;
    },
  ));
  const skipped = UNITS.filter((u) => !toRun.has(u.name)).map((u) => u.name);
  if (skipped.length > 0) {
    console.log(`[generate] up to date, skipping: ${skipped.join(", ")}`);
  }
  if (toRun.size === 0) return;

  const results = await Promise.all(
    UNITS.filter((u) => toRun.has(u.name)).map(async (unit) => {
      for (const argv of unit.commands) {
        const output = await new Deno.Command(argv[0], {
          args: argv.slice(1),
          cwd: repoRoot,
          stdout: "piped",
          stderr: "piped",
        }).output();
        const text = new TextDecoder().decode(output.stdout) +
          new TextDecoder().decode(output.stderr);
        if (text.trim().length > 0) {
          console.log(text.trimEnd().split("\n").map((l) => `[${unit.name}] ${l}`).join("\n"));
        }
        if (!output.success) return { name: unit.name, ok: false };
      }
      return { name: unit.name, ok: true };
    }),
  );

  for (const result of results) {
    if (result.ok) stamps[result.name] = hashes[result.name];
  }
  await Deno.mkdir(`${repoRoot}.cache`, { recursive: true });
  await Deno.writeTextFile(
    `${repoRoot}${STAMP_PATH}`,
    JSON.stringify(stamps, null, 2) + "\n",
  );

  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  if (failed.length > 0) {
    console.error(`[generate] FAILED: ${failed.join(", ")}`);
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
