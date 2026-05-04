/**
 * Plugin adapter — converts {@link BundlerPlugin} (the bundler-agnostic
 * contract shape) into an esbuild `Plugin`. The contract's onResolve /
 * onLoad shapes were deliberately designed to match esbuild's, so the
 * translation is near-1:1; this module exists to isolate the esbuild
 * import from the rest of the extension.
 *
 * @module extensions/ext-esbuild/plugin-adapter
 */

import type {
  BundlerPlugin,
  BundlerPluginBuild,
  OnLoadArgs,
  OnLoadResult,
  OnResolveArgs,
  OnResolveResult,
} from "veryfront/extensions/interfaces";
// deno-lint-ignore no-explicit-any
type EsbuildPlugin = any;

export function toEsbuildPlugin(plugin: BundlerPlugin): EsbuildPlugin {
  return {
    name: plugin.name,
    // deno-lint-ignore no-explicit-any
    setup(build: any) {
      const bridged: BundlerPluginBuild = {
        onResolve(options, callback) {
          // deno-lint-ignore no-explicit-any
          build.onResolve(options, async (args: any) => {
            const resolveArgs: OnResolveArgs = {
              path: args.path,
              importer: args.importer,
              namespace: args.namespace,
              resolveDir: args.resolveDir,
              kind: args.kind,
              pluginData: args.pluginData,
            };
            const result = await callback(resolveArgs);
            if (result == null) return result ?? null;
            return result as OnResolveResult;
          });
        },
        onLoad(options, callback) {
          // deno-lint-ignore no-explicit-any
          build.onLoad(options, async (args: any) => {
            const loadArgs: OnLoadArgs = {
              path: args.path,
              namespace: args.namespace,
              suffix: args.suffix,
              pluginData: args.pluginData,
            };
            const result = await callback(loadArgs);
            if (result == null) return result ?? null;
            return result as OnLoadResult;
          });
        },
        onDispose(callback) {
          build.onDispose(callback);
        },
      };

      plugin.setup(bridged);
    },
  };
}
