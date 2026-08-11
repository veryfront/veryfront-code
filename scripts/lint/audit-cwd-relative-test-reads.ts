#!/usr/bin/env -S deno run --allow-read
/**
 * Bans cwd-relative repo reads at the top level of a test module.
 *
 * Test files run as separate isolates inside ONE process under `--parallel`,
 * and `src/testing/cwd.ts` calls `Deno.chdir` on that shared process — its own
 * header says so: "mutates state shared by every test in the process". It
 * restores in a `finally`, but a restore only closes the window afterwards; a
 * reader executing inside the window still resolves against another test's
 * directory.
 *
 * Which test files share a process is decided by `selectShardFiles` in
 * `scripts/test/coverage-ci.ts` (`index % 8` over the sorted file list), so
 * adding any test file anywhere reshuffles the pairings. A test that reads a
 * repo file by cwd-relative path is therefore not stably correct — it is
 * correct until an unrelated file lands beside it.
 *
 * `src/config/cicd-coverage-workflow.test.ts` was the only such file and it did
 * fail in CI with `NotFound: readfile '.github/workflows/cicd.yml'`, three
 * times, on different shards. Because the read sat in a module-level `await`,
 * the throw was an *uncaught module error*: Deno failed the whole file, the
 * shard failed, and `tests (unit)` and `coverage gate` both failed as
 * dependents. One unreadable file, three red checks, no useful message.
 *
 * The fix is to resolve from `import.meta.url` instead of the process cwd:
 *
 *   const repoRoot = new URL("../../", import.meta.url);
 *   await Deno.readTextFile(new URL("deno.json", repoRoot));
 *
 * That removes the dependency rather than trying to coordinate chdir discipline
 * across every test in the process, which `--parallel` makes impossible anyway.
 *
 * This audit starts at zero offenders, so it is a ratchet from a clean state.
 */

/**
 * The `(?:Sync)?` grouping is load-bearing: `Sync?` would mean "Syn" followed by
 * an optional "c", so it would only ever match a call literally containing
 * "Syn" — i.e. nothing. The audit's own tests caught that.
 */
const READ_CALL =
  /Deno\.((?:readTextFile|readFile|readDir|stat|lstat)(?:Sync)?)\s*\(\s*["'`]([^"'`]+)["'`]/g;

/** A path that resolves against the process cwd rather than the module. */
function isCwdRelative(path: string): boolean {
  if (path.startsWith("file:") || path.startsWith("http")) return false;
  if (path.startsWith("/")) return false;
  return true;
}

export interface Offender {
  file: string;
  line: number;
  call: string;
  path: string;
}

/**
 * Reports cwd-relative reads that execute at module scope.
 *
 * Depth is tracked by counting braces outside strings and comments, which is
 * enough here: the rule only cares whether a call sits at depth 0, and a call
 * nested in any function, test body, or object literal is out of scope. Reads
 * inside a test body are fine — by then the module has loaded, and a throw is a
 * normal test failure rather than an uncaught module error.
 */
export function findOffenders(source: string, file: string): Offender[] {
  const offenders: Offender[] = [];
  let depth = 0;
  let inBlockComment = false;

  source.split("\n").forEach((rawLine, index) => {
    let line = rawLine;

    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const blockStart = line.indexOf("/*");
    if (blockStart !== -1) {
      const end = line.indexOf("*/", blockStart + 2);
      if (end === -1) {
        line = line.slice(0, blockStart);
        inBlockComment = true;
      } else {
        line = line.slice(0, blockStart) + line.slice(end + 2);
      }
    }
    const lineComment = line.indexOf("//");
    if (lineComment !== -1) line = line.slice(0, lineComment);

    if (depth === 0) {
      READ_CALL.lastIndex = 0;
      for (const match of line.matchAll(READ_CALL)) {
        const [, call, path] = match;
        if (call && path && isCwdRelative(path)) {
          offenders.push({ file, line: index + 1, call, path });
        }
      }
    }

    // Strings can carry braces; strip them before counting depth.
    const stripped = line.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "");
    for (const ch of stripped) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    }
  });

  return offenders;
}

async function collectTestFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(root)) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      files.push(...await collectTestFiles(path));
    } else if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      files.push(path);
    }
  }
  return files;
}

if (import.meta.main) {
  const repoRoot = new URL("../../", import.meta.url).pathname;
  const roots = ["src", "cli", "tests", "scripts"];
  const offenders: Offender[] = [];

  for (const root of roots) {
    let files: string[] = [];
    try {
      files = await collectTestFiles(`${repoRoot}${root}`);
    } catch {
      continue;
    }
    for (const file of files) {
      const source = await Deno.readTextFile(file);
      offenders.push(...findOffenders(source, file.replace(repoRoot, "")));
    }
  }

  if (offenders.length > 0) {
    console.error(
      `Found ${offenders.length} cwd-relative repo read(s) at test module scope.\n` +
        `Resolve from import.meta.url instead — see the header of this script for why.\n`,
    );
    for (const o of offenders.sort((a, b) => a.file.localeCompare(b.file))) {
      console.error(`  ${o.file}:${o.line}  Deno.${o.call}("${o.path}")`);
    }
    Deno.exit(1);
  }

  console.log("No cwd-relative repo reads at test module scope.");
}
