import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { rendererLogger } from "#veryfront/utils";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { getErrorCollector } from "#veryfront/observability";
import { upgradeImportAssertions } from "../../esm/import-attributes.ts";
import { ESBUILD_SUPPORTED_FEATURES, getLoaderFromPath } from "../../esm/transform-utils.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";

const logger = rendererLogger.component("esm-transform");
const ESBUILD_SOURCE_DIAGNOSTIC = Symbol.for(
  "veryfront.bundler.esbuild-source-diagnostic",
);
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const SOURCE_MAP_SUFFIX =
  /(^|\r?\n)[\t ]*\/\/[#@][\t ]*sourceMappingURL=[^"'`\s]+[\t ]*(?:\r?\n)?$/;
export const COMPILE_SOURCE_MAP_DIRECTIVE_METADATA = "compileSourceMapDirective";

function trailingSourceMapDirective(code: string): string | undefined {
  const match = SOURCE_MAP_SUFFIX.exec(code);
  return match?.[0].slice((match[1] ?? "").length).trimEnd();
}

function dropTrailingSourceMapDirective(code: string): string {
  return code.replace(SOURCE_MAP_SUFFIX, "$1");
}

function appendBeforeSourceMap(code: string, addition: string): string {
  const match = SOURCE_MAP_SUFFIX.exec(code);
  if (match?.index === undefined) return code + addition;
  return code.slice(0, match.index) + addition + match[0].slice((match[1] ?? "").length);
}

function readOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  try {
    const descriptor = ReflectGetOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true
    ) {
      return descriptor.value;
    }
  } catch {
    // A hostile proxy cannot provide trusted source-diagnostic evidence.
  }
  return undefined;
}

function isEsbuildSourceDiagnostic(error: unknown): boolean {
  return readOwnDataProperty(error, ESBUILD_SOURCE_DIAGNOSTIC) === true;
}

/**
 * `.mdx` and `.md` reach this stage as *generated* JSX: PARSE has already run
 * the MDX compiler over the tenant's source, so `ctx.code` here is framework
 * output. A diagnostic with a location points into that generated code, not
 * into anything the project wrote, so it must not claim tenant ownership — a
 * remark/rehype/recma plugin emitting broken JSX is a framework fault that has
 * to page someone.
 *
 * Nothing is lost by refusing to infer ownership for these two extensions:
 * genuine MDX and Markdown *source* errors are classified upstream at PARSE as
 * `mdx-compile-error` / `markdown-compile-error`, both of which the shared
 * tenant classifier already recognizes.
 */
function isGeneratedContentOutput(filePath: string): boolean {
  return filePath.endsWith(".mdx") || filePath.endsWith(".md");
}

export const compilePlugin: TransformPlugin = {
  name: "esbuild-compile",
  stage: TransformStage.COMPILE,

  async transform(ctx: TransformContext): Promise<string> {
    const loader = getLoaderFromPath(ctx.filePath);
    const esbuild = await getEsbuild();

    try {
      const result = await esbuild.transform(ctx.code, {
        loader,
        format: "esm",
        target: "es2022",
        supported: ESBUILD_SUPPORTED_FEATURES,
        jsx: "automatic",
        jsxImportSource: ctx.jsxImportSource,
        minify: !ctx.dev,
        sourcemap: ctx.dev ? "inline" : false,
        treeShaking: !ctx.dev, // Disable in dev mode to preserve import errors
        keepNames: true,
      });

      // Upgrade the withdrawn `assert` spelling of an import attribute clause
      // to `with`. esbuild is the parser here: it has already resolved JSX and
      // TypeScript, so the output is plain JavaScript the module lexer can
      // anchor to. CSS output is not a module and is left alone.
      let code = loader === "css" ? result.code : await upgradeImportAssertions(result.code);
      const isMdx = ctx.filePath.endsWith(".mdx");
      if (
        isMdx &&
        /\bconst\s+MDXLayout\b/.test(code) &&
        !/export\s+\{[^}]*MDXLayout/.test(code)
      ) {
        // Keep esbuild's directive last. Browser server-hook stripping removes
        // a stale compile map after rewriting, and a framework export appended
        // after the directive would otherwise hide that suffix.
        code = appendBeforeSourceMap(code, "\nexport { MDXLayout };\n");
      }

      const sourceMapDirective = trailingSourceMapDirective(code);
      if (ctx.target === "browser" && sourceMapDirective) {
        // Keep the compiler map out of intermediate browser plugins. The
        // server-export strip stage restores it only when no hook is rewritten.
        // This makes the real comment unambiguous even if a plugin copies its
        // text into a string or appends executable code.
        ctx.metadata.set(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA, sourceMapDirective);
        code = dropTrailingSourceMapDirective(code);
      } else {
        ctx.metadata.delete(COMPILE_SOURCE_MAP_DIRECTIVE_METADATA);
      }

      return code;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isMdx = ctx.filePath.endsWith(".mdx");

      const sourcePreview = ctx.code
        .split("\n")
        .slice(0, 10)
        .map((line, i) => `${String(i + 1).padStart(3, " ")}| ${line}`)
        .join("\n");

      logger.error("Transform failed", {
        filePath: ctx.filePath,
        loader,
        sourceLength: ctx.code.length,
        isMdx,
        error: errorMsg,
      });
      logger.error("Source preview (first 10 lines):\n" + sourcePreview);

      getErrorCollector().addCompileError(errorMsg, ctx.filePath);

      throw COMPILATION_ERROR.create({
        detail: `ESM transform failed for ${ctx.filePath} (loader: ${loader}): ${errorMsg}`,
        cause: err,
        context: {
          tenantBuildFailure: !isGeneratedContentOutput(ctx.filePath) &&
            isEsbuildSourceDiagnostic(err),
        },
      });
    }
  },
};
