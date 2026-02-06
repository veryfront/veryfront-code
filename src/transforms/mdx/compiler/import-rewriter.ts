import { dirname, join, resolve as pathResolve } from "#veryfront/compat/path/index.ts";
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

    if (!spec.startsWith(".") && !spec.startsWith("/")) return spec;

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
): string {
  // Handle @/ project-relative aliases
  // @/ maps to components/ directory in veryfront projects
  if (spec.startsWith("@/")) {
    if (target !== "browser") return spec;

    const relativePath = spec.slice(2);
    const path = `/_vf_modules/${relativePath}.js`;
    return baseUrl ? `${baseUrl}${path}` : path;
  }

  const abs = toAbsPath(spec, basedir);

  const isBare = abs === spec &&
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !spec.startsWith("file://") &&
    !spec.startsWith("http");

  if (isBare) return spec;

  if (target === "browser") return toBrowserFs(abs, baseUrl);
  return abs.startsWith("http") ? abs : `file://${abs}`;
}

function rewriteLine(
  line: string,
  basedir: string,
  target: CompilationTarget,
  baseUrl?: string,
): string {
  const mapper = (spec: string) => mapSpec(spec, basedir, target, baseUrl);

  return line
    .replace(
      /^(\s*import\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    )
    .replace(
      /^(\s*import\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    )
    .replace(
      /^(\s*export\s+[^'";]+?from\s+)(["'])([^"']+)(\2)/,
      (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
    );
}

export function rewriteBodyImports(body: string, config: ImportRewriterConfig): string {
  const basedir = dirname(config.filePath);

  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      if (!trimmed.startsWith("import") && !trimmed.startsWith("export")) return line;
      return rewriteLine(line, basedir, config.target, config.baseUrl);
    })
    .join("\n");
}

export function rewriteCompiledImports(compiledCode: string, config: ImportRewriterConfig): string {
  const basedir = dirname(config.filePath);
  const mapper = (spec: string) => mapSpec(spec, basedir, config.target, config.baseUrl);

  const replaceAll = (code: string, patterns: RegExp[]): string => {
    for (const pattern of patterns) {
      code = code.replace(pattern, (_m, p1, p2, p3) => `${p1}${mapper(p2)}${p3}`);
    }
    return code;
  };

  let code = compiledCode;

  code = replaceAll(code, [
    /(from\s+["'])(@\/[^"']+)(["'])/g,
    /(import\(\s*["'])(@\/[^"']+)(["']\s*\))/g,
    /(from\s+["'])(\.{1,2}\/[^"']+)(["'])/g,
    /(from\s+["'])(file:\/\/[^"']+)(["'])/g,
    /(import\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g,
    /(import\(\s*["'])(file:\/\/[^"']+)(["']\s*\))/g,
  ]);

  code = code.replace(/file:\/\/[A-Za-z0-9_\-./%]+/g, (match) => mapper(match));

  return code;
}
