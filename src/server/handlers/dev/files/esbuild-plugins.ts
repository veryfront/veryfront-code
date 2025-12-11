
import type { OnLoadArgs, OnResolveArgs, Plugin, PluginBuild } from "esbuild";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/index.ts";
import { getDirectory, joinPath } from "@veryfront/utils/path-utils.ts";
import {
  getReactCDNUrl,
  getReactDOMCDNUrl,
  getReactDOMClientCDNUrl,
  getReactJSXDevRuntimeCDNUrl,
  getReactJSXRuntimeCDNUrl,
  REACT_DEFAULT_VERSION,
} from "@veryfront/utils/constants/cdn.ts";

export function createRelativeFsPlugin(projectDir: string, adapter: RuntimeAdapter): Plugin {
  return {
    name: "veryfront-rel-fs",
    setup(build: PluginBuild) {
      const exts = [".tsx", ".ts", ".jsx", ".js", ".mjs"];

      build.onResolve({ filter: /^(\.?\.?\/|\/)\ }, async (args: OnResolveArgs) => {
        const basedir = args.importer ? getDirectory(args.importer) : projectDir;
        const candidate = args.path.startsWith("/")
          ? joinPath(projectDir, args.path)
          : joinPath(basedir, args.path);

        const candidates: string[] = [candidate];
        for (const ext of exts) {
          candidates.push(candidate + ext);
        }
        for (const ext of exts) {
          candidates.push(joinPath(candidate, `index${ext}`));
        }

        for (const f of candidates) {
          try {
            const st = await adapter.fs.stat(f);
            if (st.isFile) return { path: f };
          } catch {
          }
        }
        return undefined;
      });

      build.onLoad({ filter: /\.(tsx?|jsx?|mjs)$/ }, async (args: OnLoadArgs) => {
        try {
          const contents = await adapter.fs.readFile(args.path);
          const loader = args.path.endsWith(".tsx")
            ? "tsx"
            : args.path.endsWith(".ts")
            ? "ts"
            : args.path.endsWith(".jsx")
            ? "jsx"
            : "js";
          return { contents, loader };
        } catch (error) {
          return {
            errors: [
              {
                text: `Failed to read ${args.path}: ${String(error)}`,
                location: null,
              },
            ],
          };
        }
      });
    },
  };
}

const ESM_PACKAGE_MAP: Record<string, string> = {
  "react": getReactCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom": getReactDOMCDNUrl(REACT_DEFAULT_VERSION),
  "react-dom/client": getReactDOMClientCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-runtime": getReactJSXRuntimeCDNUrl(REACT_DEFAULT_VERSION),
  "react/jsx-dev-runtime": getReactJSXDevRuntimeCDNUrl(REACT_DEFAULT_VERSION),
};

export function createBareExternalPlugin(bundle = false): Plugin {
  return {
    name: "veryfront-bare-ext",
    setup(build: PluginBuild) {
      build.onResolve({ filter: /.*/ }, (args: OnResolveArgs) => {
        const isBare = !args.path.startsWith(".") &&
          !args.path.startsWith("/") &&
          !args.path.startsWith("http://") &&
          !args.path.startsWith("https://");
        if (!isBare) return undefined;
        if (args.kind === "import-statement" || args.kind === "dynamic-import") {
          const esmUrl = ESM_PACKAGE_MAP[args.path];
          if (esmUrl) {
            if (bundle) {
              return { path: esmUrl, namespace: "https" };
            }
            return { path: esmUrl, external: true };
          }
          const fallbackUrl = `https://esm.sh/${args.path}`;
          if (bundle) {
            return { path: fallbackUrl, namespace: "https" };
          }
          return { path: fallbackUrl, external: true };
        }
        return undefined;
      });

      if (bundle) {
        build.onLoad({ filter: /.*/, namespace: "https" }, async (args: OnLoadArgs) => {
          try {
            const response = await fetch(args.path);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const contents = await response.text();
            return { contents, loader: "js" };
          } catch (error) {
            return {
              errors: [{
                text: `Failed to fetch ${args.path}: ${String(error)}`,
                location: null,
              }],
            };
          }
        });
      }
    },
  };
}
