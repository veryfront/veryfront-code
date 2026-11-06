// SPIKE inbox#4177 option A (throwaway): let esbuild bundle a route's CommonJS
// user dependencies instead of leaving them external for the runtime loader.
//
// - platform "node" gives Node resolution: `exports`/`imports` maps, the
//   `node` + `require` conditions and main fields.
// - Built-ins a CommonJS module `require`s become virtual ESM modules that
//   import the built-in statically and re-export it as `module.exports`, so the
//   output needs no runtime `require` and never calls `node:module`.
// - A boundary plugin keeps every resolved file inside the project root.
// deno-lint-ignore-file no-explicit-any
import { builtinModules } from "node:module";

// Names Node only accepts with the node: prefix; a bare `test` is an npm package.
const PREFIX_ONLY = new Set(["test", "test/reporters", "sqlite", "sea"]);
const BUILTINS = new Set(
  builtinModules.map((name) => name.replace(/^node:/, "")),
);

function builtinName(specifier: string): string | undefined {
  if (specifier.startsWith("node:")) {
    const bare = specifier.slice(5);
    return BUILTINS.has(bare) ? bare : undefined;
  }
  if (PREFIX_ONLY.has(specifier)) return undefined;
  return BUILTINS.has(specifier) ? specifier : undefined;
}

export interface SpikeBundleInput {
  build: (options: any) => Promise<any>;
  projectDir: string;
  routePath: string;
  routeSource: string;
  runtimeShim: string;
  metafile?: boolean;
  /** Bundle a CommonJS entry to an IIFE whose global holds its module.exports. */
  cjsEntry?: boolean;
}

export async function spikeBundleRoute(input: SpikeBundleInput): Promise<string> {
  return (await spikeBundleRouteResult(input)).code;
}

export async function spikeBundleRouteResult(
  input: SpikeBundleInput,
): Promise<{ code: string; metafile?: unknown }> {
  const { build, projectDir, routePath, routeSource, runtimeShim } = input;
  const requiredBuiltins = new Set<string>();
  const realProject = Deno.realPathSync(projectDir);
  const projectPrefix = realProject.endsWith("/") ? realProject : `${realProject}/`;
  // esbuild walks node_modules up from resolveDir only when that directory exists.
  await Deno.mkdir(routePath.slice(0, routePath.lastIndexOf("/")), { recursive: true });
  const result = await build({
    bundle: true,
    write: false,
    format: input.cjsEntry ? "iife" : "esm",
    ...(input.cjsEntry ? { globalName: "__vf_spike_out" } : {}),
    platform: "node",
    target: "es2022",
    metafile: input.metafile ?? false,
    inject: input.cjsEntry ? [] : ["veryfront:route-runtime-shim"],
    // platform "node" already applies the node condition, and esbuild adds
    // import or require by the kind of each import.
    stdin: {
      contents: routeSource,
      loader: input.cjsEntry ? "js" : "ts",
      resolveDir: routePath.slice(0, routePath.lastIndexOf("/")),
      sourcefile: Deno.env.get("SPIKE_MTS") ? routePath.replace(/\.ts$/, ".mts") : routePath,
    },
    logLevel: "silent",
    plugins: [{
      name: "vf-spike-route",
      setup(b: any) {
        b.onResolve({ filter: /^veryfront:route-runtime-shim$/ }, () => ({
          path: "veryfront:route-runtime-shim",
          namespace: "vf-spike-shim",
        }));
        b.onLoad({ filter: /.*/, namespace: "vf-spike-shim" }, () => ({
          contents: runtimeShim,
          loader: "js",
        }));

        // Built-ins: an import stays an external ESM import of node:<name>;
        // a require() stays external and is recorded, so the output can bind
        // `require` to statically imported built-ins (no node:module at runtime).
        b.onResolve({ filter: /.*/ }, (args: any) => {
          const name = builtinName(args.path);
          if (name === undefined) return undefined;
          if (args.kind === "require-call" || args.kind === "require-resolve") {
            requiredBuiltins.add(args.path);
            return { path: args.path, external: true };
          }
          return { path: `node:${name}`, external: true };
        });

        // Project boundary: every file esbuild resolves must stay in the project.
        b.onLoad({ filter: /.*/, namespace: "file" }, (args: any) => {
          let real = args.path;
          try {
            real = Deno.realPathSync(args.path);
          } catch {
            // esbuild reports the unreadable file itself.
          }
          if (!real.startsWith(projectPrefix)) {
            throw new Error("module path escapes the project");
          }
          return undefined;
        });
      },
    }],
  });
  const code = result.outputFiles?.[0]?.text ?? "";
  if (input.cjsEntry) return { code, metafile: result.metafile };
  // Keep a hashbang first: it is only valid as the first line.
  const hashbang = code.startsWith("#!") ? code.slice(0, code.indexOf("\n") + 1) : "";
  return {
    code: hashbang + builtinRequirePrologue([...requiredBuiltins]) + code.slice(hashbang.length),
    metafile: result.metafile,
  };
}

/**
 * Bind `require` for bundled CommonJS to the built-ins it names. esbuild keeps
 * `require("path")` for an external and reads the free `require` binding.
 */
function builtinRequirePrologue(ids: string[]): string {

  const imports = ids.map((id, index) =>
    `import * as __vf_spike_b${index} from ${JSON.stringify(`node:${id.replace(/^node:/, "")}`)};`
  );
  return [
    ...imports,
    `const __vf_spike_builtins = { __proto__: null, ${ids.map((id, index) => `${JSON.stringify(id)}: __vf_spike_b${index}.default ?? __vf_spike_b${index}`).join(", ")} };`,
    "const require = (id) => {",
    "  if (typeof id === 'string' && Object.hasOwn(__vf_spike_builtins, id)) return __vf_spike_builtins[id];",
    "  const error = new Error(`Cannot find module '${id}'`);",
    '  error.code = "MODULE_NOT_FOUND";',
    "  throw error;",
    "};",
    "",
  ].join("\n");
}

/** Smoke wiring for loader.ts: keep built-in `require` calls external and record them. */
export function spikeBuiltinRequirePlugin(required: Set<string>): any {
  return {
    name: "vf-spike-builtin-require",
    setup(b: any) {
      b.onResolve({ filter: /.*/ }, (args: any) => {
        const name = builtinName(args.path);
        if (name === undefined) return undefined;
        if (args.kind === "require-call" || args.kind === "require-resolve") {
          required.add(args.path);
          return { path: args.path, external: true };
        }
        return { path: `node:${name}`, external: true };
      });
    },
  };
}

export function spikePrependBuiltinRequire(code: string, required: Set<string>): string {
  const hashbang = code.startsWith("#!") ? code.slice(0, code.indexOf("\n") + 1) : "";
  return hashbang + builtinRequirePrologue([...required]) + code.slice(hashbang.length);
}

export function spikeOptionAEnabled(): boolean {
  return Deno.env.get("VF_SPIKE_4177") === "A";
}
