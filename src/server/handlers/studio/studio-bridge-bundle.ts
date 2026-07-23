import { exists, readTextFile, stat } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl, join } from "#veryfront/compat/path/index.ts";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  MAX_BUNDLE_CHUNK_SIZE_BYTES,
} from "#veryfront/utils/constants/index.ts";
import { isCompiledBinary } from "#veryfront/utils";
import { computeStrongEtag } from "../utils/etag.ts";
import { STUDIO_BRIDGE_BUNDLE } from "#veryfront/studio/bridge/bridge-bundle.generated.ts";

const PROJECT_ROOT = fromFileUrl(new URL("../../../../", import.meta.url));
const BRIDGE_DIRECTORY = fromFileUrl(new URL("../../../studio/bridge/", import.meta.url));
const BRIDGE_ENTRY_POINT = join(BRIDGE_DIRECTORY, "bridge-coordinator.ts");
const textEncoder = new TextEncoder();

export type StudioBridgeBundleMode = "prebuilt" | "source";

export interface StudioBridgeBundleDependencies {
  prebuiltBundle: string;
  readCoordinator: () => Promise<string>;
  buildSource: (source: string) => Promise<string>;
}

export interface StudioBridgeLoaderDependencies extends StudioBridgeBundleDependencies {
  isCompiled: () => boolean;
  sourceAvailable: () => Promise<boolean>;
  computeEtag: (source: string) => Promise<string>;
}

export interface StudioBridgeBundle {
  js: string;
  etag: string;
}

function exceedsUtf8Limit(value: string, limit: number): boolean {
  return value.length > limit || textEncoder.encode(value).byteLength > limit;
}

function assertSourceSize(source: string): void {
  if (exceedsUtf8Limit(source, DEFAULT_MAX_BODY_SIZE_BYTES)) {
    throw new Error("Studio bridge source exceeds the size limit");
  }
}

function assertBundleSize(bundle: string): void {
  if (exceedsUtf8Limit(bundle, MAX_BUNDLE_CHUNK_SIZE_BYTES)) {
    throw new Error("Studio bridge bundle exceeds the size limit");
  }
}

export async function resolveStudioBridgeBundle(
  mode: StudioBridgeBundleMode,
  dependencies: StudioBridgeBundleDependencies,
): Promise<string> {
  if (mode === "prebuilt") {
    if (!dependencies.prebuiltBundle) {
      throw new Error("The prebuilt Studio bridge bundle is unavailable");
    }
    assertBundleSize(dependencies.prebuiltBundle);
    return dependencies.prebuiltBundle;
  }

  const source = await dependencies.readCoordinator();
  assertSourceSize(source);
  const bundle = await dependencies.buildSource(source);
  if (!bundle) throw new Error("The Studio bridge bundler produced no JavaScript");
  assertBundleSize(bundle);
  return bundle;
}

export function selectStudioBridgeBundleMode(options: {
  compiled: boolean;
  sourceAvailable: boolean;
  localDevelopment: boolean;
}): StudioBridgeBundleMode {
  return options.localDevelopment && !options.compiled && options.sourceAvailable
    ? "source"
    : "prebuilt";
}

export class StudioBridgeBundleLoader {
  #prebuiltCache: StudioBridgeBundle | null = null;
  #prebuiltInFlight: Promise<StudioBridgeBundle> | null = null;
  #sourceInFlight: Promise<StudioBridgeBundle> | null = null;

  constructor(private readonly dependencies: StudioBridgeLoaderDependencies) {}

  async load(localDevelopment: boolean): Promise<StudioBridgeBundle> {
    const compiled = this.dependencies.isCompiled();
    const sourceAvailable = localDevelopment && !compiled
      ? await this.dependencies.sourceAvailable()
      : false;
    const mode = selectStudioBridgeBundleMode({ compiled, sourceAvailable, localDevelopment });

    if (mode === "prebuilt" && this.#prebuiltCache) return this.#prebuiltCache;
    const active = mode === "prebuilt" ? this.#prebuiltInFlight : this.#sourceInFlight;
    if (active) return await active;

    const pending = this.#build(mode);
    if (mode === "prebuilt") this.#prebuiltInFlight = pending;
    else this.#sourceInFlight = pending;

    try {
      const bundle = await pending;
      if (mode === "prebuilt") this.#prebuiltCache = bundle;
      return bundle;
    } finally {
      if (mode === "prebuilt" && this.#prebuiltInFlight === pending) {
        this.#prebuiltInFlight = null;
      }
      if (mode === "source" && this.#sourceInFlight === pending) {
        this.#sourceInFlight = null;
      }
    }
  }

  async #build(mode: StudioBridgeBundleMode): Promise<StudioBridgeBundle> {
    const js = await resolveStudioBridgeBundle(mode, this.dependencies);
    return { js, etag: await this.dependencies.computeEtag(js) };
  }
}

async function readBridgeCoordinator(): Promise<string> {
  const metadata = await stat(BRIDGE_ENTRY_POINT);
  if (
    !metadata.isFile ||
    !Number.isSafeInteger(metadata.size) ||
    metadata.size < 0 ||
    metadata.size > DEFAULT_MAX_BODY_SIZE_BYTES
  ) {
    throw new Error("Studio bridge source exceeds the size limit");
  }
  return await readTextFile(BRIDGE_ENTRY_POINT);
}

async function buildBridgeSource(source: string): Promise<string> {
  const { build } = await import("veryfront/extensions/bundler");
  const result = await build({
    absWorkingDir: PROJECT_ROOT,
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    stdin: {
      contents: source,
      loader: "ts",
      resolveDir: BRIDGE_DIRECTORY,
      sourcefile: BRIDGE_ENTRY_POINT,
    },
  });
  const outputFiles = result.outputFiles ?? [];
  const [output] = outputFiles;
  if (outputFiles.length !== 1 || !output) {
    throw new Error("The Studio bridge bundler produced an invalid output set");
  }
  return output.text;
}

async function computeBundleEtag(source: string): Promise<string> {
  const etag = await computeStrongEtag(source);
  return etag.slice(1, -1);
}

const defaultLoader = new StudioBridgeBundleLoader({
  prebuiltBundle: STUDIO_BRIDGE_BUNDLE,
  isCompiled: isCompiledBinary,
  sourceAvailable: () => exists(BRIDGE_ENTRY_POINT),
  readCoordinator: readBridgeCoordinator,
  buildSource: buildBridgeSource,
  computeEtag: computeBundleEtag,
});

export function loadStudioBridgeBundle(localDevelopment: boolean): Promise<StudioBridgeBundle> {
  return defaultLoader.load(localDevelopment);
}
