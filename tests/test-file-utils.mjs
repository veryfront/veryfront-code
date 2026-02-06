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
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
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
      } catch {
        // Ignore missing paths.
      }
      continue;
    }

    const baseDir = getBaseDir(pattern, cwd);
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
        continue;
      }
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
    } catch {
      // Ignore missing paths or stat failures.
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
