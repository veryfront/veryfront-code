import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const TEST_FILE_RE = /\.test\.[cm]?[jt]sx?$/i;
const GLOB_CHARS_RE = /[\*\?\[]/;

let rgAvailable = true;

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function hasGlob(pattern) {
  return GLOB_CHARS_RE.test(pattern);
}

function runRg(args, cwd) {
  if (!rgAvailable) return null;
  const result = spawnSync("rg", args, { cwd, encoding: "utf8" });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      rgAvailable = false;
    }
    return null;
  }
  if (result.status !== 0 && result.status !== 1) return null;
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
    if ("+^$.()|{}[]\\".includes(char)) {
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
    // `rg` skips hidden entries unless `--hidden` is passed, and node:fs glob
    // skips them too. The fallback has to match, or the selected test set
    // depends on whether ripgrep happens to be installed — which is the exact
    // class of divergence this module is being fixed for.
    if (entry.name.startsWith(".")) continue;
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, onFile);
    } else if (entry.isFile()) {
      onFile(fullPath);
    }
  }
}

function getBaseDir(pattern, cwd) {
  const globIndex = pattern.search(GLOB_CHARS_RE);
  if (globIndex === -1) {
    return resolve(cwd, pattern);
  }
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

function listWithFallback(patterns, cwd) {
  const files = new Set();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const absolute = resolve(cwd, pattern);
    if (!hasGlob(pattern)) {
      try {
        const stats = statSync(absolute);
        if (stats.isDirectory()) {
          walk(absolute, (file) => {
            if (TEST_FILE_RE.test(file)) files.add(file);
          });
        } else if (stats.isFile() && TEST_FILE_RE.test(absolute)) {
          files.add(absolute);
        }
      } catch (error) {
        // Same rule as the glob branch below: a missing path contributes
        // nothing, anything else propagates.
        if (!isMissingPathError(error)) throw error;
      }
      continue;
    }

    const baseDir = getBaseDir(pattern, cwd);
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
    const matcher = globToRegex(toPosixPath(pattern));
    walk(baseDir, (file) => {
      const rel = toPosixPath(file.startsWith(cwd) ? file.slice(cwd.length + 1) : file);
      if (matcher.test(rel)) files.add(file);
    });
  }
  return Array.from(files);
}

export function listTestFiles(patterns, cwd = process.cwd()) {
  const files = new Set();
  for (const pattern of patterns) {
    if (!pattern) continue;
    const absolute = resolve(cwd, pattern);

    if (hasGlob(pattern)) {
      const matches = runRg(["--files", "-g", pattern], cwd);
      if (matches) {
        for (const match of matches) files.add(resolve(cwd, match));
      } else {
        // No ripgrep (it is absent on the CI runners), so resolve the glob
        // in-process. This fallback has to be per-pattern: the whole-result
        // fallback at the end only fires when *nothing* matched, so a single
        // explicit file listed next to a glob was enough to suppress it and
        // drop the glob's entire contribution without a word.
        for (const file of listWithFallback([pattern], cwd)) files.add(file);
      }
      continue;
    }

    try {
      const stats = statSync(absolute);
      if (stats.isFile()) {
        if (TEST_FILE_RE.test(absolute)) files.add(absolute);
        continue;
      }
      if (stats.isDirectory()) {
        const matches = runRg(["--files", "-g", "*.test.*", absolute], cwd);
        if (matches) {
          for (const match of matches) files.add(resolve(cwd, match));
        } else {
          for (const file of listWithFallback([absolute], cwd)) files.add(file);
        }
      }
    } catch (error) {
      // Same rule as `listWithFallback`: a missing path contributes nothing,
      // anything else propagates. A broad catch here also swallowed the
      // rethrow from the `listWithFallback` call above, so a directory with an
      // unreadable descendant was silently omitted.
      if (!isMissingPathError(error)) throw error;
    }
  }

  if (files.size === 0) {
    return listWithFallback(patterns, cwd);
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
