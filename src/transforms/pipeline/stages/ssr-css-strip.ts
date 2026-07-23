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
 * import is replaced with a Proxy stub that returns the same deterministic
 * scoped class name used when the corresponding stylesheet is rewritten.
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
  return specifier !== undefined && /\.css(?:[?#].*)?$/.test(specifier);
}

function isCssModuleImport(specifier: string | undefined): boolean {
  return specifier !== undefined && /\.module\.css(?:[?#].*)?$/.test(specifier);
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

  for (const rawPart of namedClause.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const aliasMatch = part.match(/^([_$a-zA-Z][\w$-]*)\s+as\s+([_$a-zA-Z][\w$]*)$/);
    if (aliasMatch) {
      const imported = aliasMatch[1];
      const local = aliasMatch[2];
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

/**
 * Generate a replacement for a static CSS import statement.
 *
 * - Side-effect import: `import "./globals.css"` → comment
 * - Default import: `import styles from "./X.module.css"` → Proxy stub
 * - Named imports: `import { a } from "./X.css"` → null stubs
 */
function generateCSSStub(statement: string, specifier: string): string {
  const trimmed = statement.trim();

  // Re-export from CSS: export { default as styles } from './module.css'
  // → strip entirely, the CSS is collected separately
  if (/^export\s/.test(trimmed)) {
    return "/* css re-export stripped */";
  }

  // Side-effect import: import "./globals.css"
  if (/^import\s+['"`]/.test(trimmed)) {
    return "/* css import stripped */";
  }

  const fromIndex = trimmed.lastIndexOf(" from ");
  if (fromIndex === -1) {
    return "/* css import stripped */";
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
    return `const ${importClause} = ${expr}; /* css module */`;
  }

  // Namespace import: import * as styles from "./X.module.css"
  const nsMatch = importClause.match(/^\*\s+as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)$/);
  if (nsMatch) {
    const expr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return `const ${nsMatch[1]} = ${expr}; /* css module */`;
  }

  // Named imports: import { container, header } from "./X.module.css"
  const namedMatch = importClause.match(/^\{([^}]+)\}$/);
  if (namedMatch?.[1]) {
    const bindings = parseNamedImportBindings(namedMatch[1]);
    if (bindings.length > 0) {
      const stubs = bindings
        .map((binding) => {
          const value = cssModuleKey
            ? toScopedCssModuleClass(cssModuleKey, binding.imported)
            : binding.imported;
          return `${binding.local} = "${value}"`;
        })
        .join(", ");
      return `const ${stubs}; /* css module */`;
    }
  }

  // Mixed: import styles, { container } from "./X.module.css"
  const mixedMatch = importClause.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*\{([^}]+)\}$/);
  if (mixedMatch?.[1] && mixedMatch[2]) {
    const defaultName = mixedMatch[1];
    const bindings = parseNamedImportBindings(mixedMatch[2]);
    const namedStubs = bindings
      .map((binding) => {
        const value = cssModuleKey
          ? toScopedCssModuleClass(cssModuleKey, binding.imported)
          : binding.imported;
        return `${binding.local} = "${value}"`;
      })
      .join(", ");
    const defaultExpr = cssModuleKey
      ? scopedCssModuleProxyExpression(cssModuleKey)
      : cssModuleProxyExpression();
    return namedStubs.length > 0
      ? `const ${defaultName} = ${defaultExpr}, ${namedStubs}; /* css module */`
      : `const ${defaultName} = ${defaultExpr}; /* css module */`;
  }

  return "/* css import stripped */";
}

/**
 * Generate a replacement for dynamic CSS imports.
 * Keeps syntax valid in expression position (e.g. await import("./x.css")).
 */
function generateDynamicCSSStub(specifier: string): string {
  if (isCssModuleImport(specifier)) {
    return `Promise.resolve({ default: ${
      scopedCssModuleProxyExpression(specifier)
    } }) /* css import stripped */`;
  }

  return "Promise.resolve({}) /* css import stripped */";
}

export const cssStripPlugin: TransformPlugin = {
  name: "css-strip",
  stage: TransformStage.COMPILE + 0.5, // Run after esbuild compile, before import resolution

  async transform(ctx) {
    const imports = await parseImports(ctx.code);

    const hasCssImports = imports.some((imp) => isCSSImport(imp.n));
    if (!hasCssImports) return ctx.code;

    const cssSpecifiers = new Map<string, number>();

    const result = await rewriteImports(ctx.code, (imp, statement) => {
      if (!isCSSImport(imp.n)) return null;
      const currentStart = cssSpecifiers.get(imp.n!);
      if (currentStart === undefined || imp.ss < currentStart) {
        cssSpecifiers.set(imp.n!, imp.ss);
      }
      const moduleKey = isCssModuleImport(imp.n)
        ? resolveCssModuleKey(imp.n!, ctx.filePath, ctx.projectDir)
        : undefined;
      const specifierForStub = moduleKey ?? imp.n!;
      if (imp.d > -1) return generateDynamicCSSStub(specifierForStub);
      return generateCSSStub(statement, specifierForStub);
    });

    if (cssSpecifiers.size > 0) {
      ctx.metadata.set(
        "cssImports",
        [...cssSpecifiers.entries()]
          .sort((left, right) => left[1] - right[1])
          .map(([specifier]) => specifier),
      );
    }

    return result;
  },
};
