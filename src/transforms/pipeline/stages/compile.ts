import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";
import { rendererLogger } from "#veryfront/utils";
import { COMPILATION_ERROR } from "#veryfront/errors";
import { getErrorCollector } from "#veryfront/observability";
import { getLoaderFromPath } from "../../esm/transform-utils.ts";
import { type TransformContext, type TransformPlugin, TransformStage } from "../types.ts";
import { basename, isAbsolute, relative, sep } from "#veryfront/compat/path";

const logger = rendererLogger.component("esm-transform");

function safeSourcePath(filePath: string, projectDir: string): string {
  const projectRelative = relative(projectDir, filePath);
  if (
    projectRelative &&
    projectRelative !== ".." &&
    !projectRelative.startsWith(`..${sep}`) &&
    !isAbsolute(projectRelative)
  ) {
    return projectRelative;
  }
  return basename(filePath) || "module";
}

function getCompileDiagnostic(error: unknown): {
  message: string;
  line?: number;
  column?: number;
} {
  const errors = error !== null && typeof error === "object" && "errors" in error
    ? (error as { errors?: unknown }).errors
    : undefined;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (first !== null && typeof first === "object") {
    const diagnostic = first as {
      text?: unknown;
      location?: { line?: unknown; column?: unknown } | null;
    };
    const text = typeof diagnostic.text === "string"
      ? diagnostic.text.replace(/[\r\n\u2028\u2029]+/g, " ").slice(0, 500)
      : "Invalid module syntax";
    return {
      message: text,
      line: typeof diagnostic.location?.line === "number" ? diagnostic.location.line : undefined,
      column: typeof diagnostic.location?.column === "number"
        ? diagnostic.location.column
        : undefined,
    };
  }
  return { message: "Module compilation failed" };
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
        target: "es2020",
        jsx: "automatic",
        jsxImportSource: ctx.jsxImportSource,
        minify: !ctx.dev,
        sourcemap: ctx.dev ? "inline" : false,
        treeShaking: !ctx.dev, // Disable in dev mode to preserve import errors
        keepNames: true,
      });

      let code = result.code;

      const isMdx = ctx.filePath.endsWith(".mdx");
      if (
        isMdx &&
        /\bconst\s+MDXLayout\b/.test(code) &&
        !/export\s+\{[^}]*MDXLayout/.test(code)
      ) {
        code += "\nexport { MDXLayout };\n";
      }

      return code;
    } catch (err) {
      const isMdx = ctx.filePath.endsWith(".mdx");
      const sourcePath = safeSourcePath(ctx.filePath, ctx.projectDir);
      const diagnostic = getCompileDiagnostic(err);

      logger.error("Transform failed", {
        sourcePath,
        loader,
        sourceLength: ctx.code.length,
        isMdx,
        line: diagnostic.line,
        column: diagnostic.column,
      });

      getErrorCollector().addCompileError(
        diagnostic.message,
        sourcePath,
        diagnostic.line,
        diagnostic.column,
        "compilation-error",
      );

      throw COMPILATION_ERROR.create({
        detail:
          `ESM transform failed for ${sourcePath} with loader ${loader}: ${diagnostic.message}`,
      });
    }
  },
};
