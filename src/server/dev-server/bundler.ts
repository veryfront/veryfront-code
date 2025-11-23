import { serverLogger as logger } from "@veryfront/utils";
import type { Plugin } from "esbuild";
import { dirname, join, resolve as pathResolve } from "std/path/mod.ts";
import type { ShellAdapter } from "@veryfront/platform/adapters/base.ts";

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
    const hasTypeScript = /:\s*\w+|interface\s+|type\s+|<\w|Props>/.test(content) ||
      filePath.endsWith(".ts") ||
      filePath.endsWith(".tsx");

    if (hasTypeScript) {
      return filePath.endsWith(".tsx") ? "tsx" : "ts";
    }
    return filePath.endsWith(".jsx") ? "jsx" : "js";
  }
}

function createRelativeFsPlugin(projectDir: string, shell: ShellAdapter): Plugin {
  return {
    name: "vf-rel-fs",
    setup(build) {
      const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs"];
      build.onResolve({ filter: /.*/ }, (args) => {
        const isRel = args.path.startsWith(".") || args.path.startsWith("/");
        if (!isRel) return undefined;
        const basedir = args.importer ? dirname(args.importer) : projectDir;
        const candidate = args.path.startsWith("/")
          ? pathResolve(args.path)
          : pathResolve(join(basedir, args.path));
        const candidates: string[] = [candidate];
        for (const ext of exts) candidates.push(candidate + ext);
        for (const ext of exts) candidates.push(join(candidate, `index${ext}`));
        for (const file of candidates) {
          try {
            const stat = shell.statSync(file);
            if (stat.isFile) return { path: file };
          } catch {
            // File doesn't exist, try next candidate
          }
        }
        return undefined;
      });
      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, (args) => {
        try {
          const contents = shell.readFileSync(args.path);
          const loader = args.path.endsWith(".tsx")
            ? "tsx"
            : args.path.endsWith(".ts")
            ? "ts"
            : args.path.endsWith(".jsx")
            ? "jsx"
            : "js";
          return { contents, loader } as const;
        } catch (error) {
          logger.debug("[DevBundler] Failed to read file contents", { path: args.path, error });
          return { contents: "", loader: "js" as const };
        }
      });
    },
  };
}

function createBareExternalPlugin(): Plugin {
  return {
    name: "vf-bare-ext",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const isBare = !args.path.startsWith(".") &&
          !args.path.startsWith("/") &&
          !args.path.startsWith("http://") &&
          !args.path.startsWith("https://");
        if (!isBare) return undefined;
        if (args.kind === "import-statement" || args.kind === "dynamic-import") {
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  };
}
