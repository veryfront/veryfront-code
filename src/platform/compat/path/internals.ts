export interface ParsedPathRoot {
  absolute: boolean;
  comparisonRoot: string;
  rest: string;
  root: string;
  windowsLike: boolean;
}

const WINDOWS_DRIVE = /^([A-Za-z]:)(\/)?/;

export function canonicalizeSeparators(path: string): string {
  return path.includes("\\") ? path.replace(/\\/g, "/") : path;
}

export function parsePathRoot(input: string): ParsedPathRoot {
  const path = canonicalizeSeparators(input);
  const drive = path.match(WINDOWS_DRIVE);
  if (drive) {
    const drivePrefix = drive[1] as string;
    const absolute = drive[2] === "/";
    const root = absolute ? `${drivePrefix}/` : drivePrefix;
    return {
      absolute,
      comparisonRoot: drivePrefix.toLowerCase(),
      rest: path.slice(drive[0].length),
      root,
      windowsLike: true,
    };
  }

  if (path.startsWith("//")) {
    const segments = path.slice(2).split("/");
    const server = segments.shift();
    const share = segments.shift();
    if (server && share) {
      const root = `//${server}/${share}/`;
      return {
        absolute: true,
        comparisonRoot: root.toLowerCase(),
        rest: segments.join("/"),
        root,
        windowsLike: true,
      };
    }
  }

  if (path.startsWith("/")) {
    return {
      absolute: true,
      comparisonRoot: "/",
      rest: path.replace(/^\/+/, ""),
      root: "/",
      windowsLike: false,
    };
  }

  return {
    absolute: false,
    comparisonRoot: "",
    rest: path,
    root: "",
    windowsLike: false,
  };
}

export function normalizeCanonicalPath(input: string): string {
  if (input === "") return ".";

  const path = canonicalizeSeparators(input);
  const root = parsePathRoot(path);
  const preserveTrailingSeparator = path.endsWith("/") && root.rest !== "";
  const normalized: string[] = [];

  for (const part of root.rest.split("/")) {
    if (!part || part === ".") continue;
    if (part !== "..") {
      normalized.push(part);
      continue;
    }

    const previous = normalized[normalized.length - 1];
    if (previous !== undefined && previous !== "..") {
      normalized.pop();
    } else if (!root.absolute) {
      normalized.push(part);
    }
  }

  const tail = normalized.join("/");
  let result: string;
  if (!root.root) result = tail || ".";
  else if (!tail) result = root.root;
  else if (root.root.endsWith("/")) result = `${root.root}${tail}`;
  else result = `${root.root}${tail}`;

  if (preserveTrailingSeparator && result !== "." && !result.endsWith("/")) {
    result += "/";
  }
  return result;
}

export function getRuntimeCwd(): string {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { cwd?: () => string };
    process?: { cwd?: () => string };
  };

  try {
    const cwd = runtime.Deno?.cwd?.();
    if (cwd) return canonicalizeSeparators(cwd);
  } catch {
    // Restricted runtimes can deny access to the working directory.
  }

  try {
    const cwd = runtime.process?.cwd?.();
    if (cwd) return canonicalizeSeparators(cwd);
  } catch {
    // Use the filesystem root when no runtime working directory is available.
  }

  return "/";
}
