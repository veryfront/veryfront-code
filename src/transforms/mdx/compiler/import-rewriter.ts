import {
  dirname,
  fromFileUrl,
  isAbsolute,
  join,
  resolve as pathResolve,
  toFileUrl,
} from "#veryfront/compat/path/index.ts";
import type { CompilationTarget } from "#veryfront/extensions/content/index.ts";
import { base64urlEncode } from "#veryfront/utils";
import { buildModuleServerUrl, normalizeExtension } from "../../import-rewriter/url-builder.ts";

export interface ImportRewriterConfig {
  filePath: string;
  target: CompilationTarget;
  baseUrl?: string;
  projectDir?: string;
}

function toAbsPath(spec: string, basedir: string): string {
  if (spec.startsWith("file:")) return fromFileUrl(spec);
  if (spec.startsWith("/")) return pathResolve(spec);
  if (spec.startsWith("http://") || spec.startsWith("https://")) return spec;

  if (!spec.startsWith(".") && !spec.startsWith("/")) return spec;

  return pathResolve(join(basedir, spec));
}

function toBrowserFs(abs: string, baseUrl?: string): string {
  if (abs.startsWith("http://") || abs.startsWith("https://")) return abs;

  const b64 = base64urlEncode(abs);
  const path = `/_veryfront/fs/${b64}.js`;
  return baseUrl ? buildModuleServerUrl(baseUrl, path) : path;
}

function toBrowserAliasPath(path: string): string {
  const normalizedPath = normalizeExtension(path);
  return /\.(?:mjs|cjs|js|css)$/.test(normalizedPath) ? normalizedPath : `${normalizedPath}.js`;
}

function splitLocalSpecifier(spec: string): { path: string; suffix: string } {
  if (spec.startsWith("file:")) {
    const url = new URL(spec);
    const suffix = `${url.search}${url.hash}`;
    url.search = "";
    url.hash = "";
    return { path: url.href, suffix };
  }

  if (!spec.startsWith(".") && !spec.startsWith("/")) {
    return { path: spec, suffix: "" };
  }

  const queryIndex = spec.indexOf("?");
  const fragmentIndex = spec.indexOf("#");
  const suffixIndex = queryIndex === -1
    ? fragmentIndex
    : fragmentIndex === -1
    ? queryIndex
    : Math.min(queryIndex, fragmentIndex);
  return suffixIndex === -1
    ? { path: spec, suffix: "" }
    : { path: spec.slice(0, suffixIndex), suffix: spec.slice(suffixIndex) };
}

/**
 * Map one parser-recognized module specifier for the requested compile target.
 *
 * This function deliberately does not scan source text. Callers own syntax
 * parsing so code examples and string literals cannot be mistaken for imports.
 */
export function rewriteImportSpecifier(
  spec: string,
  config: ImportRewriterConfig,
): string {
  const configuredFilePath = config.filePath.startsWith("file:")
    ? fromFileUrl(config.filePath)
    : config.filePath;
  const filePath = config.projectDir && !isAbsolute(configuredFilePath)
    ? pathResolve(config.projectDir, configuredFilePath)
    : configuredFilePath;
  const basedir = dirname(filePath);

  // Handle @/ project-relative aliases
  // @/ maps to components/ directory in veryfront projects
  if (spec.startsWith("@/")) {
    if (config.target !== "browser") return spec;

    const { path: relativePath, suffix } = splitLocalSpecifier(spec.slice(1));
    const modulePath = toBrowserAliasPath(relativePath.slice(1));
    const path = `/_vf_modules/${modulePath}${suffix}`;
    return config.baseUrl ? buildModuleServerUrl(config.baseUrl, path) : path;
  }

  const localSpecifier = splitLocalSpecifier(spec);
  // MDX has historically treated a leading slash as project-relative rather
  // than as the host filesystem root. Preserve that contract when the caller
  // provides the project boundary.
  const resolvableSpecifier = localSpecifier.path.startsWith("/") && config.projectDir
    ? join(config.projectDir, localSpecifier.path)
    : localSpecifier.path;
  const abs = toAbsPath(resolvableSpecifier, basedir);

  const isBare = abs === resolvableSpecifier &&
    !spec.startsWith(".") &&
    !spec.startsWith("/") &&
    !spec.startsWith("file://") &&
    !spec.startsWith("http");

  if (isBare) return spec;

  if (config.target === "browser") {
    return `${toBrowserFs(abs, config.baseUrl)}${localSpecifier.suffix}`;
  }
  return abs.startsWith("http") ? abs : `${toFileUrl(abs).href}${localSpecifier.suffix}`;
}

export function rewriteBodyImports(body: string, config: ImportRewriterConfig): string {
  const mapper = (spec: string) => rewriteImportSpecifier(spec, config);

  // Rewrite `import … from '…'` and `export … from '…'`, including multiline
  // destructured imports.  `[\s\S]*?` crosses newlines so that
  //   import {
  //     Foo,
  //     Bar
  //   } from "mod"
  // is rewritten in one pass.  The non-greedy match stops at the first `from`
  // keyword, which is correct for well-formed ESM.
  let result = body.replace(
    /(^[ \t]*(?:import|export)\s+[\s\S]*?\bfrom\b\s*)(["'])([^"']+)(\2)/gm,
    (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
  );

  // Side-effect-only imports have no bindings or `from`: import "mod"
  result = result.replace(
    /^([ \t]*import\s+)(["'])([^"']+)(\2)/gm,
    (_m, p1, q, s, q2) => `${p1}${q}${mapper(s)}${q2}`,
  );

  return result;
}

export function rewriteCompiledImports(compiledCode: string, config: ImportRewriterConfig): string {
  const mapper = (spec: string) => rewriteImportSpecifier(spec, config);

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
  // Note: `file://` URLs in import positions are already fully covered by the
  // patterns above (`from "file://…"` and `import("file://…")`).  A blanket
  // replacement across the whole code string would incorrectly rewrite URLs
  // inside string literals and comments, so it is intentionally omitted here.

  return code;
}
