import { computeContentHash } from "../esm/transform-utils.ts";
import { REACT_VERSION } from "../esm/package-registry.ts";
import type {
  TransformContext,
  TransformOptions,
  TransformStage,
  TransformTarget,
} from "./types.ts";

/**
 * Detect React version from project's package.json.
 * Falls back to default REACT_VERSION if not found.
 */
async function detectProjectReactVersion(projectDir: string): Promise<string> {
  try {
    const packageJsonPath = `${projectDir}/package.json`;
    const content = await Deno.readTextFile(packageJsonPath);
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const reactVersion = deps?.react;

    if (reactVersion) {
      // Strip ^ or ~ prefix to get the base version
      return reactVersion.replace(/^[\^~]/, "");
    }
  } catch {
    // Project doesn't have package.json or no React dependency
  }

  return REACT_VERSION;
}

/** Build a TransformContext from source, paths, hash, and options */
function buildContext(
  source: string,
  filePath: string,
  projectDir: string,
  contentHash: string,
  options: TransformOptions,
  reactVersion: string,
): TransformContext {
  const target: TransformTarget = options.ssr ? "ssr" : "browser";

  return {
    code: source,
    originalSource: source,
    filePath,
    projectDir,
    projectId: options.projectId,
    target,
    dev: options.dev ?? true,
    contentHash,
    moduleServerUrl: options.moduleServerUrl,
    vendorBundleHash: options.vendorBundleHash,
    apiBaseUrl: options.apiBaseUrl,
    jsxImportSource: options.jsxImportSource ?? "react",
    timing: new Map(),
    debug: false,
    metadata: new Map(),
    studioEmbed: options.studioEmbed,
    reactVersion,
  };
}

export async function createTransformContext(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
): Promise<TransformContext> {
  const contentHash = await computeContentHash(source);
  // Use provided reactVersion or detect from project's package.json
  const reactVersion = options.reactVersion ?? await detectProjectReactVersion(projectDir);
  return buildContext(source, filePath, projectDir, contentHash, options, reactVersion);
}

export function createTransformContextSync(
  source: string,
  filePath: string,
  projectDir: string,
  contentHash: string,
  options: TransformOptions,
): TransformContext {
  // Sync version can't detect from package.json, use provided version or default
  const reactVersion = options.reactVersion ?? REACT_VERSION;
  return buildContext(source, filePath, projectDir, contentHash, options, reactVersion);
}

export function recordStageTiming(
  ctx: TransformContext,
  stage: TransformStage,
  startTime: number,
): void {
  ctx.timing.set(stage, performance.now() - startTime);
}

export function getTotalTiming(ctx: TransformContext): number {
  return [...ctx.timing.values()].reduce((sum, ms) => sum + ms, 0);
}

export function formatTimingLog(ctx: TransformContext): Record<string, string> {
  const stageNames = [
    "parse",
    "compile",
    "aliases",
    "react",
    "context",
    "relative",
    "bare",
    "finalize",
  ];

  const result: Record<string, string> = {
    file: ctx.filePath.slice(-40),
    target: ctx.target,
  };

  for (const [stage, ms] of ctx.timing) {
    const name = stageNames[stage] ?? `stage${stage}`;
    result[`${name}Ms`] = ms.toFixed(1);
  }

  result.totalMs = getTotalTiming(ctx).toFixed(1);
  return result;
}

export function isSSR(ctx: TransformContext): boolean {
  return ctx.target === "ssr";
}

export function isBrowser(ctx: TransformContext): boolean {
  return ctx.target === "browser";
}

export function isMDX(ctx: TransformContext): boolean {
  // MDX is a superset of Markdown - treat both .mdx and .md files as MDX
  // This allows .md files to use frontmatter (layout, etc.) and component imports
  return ctx.filePath.endsWith(".mdx") || ctx.filePath.endsWith(".md");
}

export function isTypeScript(ctx: TransformContext): boolean {
  return ctx.filePath.endsWith(".ts") || ctx.filePath.endsWith(".tsx");
}

export function getExtension(ctx: TransformContext): string {
  const dot = ctx.filePath.lastIndexOf(".");
  return dot >= 0 ? ctx.filePath.slice(dot) : "";
}
