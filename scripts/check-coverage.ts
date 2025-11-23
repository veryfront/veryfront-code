#!/usr/bin/env -S deno run --allow-read
/**
 * Simple LCOV coverage threshold checker.
 * Usage: deno run --allow-read scripts/check-coverage.ts [thresholdPercent]
 */
const threshold = Number(Deno.args[0] ?? "80");
const lcovPath = "coverage/lcov.info";

// Parse optional --include= and --exclude= filters
const includes = Deno.args
  .filter((a) => a.startsWith("--include="))
  .map((a) => a.replace("--include=", ""));
const excludes = Deno.args
  .filter((a) => a.startsWith("--exclude="))
  .map((a) => a.replace("--exclude=", ""));

const text = await Deno.readTextFile(lcovPath).catch(() => null);
if (!text) {
  console.error(
    `LCOV file not found at ${lcovPath}. Run tests with coverage first.`,
  );
  Deno.exit(2);
}

// Accumulate coverage per unique file path to avoid double-counting
const fileTotals = new Map<string, { covered: number; total: number }>();

let currentFile: string | null = null;
let countThisFile = true;
let currentCovered = 0;
let currentTotal = 0;

function shouldCountFile(path: string): boolean {
  const isExcluded = excludes.some((pat) => path.includes(pat));
  if (isExcluded) return false;
  if (includes.length === 0) return true;
  return includes.some((pat) => path.includes(pat));
}

for (const line of text.split(/\r?\n/)) {
  if (line.startsWith("SF:")) {
    // Commit previous file section if any
    if (currentFile && countThisFile) {
      if (!fileTotals.has(currentFile)) {
        fileTotals.set(currentFile, {
          covered: currentCovered,
          total: currentTotal,
        });
      }
    }
    // Start new file section
    currentFile = line.slice(3).trim();
    const shouldCount = currentFile ? shouldCountFile(currentFile) : false;
    // De-duplicate: if we've already seen this file, skip counting subsequent sections
    countThisFile = shouldCount && !fileTotals.has(currentFile!);
    currentCovered = 0;
    currentTotal = 0;
    continue;
  }
  if (!countThisFile) continue;
  if (line.startsWith("DA:")) {
    const [, rest] = line.split(":", 2);
    if (!rest) continue;
    const [_lineno, countStr] = rest.split(",");
    const count = Number(countStr);
    if (!Number.isNaN(count)) {
      currentTotal += 1;
      if (count > 0) currentCovered += 1;
    }
  }
}

// Commit last file if needed
if (currentFile && countThisFile) {
  if (!fileTotals.has(currentFile)) {
    fileTotals.set(currentFile, {
      covered: currentCovered,
      total: currentTotal,
    });
  }
}

let covered = 0;
let total = 0;
for (const { covered: c, total: t } of fileTotals.values()) {
  covered += c;
  total += t;
}

const percent = total === 0 ? 100 : Math.round((covered / total) * 100);
if (percent < threshold) {
  console.error(
    `Coverage ${percent}% is below threshold ${threshold}%. (covered ${covered}/${total} lines)`,
  );
  Deno.exit(1);
} else {
  console.log(
    `Coverage ${percent}% >= threshold ${threshold}% (covered ${covered}/${total} lines).`,
  );
}
