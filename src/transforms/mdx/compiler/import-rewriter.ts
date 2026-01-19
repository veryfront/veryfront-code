import { dirname, join, resolve as pathResolve } from "#veryfront/platform/compat/path/index.ts";
import type { CompilationTarget } from "./types.ts";

export interface ImportRewriterConfig {
  filePath: string;
  target: CompilationTarget;
  baseUrl?: string;
  projectDir?: string;
}

function toAbsPath(spec: string, basedir: string): string {
  try {
    if (spec.startsWith("file://")) return new URL(spec).pathname;
    if (spec.startsWith("/")) return pathResolve(spec);
    if (spec.startsWith("http://") || spec.startsWith("https://")) return spec;

    if (!spec.startsWith(".") && !spec.startsWith("/")) {
      return spec; // Return unchanged - it's a bare specifier
    }

    return pathResolve(join(basedir, spec));
  } catch {
    return spec;
  }
}

function toBrowserFs(abs: string, baseUrl?: string): string {
  if (abs.startsWith("http://") || abs.startsWith("https://")) return abs;
  const b64 = btoa(abs).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const path = `/_veryfront/fs/${b64}.js`;
  return baseUrl ? `${baseUrl}${path}` : path;
}

function mapSpec(
  spec: string,
  basedir: string,
  target: CompilationTarget,
  baseUrl?: string,
  _projectDir?: string,
): string {
  // Handle @/ project-relative aliases
  // @/ maps to components/ directory in veryfront projects
  if (spec.startsWith("@/")) {
    const relativePath = spec.slice(2); // Remove @/ prefix
    if (target === "browser") {
      // For browser, use module server endpoint
      const path = `/_vf_modules/${relativePath}.js`;
      return baseUrl ? `${baseUrl}${path}` : path;
    } else {
      // For server (SSR), leave @/ imports as-is
      // The SSRModuleLoader's transformProjectAliasImports will handle these,
      // properly resolving file extensions and transforming dependencies
      return spec;
    }
  }

  const abs = toAbsPath(spec, basedir);
  if (typeof abs !== "string") return spec;

  if (
    abs === spec &&
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !spec.startsWith("file://") &&
    !spec.startsWith("http")
  ) {
    return spec; // Bare specifier - leave for import map resolution
  }

  if (target === "browser") return toBrowserFs(abs, baseUrl);
  return abs.startsWith("http") ? abs : `file://${abs}`;
}

function rewriteLine(
  line: string,
  basedir: string,
  target: CompilationTarget,
  baseUrl?: string,
  projectDir?: string,
): string {
  const mapper = (spec: string) => mapSpec(spec, basedir, target, baseUrl, projectDir);

  line = line.replace(
    /^(\s*import\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
    (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
  );

  line = line.replace(
    /^(\s*import\s+)(["'])([^"']+)(\2)/,
    (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
  );

  line = line.replace(
    /^(\s*export\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
    (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
  );

  return line;
}

export function rewriteBodyImports(body: string, config: ImportRewriterConfig): string {
  const basedir = dirname(config.filePath);

  return body
    .split(/\r?\n/)
    .map((ln) => {
      const trimmed = ln.trimStart();
      if (trimmed.startsWith("import") || trimmed.startsWith("export")) {
        return rewriteLine(ln, basedir, config.target, config.baseUrl, config.projectDir);
      }
      return ln;
    })
    .join("\n");
}

export function rewriteCompiledImports(compiledCode: string, config: ImportRewriterConfig): string {
  const basedir = dirname(config.filePath);
  const mapper = (spec: string) =>
    mapSpec(spec, basedir, config.target, config.baseUrl, config.projectDir);

  let code = compiledCode;

  // Handle @/ aliased imports
  code = code.replace(
    /(from\s+["'])(@\/[^"']+)(["'])/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(
    /(import\(\s*["'])(@\/[^"']+)(["']\s*\))/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(
    /(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(
    /(from\s+["'])(file:\/\/[^"']+)(["'])/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(
    /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(
    /(import\(\s*["'])(file:\/\/[^"']+)(["']\s*\))/g,
    (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`,
  );

  code = code.replace(/file:\/\/[A-Za-z0-9_\-./%]+/g, (match) => mapper(match));

  return code;
}
