#!/usr/bin/env -S deno run --allow-read --allow-run
/**
 * P3-2: Per-File Coverage Gate
 *
 * Parses deno coverage LCOV output and enforces per-file thresholds
 * on files changed in the current git diff.
 *
 * Usage:
 *   deno run --allow-read --allow-run scripts/check-coverage-per-file.ts [options]
 *
 * Options:
 *   --line-threshold=80      Minimum line coverage % (default: 80)
 *   --branch-threshold=70    Minimum branch coverage % (default: 70)
 *   --lcov=coverage/lcov.info  Path to LCOV file (default: coverage/lcov.info)
 *   --base=main              Git base branch for diff (default: HEAD)
 *   --all                    Check all files, not just changed ones
 *   --verbose                Show per-file details even for passing files
 */

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = Deno.args;
const lineThreshold = Number(
  args.find((a) => a.startsWith("--line-threshold="))?.split("=")[1] ?? "80",
);
const branchThreshold = Number(
  args.find((a) => a.startsWith("--branch-threshold="))?.split("=")[1] ?? "70",
);
const lcovPath =
  args.find((a) => a.startsWith("--lcov="))?.split("=")[1] ?? "coverage/lcov.info";
const baseBranch =
  args.find((a) => a.startsWith("--base="))?.split("=")[1] ?? "HEAD";
const checkAll = args.includes("--all");
const verbose = args.includes("--verbose");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileCoverage {
  path: string;
  linesFound: number;
  linesHit: number;
  branchesFound: number;
  branchesHit: number;
  linePercent: number;
  branchPercent: number;
}

// ---------------------------------------------------------------------------
// Git: get changed source files
// ---------------------------------------------------------------------------

async function getChangedFiles(base: string): Promise<Set<string>> {
  const cmd = new Deno.Command("git", {
    args: ["diff", "--name-only", "--diff-filter=ACM", base, "--", "src/", "proxy/"],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await cmd.output();

  if (!output.success) {
    // If base doesn't exist (e.g., no commits), fall back to all staged + unstaged
    const fallback = new Deno.Command("git", {
      args: ["diff", "--name-only", "--diff-filter=ACM", "--", "src/", "proxy/"],
      stdout: "piped",
      stderr: "piped",
    });
    const fallbackOut = await fallback.output();
    const text = new TextDecoder().decode(fallbackOut.stdout);
    return new Set(
      text
        .trim()
        .split("\n")
        .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
        .filter((f) => !f.includes(".test."))
        .map((f) => f.trim()),
    );
  }

  const text = new TextDecoder().decode(output.stdout);
  return new Set(
    text
      .trim()
      .split("\n")
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => !f.includes(".test."))
      .map((f) => f.trim()),
  );
}

// ---------------------------------------------------------------------------
// LCOV parser: per-file line + branch coverage
// ---------------------------------------------------------------------------

function parseLcov(text: string): Map<string, FileCoverage> {
  const files = new Map<string, FileCoverage>();
  let current: FileCoverage | null = null;

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      // Commit previous record
      if (current && !files.has(current.path)) {
        current.linePercent =
          current.linesFound === 0 ? 100 : (current.linesHit / current.linesFound) * 100;
        current.branchPercent =
          current.branchesFound === 0 ? 100 : (current.branchesHit / current.branchesFound) * 100;
        files.set(current.path, current);
      }

      const rawPath = line.slice(3).trim();
      // Normalize: strip file:// prefix and project root to get relative path
      let relPath = rawPath.replace(/^file:\/\//, "");
      const srcIdx = relPath.indexOf("/src/");
      const proxyIdx = relPath.indexOf("/proxy/");
      if (srcIdx >= 0) relPath = relPath.slice(srcIdx + 1);
      else if (proxyIdx >= 0) relPath = relPath.slice(proxyIdx + 1);

      current = {
        path: relPath,
        linesFound: 0,
        linesHit: 0,
        branchesFound: 0,
        branchesHit: 0,
        linePercent: 0,
        branchPercent: 0,
      };
      continue;
    }

    if (!current) continue;

    if (line.startsWith("DA:")) {
      const rest = line.slice(3);
      const commaIdx = rest.indexOf(",");
      if (commaIdx < 0) continue;
      const count = Number(rest.slice(commaIdx + 1));
      if (!Number.isNaN(count)) {
        current.linesFound++;
        if (count > 0) current.linesHit++;
      }
    } else if (line.startsWith("BRF:")) {
      current.branchesFound = Number(line.slice(4)) || 0;
    } else if (line.startsWith("BRH:")) {
      current.branchesHit = Number(line.slice(4)) || 0;
    } else if (line.startsWith("LF:")) {
      // Use LF/LH as authoritative if present (overrides DA counting)
      const val = Number(line.slice(3));
      if (!Number.isNaN(val) && val > 0) current.linesFound = val;
    } else if (line.startsWith("LH:")) {
      const val = Number(line.slice(3));
      if (!Number.isNaN(val)) current.linesHit = val;
    }
  }

  // Commit last record
  if (current && !files.has(current.path)) {
    current.linePercent =
      current.linesFound === 0 ? 100 : (current.linesHit / current.linesFound) * 100;
    current.branchPercent =
      current.branchesFound === 0 ? 100 : (current.branchesHit / current.branchesFound) * 100;
    files.set(current.path, current);
  }

  return files;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const lcovText = await Deno.readTextFile(lcovPath).catch(() => null);
if (!lcovText) {
  console.error(
    `LCOV file not found at ${lcovPath}. Run: deno task test:coverage && deno task coverage:report`,
  );
  Deno.exit(2);
}

const allCoverage = parseLcov(lcovText);

// Determine which files to check
let filesToCheck: Set<string>;
if (checkAll) {
  filesToCheck = new Set(allCoverage.keys());
} else {
  filesToCheck = await getChangedFiles(baseBranch);
}

if (filesToCheck.size === 0) {
  console.log("No changed source files to check coverage for.");
  Deno.exit(0);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const failures: FileCoverage[] = [];
const passes: FileCoverage[] = [];
const missing: string[] = [];

for (const file of filesToCheck) {
  const cov = allCoverage.get(file);
  if (!cov) {
    missing.push(file);
    continue;
  }

  const lineFail = cov.linePercent < lineThreshold;
  const branchFail = cov.branchPercent < branchThreshold;

  if (lineFail || branchFail) {
    failures.push(cov);
  } else {
    passes.push(cov);
  }
}

// Output table
const pad = (s: string, n: number) => s.padEnd(n);
const pct = (n: number) => `${Math.round(n)}%`.padStart(5);

console.log("\n--- Per-File Coverage Report ---\n");
console.log(
  `Thresholds: line >= ${lineThreshold}%, branch >= ${branchThreshold}%`,
);
console.log(
  `Files checked: ${filesToCheck.size} | Pass: ${passes.length} | Fail: ${failures.length} | No data: ${missing.length}\n`,
);

if (failures.length > 0) {
  console.log("FAILURES:");
  console.log(
    `  ${pad("File", 60)} ${pad("Lines", 12)} ${pad("Branches", 12)} Status`,
  );
  console.log("  " + "-".repeat(80));
  for (const f of failures.sort((a, b) => a.linePercent - b.linePercent)) {
    const lineMark = f.linePercent < lineThreshold ? "FAIL" : "ok";
    const brMark = f.branchPercent < branchThreshold ? "FAIL" : "ok";
    console.log(
      `  ${pad(f.path, 60)} ${pct(f.linePercent)} (${lineMark})  ${pct(f.branchPercent)} (${brMark})`,
    );
  }
  console.log();
}

if (verbose && passes.length > 0) {
  console.log("PASSING:");
  for (const f of passes) {
    console.log(
      `  ${pad(f.path, 60)} ${pct(f.linePercent)}       ${pct(f.branchPercent)}`,
    );
  }
  console.log();
}

if (missing.length > 0) {
  console.log(
    `WARNING: ${missing.length} changed file(s) have no coverage data:`,
  );
  for (const f of missing) console.log(`  ${f}`);
  console.log();
}

if (failures.length > 0) {
  console.error(
    `FAILED: ${failures.length} file(s) below coverage threshold.`,
  );
  Deno.exit(1);
} else {
  console.log("All changed files meet coverage thresholds.");
}
