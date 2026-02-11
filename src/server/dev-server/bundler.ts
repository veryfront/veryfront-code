import { serverLogger as logger } from "#veryfront/utils";
import type { Plugin } from "esbuild";
import { dirname, join, resolve as pathResolve } from "#veryfront/compat/path/index.ts";
import type { ShellAdapter } from "#veryfront/platform/adapters/base.ts";

const log = logger.component("dev-bundler");

export class Bundler {
  constructor(
    private projectDir: string,
    private shell: ShellAdapter,
  ) {}

  async bundleToJavaScript(
    content: string,
    filePath: string,
    resolveDirectory: string,
  ): Promise<string> {
    try {
      const { build } = await import("esbuild");
      const loader = this.determineFileLoader(content, filePath);

      const result = await build({
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2020",
        jsx: "automatic",
        jsxImportSource: "react",
        external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
        stdin: {
          contents: content,
          loader,
          resolveDir: resolveDirectory,
          sourcefile: filePath,
        },
        plugins: [createRelativeFsPlugin(this.projectDir, this.shell), createBareExternalPlugin()],
      });

      return result.outputFiles?.[0]?.text ?? "export default null";
    } catch (error) {
      logger.warn("Bundle to JavaScript failed", error);
      return "export default null";
    }
  }

  private determineFileLoader(content: string, filePath: string): "tsx" | "ts" | "jsx" | "js" {
    const loader = getLoaderForPath(filePath);
    if (loader !== "js") return loader;

    const hasTypeScript = /:\s*\w+|interface\s+|type\s+|<\w|Props>/.test(content);
    return hasTypeScript ? "ts" : "js";
  }
}

function createRelativeFsPlugin(projectDir: string, shell: ShellAdapter): Plugin {
  return {
    name: "vf-rel-fs",
    setup(build) {
      const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

      build.onResolve({ filter: /.*/ }, (args) => {
        if (!args.path.startsWith(".") && !args.path.startsWith("/")) return;

        const basedir = args.importer ? dirname(args.importer) : projectDir;
        const candidate = args.path.startsWith("/")
          ? pathResolve(args.path)
          : pathResolve(join(basedir, args.path));

        const candidates: string[] = [candidate];
        for (const ext of exts) candidates.push(candidate + ext, join(candidate, `index${ext}`));

        for (const file of candidates) {
          try {
            if (shell.statSync(file).isFile) return { path: file };
          } catch {
            // ignore
          }
        }
      });

      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, (args) => {
        try {
          const contents = shell.readFileSync(args.path);
          return { contents, loader: getLoaderForPath(args.path) };
        } catch (error) {
          log.debug("Failed to read file contents", { path: args.path, error });
          return { contents: "", loader: "js" };
        }
      });
    },
  };
}

function getLoaderForPath(path: string): "tsx" | "ts" | "jsx" | "js" {
  if (path.endsWith(".tsx")) return "tsx";
  if (path.endsWith(".ts")) return "ts";
  if (path.endsWith(".jsx")) return "jsx";
  return "js";
}

function createBareExternalPlugin(): Plugin {
  return {
    name: "vf-bare-ext",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (
          args.path.startsWith(".") ||
          args.path.startsWith("/") ||
          args.path.startsWith("http://") ||
          args.path.startsWith("https://")
        ) {
          return;
        }

        if (args.kind === "import-statement" || args.kind === "dynamic-import") {
          return { path: args.path, external: true };
        }
      });
    },
  };
}
