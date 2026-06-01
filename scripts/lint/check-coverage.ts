#!/usr/bin/env -S deno run --allow-read
/**
 * Simple LCOV coverage threshold checker.
 * Usage: deno run --allow-read scripts/lint/check-coverage.ts [thresholdPercent] [--include=…] [--exclude=…]
 *
 * Exits non-zero when line coverage of the included files falls below the
 * threshold, so it can gate CI. The LCOV-parsing logic is exported as a pure
 * function (`computeCoverageFromLcov`) so it can be unit-tested without a real
 * coverage run.
 */

export interface CoverageResult {
  covered: number;
  total: number;
  /** Line coverage rounded to a whole percent; 100 when there are no lines. */
  percent: number;
}

export interface CoverageFilters {
  includes?: string[];
  excludes?: string[];
}

function shouldCountFile(
  path: string,
  includes: string[],
  excludes: string[],
): boolean {
  if (excludes.some((pat) => path.includes(pat))) return false;
  if (includes.length === 0) return true;
  return includes.some((pat) => path.includes(pat));
}

/**
 * Compute line coverage from LCOV text. Accumulates per unique file path so a
 * file appearing in multiple LCOV sections is counted once (the first section).
 */
export function computeCoverageFromLcov(
  text: string,
  filters: CoverageFilters = {},
): CoverageResult {
  const includes = filters.includes ?? [];
  const excludes = filters.excludes ?? [];

  // covered/total lines per unique, counted file path.
  const fileTotals = new Map<string, { covered: number; total: number }>();

  let currentFile: string | null = null;
  let countThisFile = false;
  let currentCovered = 0;
  let currentTotal = 0;

  const commit = () => {
    if (currentFile && countThisFile && !fileTotals.has(currentFile)) {
      fileTotals.set(currentFile, {
        covered: currentCovered,
        total: currentTotal,
      });
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("SF:")) {
      commit();
      currentFile = line.slice(3).trim();
      // De-duplicate: only count the first section we see for a given file.
      countThisFile = shouldCountFile(currentFile, includes, excludes) &&
        !fileTotals.has(currentFile);
      currentCovered = 0;
      currentTotal = 0;
      continue;
    }
    if (!countThisFile) continue;
    if (line.startsWith("DA:")) {
      const [, rest] = line.split(":", 2);
      if (!rest) continue;
      const [, countStr] = rest.split(",");
      const count = Number(countStr);
      if (!Number.isNaN(count)) {
        currentTotal += 1;
        if (count > 0) currentCovered += 1;
      }
    }
  }
  commit();

  let covered = 0;
  let total = 0;
  for (const { covered: c, total: t } of fileTotals.values()) {
    covered += c;
    total += t;
  }

  const percent = total === 0 ? 100 : Math.round((covered / total) * 100);
  return { covered, total, percent };
}

async function main(): Promise<void> {
  const threshold = Number(Deno.args[0] ?? "80");
  const lcovPath = "coverage/lcov.info";

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

  const { covered, total, percent } = computeCoverageFromLcov(text, {
    includes,
    excludes,
  });

  if (percent < threshold) {
    console.error(
      `Coverage ${percent}% is below threshold ${threshold}%. (covered ${covered}/${total} lines)`,
    );
    Deno.exit(1);
  }
  console.log(
    `Coverage ${percent}% >= threshold ${threshold}% (covered ${covered}/${total} lines).`,
  );
}

if (import.meta.main) {
  await main();
}
