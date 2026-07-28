import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { BUILD_FAILED } from "#veryfront/errors";
import type { VeryfrontConfig } from "#veryfront/config";
import type { AppRouteInfo, RouteInfo } from "#veryfront/server/build-types.ts";
import type { StaticAssetEntry } from "../asset-generation.ts";
import { getRouteOutputRelativePath } from "../output-paths.ts";

const MAX_OUTPUT_PATH_LENGTH = 4_096;
const RESERVED_OUTPUT_PREFIXES = new Set(["_veryfront", "_vf"]);
const FIXED_OUTPUT_FILES = [
  "_veryfront/app.js",
  "_veryfront/client.js",
  "_veryfront/router.js",
  "_veryfront/prefetch.js",
  "_veryfront/hydration-runtime.js",
  "_veryfront/manifest.json",
  "sw.js",
  "_redirects",
] as const;

interface PlannedFile {
  path: string;
  key: string;
  owner: string;
}

function buildError(detail: string): Error {
  return BUILD_FAILED.create({ detail });
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/").normalize("NFC");
}

function collisionKey(path: string): string {
  return portablePath(path).toLocaleLowerCase("en-US");
}

function isPathInside(candidate: string, base: string): boolean {
  const relativePath = relative(base, candidate);
  return relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function canonicalTargetPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    return await realPath(absolutePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const suffix: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) throw buildError(`Cannot resolve build output path: ${path}`);
    suffix.unshift(basename(current));

    try {
      return resolve(await realPath(parent), ...suffix);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      current = parent;
    }
  }
}

async function rejectUnsupportedExistingOutput(outputDir: string): Promise<void> {
  const fs = createFileSystem();
  if (!fs.lstat) return;

  try {
    const info = await fs.lstat(outputDir);
    if (info.isSymlink) {
      throw buildError(`Build output directory must not be a symbolic link: ${outputDir}`);
    }
    if (!info.isDirectory) {
      throw buildError(`Build output path exists and is not a directory: ${outputDir}`);
    }
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

export async function assertSafeBuildOutputDirectory(
  projectDir: string,
  outputDir: string,
  config?: VeryfrontConfig,
): Promise<void> {
  if (!outputDir || outputDir.length > MAX_OUTPUT_PATH_LENGTH) {
    throw buildError("Build output directory is empty or exceeds the supported path length");
  }

  const resolvedOutput = resolve(outputDir);
  if (dirname(resolvedOutput) === resolvedOutput) {
    throw buildError(`Refusing to use a filesystem root as build output: ${outputDir}`);
  }

  await rejectUnsupportedExistingOutput(resolvedOutput);

  const canonicalProject = await realPath(resolve(projectDir));
  const canonicalOutput = await canonicalTargetPath(resolvedOutput);
  if (
    isPathInside(canonicalProject, canonicalOutput) ||
    canonicalOutput === canonicalProject
  ) {
    throw buildError(
      `Build output must not contain or replace the project directory: ${outputDir}`,
    );
  }

  const sourceDirectories = [
    join(canonicalProject, "public"),
    join(canonicalProject, config?.directories?.pages ?? "pages"),
    join(canonicalProject, config?.directories?.app ?? "app"),
  ];
  for (const sourceDir of sourceDirectories) {
    const canonicalSource = await canonicalTargetPath(sourceDir);
    if (
      isPathInside(canonicalOutput, canonicalSource) ||
      isPathInside(canonicalSource, canonicalOutput)
    ) {
      throw buildError(
        `Build output must not overlap a source directory: ${outputDir}`,
      );
    }
  }
}

function assertRoutePath(routePath: string, owner: string): void {
  if (
    routePath.length === 0 ||
    routePath.length > MAX_OUTPUT_PATH_LENGTH ||
    !routePath.startsWith("/") ||
    routePath.includes("\\") ||
    routePath.includes("?") ||
    routePath.includes("#") ||
    /[\u0000-\u001f\u007f-\u009f]/.test(routePath) ||
    (routePath !== "/" &&
      routePath.split("/").some((segment, index) =>
        index > 0 && (segment === "" || segment === "." || segment === "..")
      ))
  ) {
    throw buildError(`Invalid static route path ${JSON.stringify(routePath)} from ${owner}`);
  }

  const firstSegment = routePath.split("/")[1]?.toLocaleLowerCase("en-US");
  if (firstSegment && RESERVED_OUTPUT_PREFIXES.has(firstSegment)) {
    throw buildError(
      `Static route ${JSON.stringify(routePath)} uses a reserved build namespace`,
    );
  }
}

function registerPlannedFile(
  planned: PlannedFile[],
  path: string,
  owner: string,
): void {
  const normalizedPath = portablePath(path);
  const key = collisionKey(normalizedPath);
  for (const existing of planned) {
    if (
      key === existing.key ||
      key.startsWith(`${existing.key}/`) ||
      existing.key.startsWith(`${key}/`)
    ) {
      throw buildError(
        `Build output collision between ${existing.owner} (${existing.path}) and ` +
          `${owner} (${normalizedPath})`,
      );
    }
  }
  planned.push({ path: normalizedPath, key, owner });
}

function registerRoutes(
  planned: PlannedFile[],
  pagesRoutes: RouteInfo[],
  appRoutes: AppRouteInfo[],
): void {
  for (const route of pagesRoutes) {
    const owner = `Pages route ${JSON.stringify(route.path)}`;
    assertRoutePath(route.path, owner);
    const expectedSlug = route.path === "/" ? "index" : route.path.slice(1);
    if (route.slug !== expectedSlug) {
      throw buildError(
        `${owner} has inconsistent slug ${JSON.stringify(route.slug)}; expected ${
          JSON.stringify(expectedSlug)
        }`,
      );
    }
    registerPlannedFile(planned, getRouteOutputRelativePath(route.path), owner);
  }

  for (const route of appRoutes) {
    const owner = `App route ${JSON.stringify(route.path)}`;
    assertRoutePath(route.path, owner);
    registerPlannedFile(planned, getRouteOutputRelativePath(route.path), owner);
  }
}

function validatePublicEntries(
  planned: PlannedFile[],
  publicEntries: StaticAssetEntry[],
): void {
  const seen = new Map<string, StaticAssetEntry>();

  for (const entry of publicEntries) {
    const key = collisionKey(entry.relativePath);
    const existing = seen.get(key);
    if (existing) {
      throw buildError(
        `Public asset paths collide across filesystems: ${existing.relativePath} and ` +
          entry.relativePath,
      );
    }
    seen.set(key, entry);

    const firstSegment = portablePath(entry.relativePath).split("/")[0]
      ?.toLocaleLowerCase("en-US");
    if (firstSegment && RESERVED_OUTPUT_PREFIXES.has(firstSegment)) {
      throw buildError(
        `Public asset uses reserved build namespace: ${entry.relativePath}`,
      );
    }

    for (const output of planned) {
      const exact = key === output.key;
      const assetBelowOutputFile = key.startsWith(`${output.key}/`);
      const outputBelowAssetFile = output.key.startsWith(`${key}/`);
      const conflicts = entry.kind === "file"
        ? exact || assetBelowOutputFile || outputBelowAssetFile
        : exact || assetBelowOutputFile;

      if (conflicts) {
        throw buildError(
          `Public ${entry.kind} ${entry.relativePath} collides with ` +
            `${output.owner} (${output.path})`,
        );
      }
    }
  }
}

export function validateBuildOutputPlan(options: {
  pagesRoutes: RouteInfo[];
  appRoutes: AppRouteInfo[];
  publicEntries: StaticAssetEntry[];
}): void {
  const planned: PlannedFile[] = [];
  for (const path of FIXED_OUTPUT_FILES) {
    registerPlannedFile(planned, path, "Veryfront build runtime");
  }
  registerRoutes(planned, options.pagesRoutes, options.appRoutes);
  validatePublicEntries(planned, options.publicEntries);
}
