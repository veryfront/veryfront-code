/**
 * Test-file selection.
 *
 * Patterns are resolved entirely in-process. There is deliberately no ripgrep
 * path and no other external resolver — see #3784. `listTestFiles` used to
 * shell out to `rg` and walk the tree itself only when `rg` was absent, which
 * made the selected set depend on which binaries a machine happened to have.
 * #3780 fixed a run of divergences between the two across six review rounds,
 * most of them introduced by the fix for the previous one. Exact parity with
 * `rg` is not reachable by inspection, and it was never the goal. The goal is
 * that the same tests run everywhere; one implementation is how that is met.
 *
 * The trade is `.gitignore` awareness, which `rg` provided for free. It was
 * measured before being given up: with `npm/` built by `deno task build:npm`,
 * every gitignored `*.test.*` file in the tree lives under `node_modules/` or
 * `npm/node_modules/`, and no pattern any consumer passes reaches either. The
 * `rg` (15.2.0) and in-process sets were identical — 1598, 1729 and 1927 files
 * for the `test:node`, `test:bun` and Bun-default pattern sets respectively.
 *
 * `node:fs` `globSync` was evaluated as a third option and rejected: it is
 * three implementations, not one. On the same fixtures, Node 25 and Deno 2.7
 * return `src` itself for the pattern `src` + globstar while Bun 1.3 does not,
 * and Node and Deno match through a hidden directory named in a pattern's
 * literal prefix while Bun returns nothing. All three runtimes load this
 * module, so that would restore the divergence class removing `rg` closes.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/i;
const GLOB_CHARS_RE = /[\*\?\[{]/;

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function hasGlob(pattern) {
  return GLOB_CHARS_RE.test(pattern);
}

/**
 * Index of the `]` closing the class opened at `start`, or -1 when there is
 * none and the `[` is therefore a literal.
 *
 * A `]` in the first position is part of the class body rather than its
 * terminator, which is why the search can start past it.
 *
 * Shared so `expandBraces` and `globToRegex` cannot disagree about where a
 * class ends. They did: `expandBraces` did not know classes existed, so
 * `src/[{}].test.ts` was reduced to `src/[].test.ts` before `globToRegex` ever
 * saw it. Two scanners, one grammar, is how that bug happens again.
 */
function findClassEnd(glob, start) {
  return glob.indexOf("]", glob[start + 1] === "]" ? start + 2 : start + 1);
}

function globToRegex(glob) {
  let re = "^";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      const next = glob[i + 1];
      if (next === "*") {
        // `**` only crosses directory boundaries when it is a *complete*
        // path segment. Both ripgrep and node:fs `globSync` agree:
        //   src/**/*.test.ts  -> src/a.test.ts AND src/nested/b.test.ts
        //   src/**.test.ts    -> src/a.test.ts only (segment-scoped)
        //   src/foo**/*.test.ts -> src/foo/a.test.ts only, NOT src/foo.test.ts
        // So the globstar translation is gated on both boundaries, and a
        // `**` glued to other characters degrades to a single `*`.
        const atSegmentStart = i === 0 || glob[i - 1] === "/";
        const after = glob[i + 2];
        if (atSegmentStart && after === "/") {
          // Matches zero or more segments, so the depth-1 case is included.
          re += "(?:.*\\/)?";
          i += 2;
          continue;
        }
        if (atSegmentStart && after === undefined) {
          re += ".*";
          i += 1;
          continue;
        }
        re += "[^/]*";
        i += 1;
        continue;
      }
      re += "[^/]*";
      continue;
    }
    if (char === "?") {
      re += "[^/]";
      continue;
    }
    if (char === "[") {
      // `hasGlob` counts `[` as a glob character, so escaping the brackets here
      // made every bracket pattern match nothing — and an empty selection is a
      // silently passing test run, not an error. `rg -g 'src/[ab].test.ts'`
      // returns a.test.ts and b.test.ts, so the class is translated instead.
      const closing = findClassEnd(glob, i);
      if (closing !== -1) {
        let body = glob.slice(i + 1, closing);
        // `!` is the glob spelling of a negated class; `^` is the regex one.
        const negated = body.startsWith("!") || body.startsWith("^");
        if (negated) body = body.slice(1);
        // A literal `]` first, a literal `-` last, and `\` all need escaping so
        // the class cannot break out into the surrounding expression.
        const escaped = body.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
        // Never let a class match a separator: a glob segment cannot span one.
        re += negated ? `[^/${escaped}]` : `[${escaped}]`;
        i = closing;
        continue;
      }
      // Unterminated `[` is a literal bracket, which is what rg does too.
      re += "\\[";
      continue;
    }
    if ("+^$.()|{}]\\".includes(char)) {
      re += `\\${char}`;
      continue;
    }
    if (char === "/") {
      re += "\\/";
      continue;
    }
    re += char;
  }
  return new RegExp(`${re}$`);
}

function walk(dir, onFile) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Hidden *directories* are pruned; dot-prefixed *files* are not:
    //   hidden directory  -> skipped   (src/.fixtures/x.test.ts is omitted)
    //   dot-prefixed file -> INCLUDED  (src/.smoke.test.ts is returned)
    // Inherited from the `rg` behaviour this module used to have to match, and
    // kept on purpose so removing `rg` changes no selection. `node:fs` glob
    // excludes both, which is one more reason it is not a drop-in here.
    // `node_modules` is pruned for the same reason as hidden directories: the
    // resolver no longer consults `.gitignore` (see the module doc), and this
    // is where every gitignored `*.test.*` in the tree lives — 498 of them,
    // under `npm/node_modules/` and `node_modules/.deno/`. Nothing under
    // `src/`, `tests/` or `proxy/` contains a `node_modules`, so this cannot
    // change what the four consumers select; it makes the guarantee explicit
    // rather than incidental, and covers `run-affected-tests.mjs`, which can
    // pass the repo root as a directory pattern when a root-level file changes.
    if (entry.isDirectory() && isPrunedDirectoryName(entry.name)) continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

/**
 * Index of the `{` opening the outermost brace group, or -1 when the pattern
 * has none. Braces inside a `[...]` class are class members, not alternation:
 * `rg` 15.2.0 and `node:fs` globSync both return `{.test.ts` and `}.test.ts`
 * for `src/[{}].test.ts`, and `globToRegex` already translates that class
 * correctly — it just never got the chance while this scan ran first.
 *
 * Backslash escapes are deliberately not honoured here. `globToRegex` does not
 * honour them either (it emits `\\` for a `\`, matching a literal backslash),
 * so `rg -g 'src/\{a\}.test.ts'` matches where this module does not. That is a
 * pre-existing gap in the translator, not in this scan: skipping `\{` here
 * would only hand `globToRegex` a pattern it still cannot match. Fixing it
 * means teaching the translator about escapes, which is a separate change.
 */
function findBraceOpen(pattern) {
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "[") {
      const closing = findClassEnd(pattern, i);
      if (closing !== -1) i = closing;
      continue;
    }
    if (char === "{") return i;
  }
  return -1;
}

/**
 * Expand `{a,b}` alternation into one pattern per branch.
 *
 * Expands the outermost group and recurses, so nested groups resolve without a
 * parser. An unbalanced `{` is left literal, which is what `rg` does. Every
 * scan — for the opening brace, its match, and the commas between branches —
 * steps over `[...]` classes, so a class carrying braces survives intact for
 * `globToRegex` to translate.
 */
function expandBraces(pattern) {
  const open = findBraceOpen(pattern);
  if (open === -1) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "[") {
      const closing = findClassEnd(pattern, i);
      if (closing !== -1) i = closing;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth !== 0) continue;
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      const body = pattern.slice(open + 1, i);
      const branches = [];
      let nested = 0;
      let current = "";
      for (let j = 0; j < body.length; j += 1) {
        const bodyChar = body[j];
        if (bodyChar === "[") {
          const closingClass = findClassEnd(body, j);
          if (closingClass !== -1) {
            current += body.slice(j, closingClass + 1);
            j = closingClass;
            continue;
          }
        }
        if (bodyChar === "{") nested += 1;
        if (bodyChar === "}") nested -= 1;
        if (bodyChar === "," && nested === 0) {
          branches.push(current);
          current = "";
          continue;
        }
        current += bodyChar;
      }
      branches.push(current);
      return branches.flatMap((branch) => expandBraces(`${head}${branch}${tail}`));
    }
  }
  return [pattern];
}

/** True when `target` exists, without distinguishing why it does not. */
function pathExists(target) {
  try {
    statSync(target);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
    return false;
  }
}

function getBaseDir(pattern, cwd) {
  const globIndex = pattern.search(GLOB_CHARS_RE);
  if (globIndex === -1) {
    return resolve(cwd, pattern);
  }
  // A slash-free glob matches by basename at any depth, so its search root is
  // `cwd` rather than the segment before the first glob character.
  if (!pattern.includes("/")) return resolve(cwd, ".");
  const prefix = pattern.slice(0, globIndex);
  const base = prefix.endsWith("/") || prefix === "" ? prefix : dirname(prefix);
  return resolve(cwd, base || ".");
}

/**
 * A base path that does not exist contributes nothing. Anything else —
 * `EACCES` on an ancestor, a device error — has to propagate: swallowing it
 * would drop the whole pattern, and if that left the selection empty the
 * runner would exit 0 having run nothing. That silent-omission failure is the
 * reason this module is being fixed.
 */
function isMissingPathError(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * True when `target` sits under a dot-prefixed directory relative to `cwd`.
 *
 * Only segments below `cwd` count: a checkout that itself lives under a hidden
 * directory is not thereby invisible to its own test runner.
 */
function isPrunedDirectoryName(name) {
  return name.startsWith(".") || name === "node_modules";
}

function hasHiddenSegment(target, cwd) {
  const relativePath = relative(cwd, target);
  // `startsWith("..")` alone would misread a directory *named* `..fixtures` as
  // a parent path and skip the hidden check entirely. Only an exact `..` or a
  // `..` followed by a separator escapes `cwd`.
  const escapesCwd = relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) || relativePath.startsWith("../");
  if (relativePath === "" || escapesCwd) return false;
  // Covers the base itself, not just its children: `walk` starts *inside* the
  // base, so a base that is a hidden directory or `node_modules` would be
  // traversed in full while every equivalent child was pruned.
  return toPosixPath(relativePath).split("/").some(isPrunedDirectoryName);
}

/**
 * Resolve `patterns` — literal files, directories and globs — to absolute test
 * file paths.
 *
 * @param {string[]} patterns
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function listTestFiles(patterns, cwd = process.cwd()) {
  const files = new Set();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const absolute = resolve(cwd, pattern);
    // An existing path wins over a glob reading of the same string. `[id]` is
    // both a valid character class and a legal directory name, and this repo
    // has such directories (src/discovery/__fixtures__/.../[userId]/). Treating
    // the string as a class made those unreachable: the class can never match a
    // directory literally named `[id]`. `rg` resolves the same ambiguity the
    // same way — an explicit path argument is honoured as a path.
    if (!hasGlob(pattern) || pathExists(absolute)) {
      // Only the base lookup is guarded. Wrapping the traversal too would
      // swallow an `ENOENT` raised *inside* `walk` — a descendant removed
      // between `readdirSync` calls — and silently drop the directory's whole
      // contribution.
      let stats;
      try {
        stats = statSync(absolute);
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
        continue;
      }
      if (stats.isDirectory()) {
        walk(absolute, (file) => {
          if (TEST_FILE_RE.test(file)) files.add(file);
        });
      } else if (stats.isFile() && TEST_FILE_RE.test(absolute)) {
        files.add(absolute);
      }
      continue;
    }

    const baseDir = getBaseDir(pattern, cwd);
    // A pattern whose literal prefix descends into a hidden directory matches
    // nothing at all, which is what `walk`'s per-entry pruning means applied to
    // the base itself — `walk` starts *inside* the base, so the per-entry check
    // never sees it. Same as `rg -g 'src/.fixtures/**/*.test.ts'`, verified
    // against rg 15.
    if (hasHiddenSegment(baseDir, cwd)) continue;
    // A glob whose base does not exist contributes nothing, the same as the
    // non-glob branch above. This is checked up front rather than by catching
    // around the walk: a failure *inside* the traversal (an unreadable
    // subdirectory, a file removed mid-walk) would otherwise be swallowed
    // after `walk` had already accumulated part of the tree, and the runner
    // would execute a partial selection and report success — which is the
    // exact silent-omission failure this module is being fixed for. Those
    // errors propagate.
    try {
      if (!statSync(baseDir).isDirectory()) continue;
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      continue;
    }
    // `rg` matches a slash-free glob against the BASENAME at any depth, so
    // `*.test.ts` finds every test in the tree rather than only those sitting
    // beside `cwd`. A pattern containing a separator stays anchored.
    const posix = toPosixPath(pattern);
    const matchers = expandBraces(posix).map((expanded) => ({
      regex: globToRegex(expanded),
      basenameOnly: !expanded.includes("/"),
    }));
    walk(baseDir, (file) => {
      const rel = toPosixPath(file.startsWith(cwd) ? file.slice(cwd.length + 1) : file);
      const base = rel.slice(rel.lastIndexOf("/") + 1);
      for (const { regex, basenameOnly } of matchers) {
        if (regex.test(basenameOnly ? base : rel)) {
          files.add(file);
          return;
        }
      }
    });
  }
  return Array.from(files);
}

export function splitIntoShards(files, shardCount) {
  const total = Math.max(1, Math.min(shardCount, files.length || 1));
  const shards = Array.from({ length: total }, () => []);
  const sorted = [...files].sort();
  sorted.forEach((file, index) => {
    shards[index % total].push(file);
  });
  return shards;
}

/**
 * @param {string[]} files
 * @param {{ include?: string[]; exclude?: string[] }} [filters]
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function filterTestFiles(files, { include = [], exclude = [] } = {}, cwd = process.cwd()) {
  if (files.length === 0) return [];
  const includeMatchers = include.map((pattern) => globToRegex(toPosixPath(pattern)));
  const excludeMatchers = exclude.map((pattern) => globToRegex(toPosixPath(pattern)));

  return files.filter((file) => {
    const rel = toPosixPath(file.startsWith(cwd) ? file.slice(cwd.length + 1) : file);
    if (includeMatchers.length > 0 && !includeMatchers.some((re) => re.test(rel))) {
      return false;
    }
    if (excludeMatchers.length > 0 && excludeMatchers.some((re) => re.test(rel))) {
      return false;
    }
    return true;
  });
}
