/**
 * esbuild-backed implementation of the {@link Bundler} contract.
 *
 * Lazy-initializes the esbuild binary (including `deno compile` VFS
 * extraction) on first use. All options pass through to esbuild unchanged
 * because the {@link BundleOptions} shape was designed to be esbuild-compatible;
 * the only translation is converting {@link BundlerPlugin}s into esbuild
 * plugins via {@link toEsbuildPlugin}.
 *
 * @module extensions/ext-esbuild/esbuild-bundler
 */

import type {
  BuildContext,
  BundleOptions,
  BundleOutput,
  Bundler,
  BundleResult,
  BundlerMessage,
  Metafile,
  TransformOptions,
  TransformResult,
} from "veryfront/extensions/interfaces";

import { ensureEsbuildBinary } from "./binary.ts";
import { toEsbuildPlugin } from "./plugin-adapter.ts";

// deno-lint-ignore no-explicit-any
type EsbuildModule = any;

let esbuildModule: EsbuildModule | null = null;

async function getEsbuild(): Promise<EsbuildModule> {
  await ensureEsbuildBinary();
  if (esbuildModule) return esbuildModule;
  esbuildModule = await import("esbuild");
  return esbuildModule;
}

// deno-lint-ignore no-explicit-any
function toMessage(m: any): BundlerMessage {
  return {
    text: m.text,
    location: m.location ?? null,
    notes: m.notes,
    pluginName: m.pluginName,
    detail: m.detail,
  };
}

// deno-lint-ignore no-explicit-any
function toMessages(ms: any[] | undefined): BundlerMessage[] {
  return (ms ?? []).map(toMessage);
}

// deno-lint-ignore no-explicit-any
function toOutput(f: any): BundleOutput {
  return {
    path: f.path,
    contents: f.contents,
    text: f.text,
    hash: f.hash,
  };
}

function mapOptions(options: BundleOptions): Record<string, unknown> {
  const { plugins, ...rest } = options;
  const mapped: Record<string, unknown> = { ...rest };
  if (plugins && plugins.length > 0) {
    mapped.plugins = plugins.map(toEsbuildPlugin);
  }
  return mapped;
}

/** esbuild-backed {@link Bundler} implementation. */
export class EsbuildBundler implements Bundler {
  async bundle(options: BundleOptions): Promise<BundleResult> {
    const esbuild = await getEsbuild();
    const result = await esbuild.build(mapOptions(options));
    return {
      outputFiles: (result.outputFiles ?? []).map(toOutput),
      warnings: toMessages(result.warnings),
      errors: toMessages(result.errors),
      metafile: result.metafile as Metafile | undefined,
    };
  }

  async transform(options: TransformOptions): Promise<TransformResult> {
    const esbuild = await getEsbuild();
    const { code, ...rest } = options;
    const result = await esbuild.transform(code, rest);
    return {
      code: result.code,
      map: result.map,
      warnings: toMessages(result.warnings).map((m) => m.text),
    };
  }

  async context(options: BundleOptions): Promise<BuildContext> {
    const esbuild = await getEsbuild();
    const ctx = await esbuild.context(mapOptions(options));
    return {
      rebuild: async () => {
        const result = await ctx.rebuild();
        return {
          outputFiles: (result.outputFiles ?? []).map(toOutput),
          warnings: toMessages(result.warnings),
          errors: toMessages(result.errors),
          metafile: result.metafile as Metafile | undefined,
        };
      },
      dispose: () => ctx.dispose(),
    };
  }

  async stop(): Promise<void> {
    const m = esbuildModule;
    if (!m) return;
    esbuildModule = null;
    await m.stop();
  }
}
