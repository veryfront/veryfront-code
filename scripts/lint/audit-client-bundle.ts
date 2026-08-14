/**
 * Fail-loud client-bundle boundary lint (#3670).
 *
 * Walks the static import graph of each browser entrypoint and fails CI when a
 * server module reaches the client bundle. Two tiers:
 *
 *  - CRITICAL (the #3661 crash class — runtime filesystem adapters): must be
 *    zero, always. Never baselineable.
 *  - SERVER-ONLY (the broader leak surface — `adapters/fs/veryfront/*`,
 *    `veryfront-api-client`, `compat/process/command`, …): ratcheted against a
 *    baseline so a *new* leak fails fast, while the pre-existing debt stays
 *    visible until it is burned down. Regenerate with `--update`.
 *
 * It also reports the client-graph size (modules + source bytes) so a size
 * regression — the tell-tale of a server barrel sneaking in — surfaces on the
 * PR as an annotation and a sticky comment for a human or agent to pick up.
 *
 * Usage:
 *   deno run --allow-read scripts/lint/audit-client-bundle.ts          # check (fail-fast)
 *   deno run --allow-read --allow-write scripts/lint/audit-client-bundle.ts --update
 *   deno run --allow-read scripts/lint/audit-client-bundle.ts --markdown   # PR-comment body
 */

import {
  type ClientGraph,
  collectClientGraph,
  createRealReader,
  findServerOnlyLeaks,
  loadImportMap,
  summarizeGraph,
  traceLeak,
} from "./client-bundle-graph.ts";

const ROOT = new URL("../../", import.meta.url);
const BASELINE_URL = new URL("client-bundle-baseline.json", import.meta.url);

/** Browser entrypoints whose client graph must stay server-free. */
const ENTRYPOINTS: ReadonlyArray<{ label: string; entry: string }> = [
  { label: "veryfront (browser/SSR barrel)", entry: "src/index.client.ts" },
];

/** The #3661 crash class: reaching any of these in a browser aborts hydration. Never baselineable. */
const CRITICAL_PATTERNS: readonly RegExp[] = [
  /\/platform\/adapters\/runtime\/[^/]+\/(adapter|filesystem-adapter)\.ts$/,
  /\/platform\/adapters\/runtime\/shared\/node-filesystem-adapter\.ts$/,
];

/**
 * Warn (not fail) once the client graph exceeds this many modules. The graph is
 * 451 today; a broad server barrel leak jumps it into four figures. A soft
 * ceiling flags that jump for review without inventing a hard byte budget.
 *
 * Deliberately a warning rather than a gate. The leak check above already fails
 * the build on a server module reaching the client, which is the condition worth
 * blocking on; this count is a canary for the shape of a regression the
 * pattern list has not learned yet. Turning it into a hard budget needs a
 * ratchet that records the count per entrypoint and only lets it fall — a
 * fixed ceiling either sits so close to today's graph that ordinary growth
 * trips it, or so far above that it never fires.
 */
const SIZE_WARN_MODULES = 550;

interface Baseline {
  readonly note: string;
  readonly entrypoints: Record<string, string[]>;
}

interface EntryReport {
  label: string;
  entry: string;
  moduleCount: number;
  byteCount: number;
  critical: string[];
  newLeaks: string[];
  knownLeaks: string[];
  fixedLeaks: string[];
  graph: ClientGraph;
}

function isCritical(path: string): boolean {
  return CRITICAL_PATTERNS.some((pattern) => pattern.test("/" + path));
}

async function readBaseline(): Promise<Baseline> {
  try {
    return JSON.parse(await Deno.readTextFile(BASELINE_URL)) as Baseline;
  } catch {
    return { note: "", entrypoints: {} };
  }
}

async function analyze(baseline: Baseline): Promise<EntryReport[]> {
  const importMap = await loadImportMap(ROOT);
  const reader = createRealReader(ROOT);
  const reports: EntryReport[] = [];

  for (const { label, entry } of ENTRYPOINTS) {
    const graph = await collectClientGraph(entry, importMap, reader);
    const { moduleCount, byteCount } = summarizeGraph(graph);
    const leaks = findServerOnlyLeaks(graph);
    const allowed = new Set(baseline.entrypoints[entry] ?? []);

    const critical = leaks.filter(isCritical);
    const newLeaks = leaks.filter((leak) =>
      !isCritical(leak) && !allowed.has(leak)
    );
    const knownLeaks = leaks.filter((leak) =>
      !isCritical(leak) && allowed.has(leak)
    );
    const present = new Set(leaks);
    const fixedLeaks = [...allowed].filter((leak) => !present.has(leak));

    reports.push({
      label,
      entry,
      moduleCount,
      byteCount,
      critical,
      newLeaks,
      knownLeaks,
      fixedLeaks,
      graph,
    });
  }
  return reports;
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KiB`;
}

function renderMarkdown(reports: EntryReport[]): string {
  const rows = reports.map((r) => {
    const leakCell = r.critical.length > 0 || r.newLeaks.length > 0
      ? `❌ ${r.critical.length + r.newLeaks.length} new`
      : r.knownLeaks.length > 0
      ? `⚠️ ${r.knownLeaks.length} known`
      : "✅ 0";
    const sizeFlag = r.moduleCount > SIZE_WARN_MODULES ? " ⚠️" : "";
    return `| \`${r.entry}\` | ${r.moduleCount}${sizeFlag} | ${
      kib(r.byteCount)
    } | ${leakCell} |`;
  });
  return [
    "<!-- client-bundle-report -->",
    "### 📦 Client bundle boundary",
    "",
    "| Entrypoint | Modules | Source size | Server leaks |",
    "| --- | ---: | ---: | ---: |",
    ...rows,
    "",
    "_A server module in a client graph aborts hydration in the browser. New leaks fail CI;" +
    " known leaks are tracked in `scripts/lint/client-bundle-baseline.json` to burn down._",
  ].join("\n");
}

function reportToJson(reports: EntryReport[]) {
  return reports.map((r) => ({
    entry: r.entry,
    moduleCount: r.moduleCount,
    byteCount: r.byteCount,
    critical: r.critical,
    newLeaks: r.newLeaks,
    knownLeaks: r.knownLeaks.length,
  }));
}

async function main(): Promise<void> {
  const args = new Set(Deno.args);

  if (args.has("--update")) {
    const reports = await analyze({ note: "", entrypoints: {} });
    const entrypoints: Record<string, string[]> = {};
    for (const r of reports) {
      entrypoints[r.entry] = [...r.knownLeaks, ...r.newLeaks].filter((l) =>
        !isCritical(l)
      ).toSorted();
    }
    const baseline: Baseline = {
      note:
        "Known server modules reachable from a browser entrypoint (#3670). Burn down, never grow. " +
        "Regenerate with: deno run --allow-read --allow-write scripts/lint/audit-client-bundle.ts --update",
      entrypoints,
    };
    await Deno.writeTextFile(
      BASELINE_URL,
      JSON.stringify(baseline, null, 2) + "\n",
    );
    console.log(`Wrote baseline for ${reports.length} entrypoint(s).`);
    return;
  }

  const baseline = await readBaseline();
  const reports = await analyze(baseline);

  if (args.has("--markdown")) {
    console.log(renderMarkdown(reports));
    return;
  }

  // Machine-readable summary line for agents / downstream tooling.
  console.log("CLIENT_BUNDLE_REPORT " + JSON.stringify(reportToJson(reports)));

  let failed = false;
  for (const r of reports) {
    console.log(
      `${r.entry}: ${r.moduleCount} modules, ${kib(r.byteCount)} source` +
        (r.knownLeaks.length
          ? `, ${r.knownLeaks.length} known server leak(s)`
          : ""),
    );

    for (const leak of r.critical) {
      failed = true;
      console.error(
        `::error file=${r.entry}::CRITICAL: the client graph reaches the server runtime adapter ` +
          `${leak} (the #3661 hydration crash). Import chain: ${
            traceLeak(r.graph, leak)
          }`,
      );
    }
    for (const leak of r.newLeaks) {
      failed = true;
      console.error(
        `::error file=${r.entry}::New server module in the client bundle: ${leak}. ` +
          `Import chain: ${
            traceLeak(r.graph, leak)
          }. Break the import, or (only if intentional) ` +
          `re-baseline with \`deno task lint:client-bundle:update\`.`,
      );
    }
    if (r.fixedLeaks.length > 0) {
      console.log(
        `::warning file=${r.entry}::${r.fixedLeaks.length} baselined leak(s) are gone — ` +
          `run \`deno task lint:client-bundle:update\` to lock in the improvement: ${
            r.fixedLeaks.join(", ")
          }`,
      );
    }
    if (r.moduleCount > SIZE_WARN_MODULES) {
      console.log(
        `::warning file=${r.entry}::Client graph grew to ${r.moduleCount} modules ` +
          `(${
            kib(r.byteCount)
          }) — a server barrel may have leaked in; investigate before it ships.`,
      );
    }
  }

  if (failed) {
    console.error(
      "\nServer module(s) reached a client bundle. See the annotations above.",
    );
    Deno.exit(1);
  }
  console.log(
    "\nClient bundle boundary verified: no critical or new server leaks.",
  );
}

if (import.meta.main) {
  await main();
}
