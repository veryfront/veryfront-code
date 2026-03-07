import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEsbuild } from "#veryfront/platform/compat/esbuild.ts";

interface TransformUiModuleOptions {
  spanName: string;
  importBasePath: string;
}

export function resolveRelativeImport(currentDir: string, importPath: string): string {
  const parts = currentDir ? currentDir.split("/") : [];

  for (const part of importPath.split("/")) {
    if (part === "..") {
      parts.pop();
      continue;
    }
    if (part === ".") continue;
    parts.push(part);
  }

  return parts.join("/");
}

export function transformUiModule(
  filePath: string,
  source: string,
  relativePath: string,
  options: TransformUiModuleOptions,
): Promise<string> {
  const importBasePath = options.importBasePath.replace(/\/+$/, "");

  return withSpan(
    options.spanName,
    async () => {
      const esbuild = await getEsbuild();
      const result = await esbuild.transform(source, {
        loader: filePath.endsWith(".tsx") ? "tsx" : "ts",
        format: "esm",
        target: "es2022",
        jsx: "automatic",
        jsxImportSource: "react",
        sourcemap: false,
        minify: false,
      });

      const currentDir = relativePath.split("/").slice(0, -1).join("/");

      return result.code.replace(
        /from\s+["'](\.\.?\/[^"']+)\.tsx?["']/g,
        (_match, importPath) =>
          `from "${importBasePath}/${resolveRelativeImport(currentDir, importPath)}.js"`,
      );
    },
    { "module.filePath": filePath, "module.relativePath": relativePath },
  );
}
