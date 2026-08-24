/**
 * CSS Strip Stage - removes CSS import statements from compiled code.
 *
 * CSS files are not valid JS modules and will crash both the SSR module
 * loader and browser module system if left in compiled code. This plugin
 * strips them and records the CSS specifiers in pipeline metadata for
 * downstream collection (used by the SSR rendering pipeline to include
 * the CSS content in the HTML output).
 *
 * For CSS Module imports (`import styles from "./X.module.css"`), the
 * import is replaced with a Proxy stub that returns the property name
 * as the class name. This matches the Next.js convention where
 * `styles.container` → `"container"` (identity mapping), which works
 * correctly with Tailwind CSS class-based styling.
 */

import type { TransformPlugin } from "../types.ts";
import { TransformStage } from "../types.ts";
import { parseImports, rewriteImports } from "../../esm/lexer.ts";
import {
  getCssModuleScope,
  resolveCssModuleKey,
  toScopedCssModuleClass,
} from "#veryfront/transforms/css-modules/naming.ts";

function isCSSImport(specifier: string | undefined): boolean {
  return specifier?.endsWith(".css") || false;
}

function isCssModuleImport(specifier: string | undefined): boolean {
  return specifier?.endsWith(".module.css") || false;
}

function cssModuleProxyExpression(): string {
  return "new Proxy({}, { get: (_, p) => String(p) })";
}

function scopedCssModuleProxyExpression(moduleKey: string): string {
  const scope = getCssModuleScope(moduleKey);
  return `new Proxy({}, { get: (_, p) => typeof p === "string" ? "${scope.base}_" + String(p).replace(/[^\\w-]/g, "_") + "__${scope.hash}" : "" })`;
}

type NamedImportBinding = { imported: string; local: string };

function parseNamedImportBindings(namedClause: string): NamedImportBinding[] {
  const bindings: NamedImportBinding[] = [];

  for (const rawPart of splitNamedImportBindings(namedClause)) {
    const part = rawPart.trim();
    if (!part) continue;

    const aliasMatch = part.match(
      /^(?:([_$a-zA-Z][\w$-]*)|("(?:[^"\\]|\\.)*"))\s+as\s+([_$a-zA-Z][\w$]*)$/,
    );
    if (aliasMatch) {
      const imported = aliasMatch[1] ?? parseQuotedExportName(aliasMatch[2]);
      const local = aliasMatch[3];
      if (!imported || !local) continue;
      bindings.push({ imported, local });
      continue;
    }

    if (/^[_$a-zA-Z][\w$]*$/.test(part)) {
      bindings.push({ imported: part, local: part });
    }
  }

  return bindings;
}

function splitNamedImportBindings(namedClause: string): string[] {
  const bindings: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < namedClause.length; index++) {
    const char = namedClause[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      bindings.push(namedClause.slice(start, index));
      start = index + 1;
    }
  }

  bindings.push(namedClause.slice(start));
  return bindings;
}

function parseQuotedExportName(token: string | undefined): string | undefined {
  if (!token) return undefined;
  try {
    const parsed: unknown = JSON.parse(token);
    return typeof parsed === "string" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cssBindingValue(imported: string, cssModuleKey: string | undefined): string {
  if (imported === "default") {
    return cssModuleKey ? scopedCssModuleProxyExpression(cssModuleKey) : cssModuleProxyExpression();
  }
  const className = cssModuleKey ? toScopedCssModuleClass(cssModuleKey, imported) : imported;
  return `"${className}"`;
}

/**
 * A namespace-shaped stub for `export * as styles from "./X.module.css"`.
 *
 * A namespace re-export binds the whole module namespace, not its default
 * export, so importers reach the class map through `styles.default.container`
 * as well as `styles.container`. Exporting the bare default proxy answers
 * `styles.default` with a synthesized class string and breaks the first form,
 * so the stub keeps both: `default` yields the proxy, every other key yields
 * the class name the proxy would have produced.
 */
function cssNamespaceExpression(cssModuleKey: string | undefined): string {
  const defaultExpr = cssBindingValue("default", cssModuleKey);
  return `(() => { const d = ${defaultExpr}; return new Proxy({}, { get: (_, p) => p === "default" ? d : d[p] }); })()`;
}

const CSS_EXPORT_LOCAL_PREFIX = "__vfCssExport_";

/**
 * A `__vfCssExport_` prefix that no text in `code` already contains.
 *
 * The generated locals share the module scope with the module's own bindings,
 * so a source that already declares `__vfCssExport_styles` would be redeclared
 * by a fixed prefix and stop parsing. `$` is a valid identifier character, so
 * lengthening the prefix until it appears nowhere in the source makes every
 * derived name unique against the module rather than merely against its
 * siblings.
 */
function cssExportLocalPrefix(code: string): string {
  let prefix = CSS_EXPORT_LOCAL_PREFIX;
  while (code.includes(prefix)) prefix += "$";
  return prefix;
}

/**
 * Export `value` under `exportName` without declaring `exportName` locally.
 *
 * A re-export never introduces a local binding, so the stub must not either:
 * `const styles = fallback; export { default as styles } from "./x.module.css"`
 * is a valid module, and emitting `export const styles` would redeclare it.
 * Reserved words such as `class` are legal export names but illegal `const`
 * names, so the same indirection keeps those parseable as well. Export names
 * are unique per module, and `localPrefix` is unique against the module's own
 * source, so the derived local name collides with nothing.
 */
function exportBindingStatement(
  localPrefix: string,
  exportName: string,
  value: string,
): string {
  if (exportName === "default") return `export default ${value};`;
  const localName = `${localPrefix}${exportName}`;
  return `const ${localName} = ${value}; export { ${localName} as ${exportName} };`;
}

/**
 * Index of the `from` keyword that introduces the module specifier.
 *
 * esbuild minifies this code immediately before this stage whenever `dev` is
 * false, so production statements arrive without spaces around the keyword
 * (`export{default as styles}from"./x.module.css"`). Matching the literal
 * `" from "` misses every one of those, strips the statement to a bare comment
 * and leaves the module's own `export {...}` clause referencing bindings that
 * no longer exist, which fails to link. The keyword is therefore matched on its
 * identifier boundary. The first match is the module-introducing keyword; a
 * later match may be text inside the quoted CSS specifier.
 */
function findFromKeywordIndex(statement: string): number {
  return statement.match(/\bfrom\s*['"`]/)?.index ?? -1;
}

/**
 * Generate a replacement for a CSS re-export statement.
 *
 * SSR modules are linked as real ES modules, so a re-export that is stripped
 * to a comment silently drops the binding and every importer of it fails to
 * link. Enumerable clauses therefore keep exporting the same names through the
 * stubs the import path already uses. `export * from` carries no static names,
 * so it stays stripped.
 */
function generateCSSReExportStub(
  trimmed: string,
  specifier: string,
  localPrefix: string,
): string {
  const stripped = `/* css re-export stripped: ${specifier} */`;
  const fromIndex = findFromKeywordIndex(trimmed);
  if (fromIndex === -1) return stripped;

  const cssModuleKey = isCssModuleImport(specifier) ? specifier : undefined;
  const clause = trimmed.slice("export".length, fromIndex).trim();

  // Namespace re-export: export * as styles from "./X.module.css"
  const nsMatch = clause.match(/^\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (nsMatch?.[1]) {
    return `${
      exportBindingStatement(localPrefix, nsMatch[1], cssNamespaceExpression(cssModuleKey))
    } /* css re-export: ${specifier} */`;
  }

  // Named re-export: export { default as styles, container as c } from "./X.module.css"
  const namedMatch = clause.match(/^\{([^}]*)\}$/);
  if (!namedMatch?.[1]) return stripped;

  const bindings = parseNamedImportBindings(namedMatch[1]);
  if (bindings.length === 0) return stripped;

  const statements = bindings.map((binding) =>
    exportBindingStatement(
      localPrefix,
      binding.local,
      cssBindingValue(binding.imported, cssModuleKey),
    )
  );

  return `${statements.join(" ")} /* css re-export: ${specifier} */`;
}

/**
 * Generate a replacement for a static CSS import statement.
 *
 * - Side-effect import: `import "./globals.css"` → comment
 * - Default import: `import styles from "./X.module.css"` → Proxy stub
 * - Named imports: `import { a } from "./X.css"` → null stubs
 */
function generateCSSStub(statement: string, specifier: string, localPrefix: string): string {
  const trimmed = statement.trim();

  // Re-export from CSS: export { default as styles } from './module.css'
  // Minified output drops the space: `export{default as styles}from"..."`.
  if (/^export(?![\w$])/.test(trimmed)) {
    return generateCSSReExportStub(trimmed, specifier, localPrefix);
  }

  // Side-effect import: import "./globals.css"
  if (/^import\s*['"`]/.test(trimmed)) {
    return `/* css import: ${specifier} */`;
  }

  const fromIndex = findFromKeywordIndex(trimmed);
  if (fromIndex === -1) {
    return `/* css import: ${specifier} */`;
  }

  const cssModuleKey = isCssModuleImport(specifier) ? specifier : undefined;
  const importClause = trimmed.slice(6, fromIndex).trim(); // Skip "import "

  // Default import: import styles from "./Button.module.css"
  // → const styles = new Proxy({}, { get: (_, p) => String(p) })
  // This makes styles.container return "container" (identity mapping)
  if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(importClause)) {
    const expr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return `const ${importClause} = ${expr}; /* css module: ${specifier} */`;
  }

  // Namespace import: import * as styles from "./X.module.css"
  // esbuild lowers `export * as styles from "./X.module.css"` to this form, so
  // the stub must carry the same namespace shape the re-export promises.
  const nsMatch = importClause.match(/^\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (nsMatch) {
    return `const ${nsMatch[1]} = ${
      cssNamespaceExpression(cssModuleKey)
    }; /* css module: ${specifier} */`;
  }

  // Named imports: import { container, header } from "./X.module.css"
  // `default` is a legal named import, and esbuild lowers every CSS re-export
  // to this form, so it must resolve to the class-map proxy rather than to the
  // literal class name `"default"`.
  const namedMatch = importClause.match(/^\{([^}]+)\}$/);
  if (namedMatch?.[1]) {
    const bindings = parseNamedImportBindings(namedMatch[1]);
    if (bindings.length > 0) {
      const stubs = bindings
        .map((binding) => `${binding.local} = ${cssBindingValue(binding.imported, cssModuleKey)}`)
        .join(", ");
      return `const ${stubs}; /* css module: ${specifier} */`;
    }
  }

  // Mixed: import styles, { container } from "./X.module.css"
  const mixedMatch = importClause.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*\{([^}]+)\}$/);
  if (mixedMatch?.[1] && mixedMatch[2]) {
    const defaultName = mixedMatch[1];
    const bindings = parseNamedImportBindings(mixedMatch[2]);
    const namedStubs = bindings
      .map((binding) => `${binding.local} = ${cssBindingValue(binding.imported, cssModuleKey)}`)
      .join(", ");
    const defaultExpr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return namedStubs.length > 0
      ? `const ${defaultName} = ${defaultExpr}, ${namedStubs}; /* css module: ${specifier} */`
      : `const ${defaultName} = ${defaultExpr}; /* css module: ${specifier} */`;
  }

  return `/* css import: ${specifier} */`;
}

/**
 * Generate a replacement for dynamic CSS imports.
 * Keeps syntax valid in expression position (e.g. await import("./x.css")).
 */
function generateDynamicCSSStub(specifier: string): string {
  if (isCssModuleImport(specifier)) {
    return `Promise.resolve({ default: ${
      scopedCssModuleProxyExpression(specifier)
    } }) /* css import: ${specifier} */`;
  }

  return `Promise.resolve({}) /* css import: ${specifier} */`;
}

export const cssStripPlugin: TransformPlugin = {
  name: "css-strip",
  stage: TransformStage.COMPILE + 0.5, // Run after esbuild compile, before import resolution

  async transform(ctx) {
    const imports = await parseImports(ctx.code);

    const hasCssImports = imports.some((imp) => isCSSImport(imp.n));
    if (!hasCssImports) return ctx.code;

    const cssSpecifiers: string[] = [];
    const localPrefix = cssExportLocalPrefix(ctx.code);

    const result = await rewriteImports(ctx.code, (imp, statement) => {
      if (!isCSSImport(imp.n)) return null;
      cssSpecifiers.push(imp.n!);
      const moduleKey = isCssModuleImport(imp.n)
        ? resolveCssModuleKey(imp.n!, ctx.filePath, ctx.projectDir)
        : undefined;
      const specifierForStub = moduleKey ?? imp.n!;
      if (imp.d > -1) return generateDynamicCSSStub(specifierForStub);
      return generateCSSStub(statement, specifierForStub, localPrefix);
    });

    if (cssSpecifiers.length > 0) {
      ctx.metadata.set("cssImports", cssSpecifiers);
    }

    return result;
  },
};
