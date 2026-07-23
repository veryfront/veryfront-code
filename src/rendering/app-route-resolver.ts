/**
 * App Router Entity Resolution
 *
 * Handles resolution of App Router page entities, including:
 * - Exact route matching
 * - Dynamic segment matching ([id], [...slug], etc.)
 * - Page file loading with frontmatter extraction
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { validatePath } from "#veryfront/security/path-validation/index.ts";
import type { EntityInfo, Frontmatter } from "#veryfront/types";
import {
  compareRouteSpecificity,
  containsPathControlCharacters,
  isDynamicSegment,
  isInterceptionRouteSegment,
  isRouteGroupSegment,
  matchRoutePattern,
  parseRouteParameterSegment,
  type RouteSpecificity,
} from "#veryfront/utils/route-path-utils.ts";
import { MAX_PATH_LENGTH } from "#veryfront/utils/constants/security.ts";
import { isAbsolute, join } from "#veryfront/compat/path";
import { extract } from "#std/front-matter/yaml.ts";

const APP_PAGE_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"] as const;
const MAX_ROUTE_RESOLUTION_STATES = 10_000;

interface ResolutionState {
  dir: string;
  segmentIndex: number;
  pattern: string;
  catchAllUsed: boolean;
}

interface ResolutionCandidate {
  entity: EntityInfo;
  specificity: RouteSpecificity;
}

interface ResolutionContext {
  adapter: RuntimeAdapter;
  appRoot: string;
  slug: string;
  matchSlug: string;
  validatedPaths: Map<string, Promise<boolean>>;
  directoryNames: Map<string, Promise<string[]>>;
  candidates: Map<string, ResolutionCandidate>;
}

function isOptionalCatchAllDirectory(name: string): boolean {
  const parameter = parseRouteParameterSegment(name);
  return parameter?.kind === "optional-catch-all" && !parameter.suffix;
}

function isRequiredCatchAllDirectory(name: string): boolean {
  const parameter = parseRouteParameterSegment(name);
  return parameter?.kind === "catch-all" && !parameter.suffix;
}

function isStandardDynamicDirectory(name: string): boolean {
  const parameter = parseRouteParameterSegment(name);
  return parameter?.kind === "dynamic" && !parameter.suffix;
}

function parseUrlSegments(slug: string): string[] | null {
  if (
    slug.length > MAX_PATH_LENGTH ||
    slug.includes("\\") ||
    containsPathControlCharacters(slug)
  ) {
    return null;
  }

  const segments = slug.split("/").filter(Boolean);
  for (const segment of segments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch (_) {
      return null;
    }

    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      containsPathControlCharacters(decoded) ||
      isRouteGroupSegment(decoded) ||
      isInterceptionRouteSegment(decoded)
    ) {
      return null;
    }
  }

  return segments;
}

function normalizeAppDirectoryName(appDirName: string): string | null {
  if (
    !appDirName ||
    appDirName.length > MAX_PATH_LENGTH ||
    containsPathControlCharacters(appDirName) ||
    isAbsolute(appDirName)
  ) {
    return null;
  }

  const normalized = appDirName.replaceAll("\\", "/");
  if (isAbsolute(normalized)) return null;

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  return segments.join("/");
}

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  const segments = parseUrlSegments(slug);
  if (!segments) return null;

  const normalizedAppDir = normalizeAppDirectoryName(appDirName);
  if (!normalizedAppDir) return null;

  const appRootValidation = await validatePath(normalizedAppDir, {
    level: "strict",
    baseDir: projectDir,
    adapter,
    allowAbsolute: false,
  });
  if (!appRootValidation.valid) return null;

  const appRoot = join(projectDir, normalizedAppDir);
  const context: ResolutionContext = {
    adapter,
    appRoot,
    slug,
    matchSlug: segments.join("/"),
    validatedPaths: new Map([[appRoot, Promise.resolve(true)]]),
    directoryNames: new Map(),
    candidates: new Map(),
  };

  await collectRouteCandidates(segments, context);
  return selectBestCandidate(context.candidates.values());
}

async function collectRouteCandidates(
  segments: string[],
  context: ResolutionContext,
): Promise<void> {
  const queue: ResolutionState[] = [{
    dir: context.appRoot,
    segmentIndex: 0,
    pattern: "",
    catchAllUsed: false,
  }];
  const visited = new Set<string>();

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
    const state = queue[queueIndex]!;
    const stateKey = `${state.dir}\0${state.segmentIndex}\0${state.catchAllUsed}\0${state.pattern}`;
    if (visited.has(stateKey)) continue;
    visited.add(stateKey);

    if (!(await isContainedPath(state.dir, context))) continue;

    await collectPatternPageBase(join(state.dir, "page"), state.pattern, context);

    const terminalSegment = segments.at(-1);
    const canHaveFlatPage = terminalSegment && !isDynamicSegment(terminalSegment) &&
      (state.catchAllUsed || state.segmentIndex === segments.length - 1);
    if (canHaveFlatPage) {
      await collectPatternPageBase(
        join(state.dir, terminalSegment),
        appendRouteSegment(state.pattern, terminalSegment),
        context,
      );
    }

    const directoryNames = await readDirectoryNames(state.dir, context);
    for (const group of directoryNames.filter(isRouteGroupSegment)) {
      enqueueResolutionState(queue, { ...state, dir: join(state.dir, group) });
    }

    if (state.catchAllUsed) {
      enqueueCatchAllSuffixDirectories(queue, state, directoryNames, segments);
      continue;
    }

    const segment = segments[state.segmentIndex];
    if (segment && directoryNames.includes(segment) && !isDynamicSegment(segment)) {
      enqueueResolutionState(queue, {
        dir: join(state.dir, segment),
        segmentIndex: state.segmentIndex + 1,
        pattern: appendRouteSegment(state.pattern, segment),
        catchAllUsed: false,
      });
    }

    if (segment) {
      for (const dynamic of directoryNames.filter(isStandardDynamicDirectory)) {
        enqueueResolutionState(queue, {
          dir: join(state.dir, dynamic),
          segmentIndex: state.segmentIndex + 1,
          pattern: appendRouteSegment(state.pattern, dynamic),
          catchAllUsed: false,
        });
      }

      for (const catchAll of directoryNames.filter(isRequiredCatchAllDirectory)) {
        enqueueResolutionState(queue, {
          dir: join(state.dir, catchAll),
          segmentIndex: state.segmentIndex,
          pattern: appendRouteSegment(state.pattern, catchAll),
          catchAllUsed: true,
        });
      }
    }

    for (const catchAll of directoryNames.filter(isOptionalCatchAllDirectory)) {
      enqueueResolutionState(queue, {
        dir: join(state.dir, catchAll),
        segmentIndex: state.segmentIndex,
        pattern: appendRouteSegment(state.pattern, catchAll),
        catchAllUsed: true,
      });
    }
  }
}

function enqueueResolutionState(
  queue: ResolutionState[],
  state: ResolutionState,
): void {
  if (queue.length >= MAX_ROUTE_RESOLUTION_STATES) {
    throw new Error(`App route resolution exceeded ${MAX_ROUTE_RESOLUTION_STATES} states`);
  }
  queue.push(state);
}

function appendRouteSegment(pattern: string, segment: string): string {
  return pattern ? `${pattern}/${segment}` : segment;
}

function enqueueCatchAllSuffixDirectories(
  queue: ResolutionState[],
  state: ResolutionState,
  directoryNames: string[],
  segments: string[],
): void {
  for (const name of directoryNames) {
    if (
      isRouteGroupSegment(name) ||
      isRequiredCatchAllDirectory(name) ||
      isOptionalCatchAllDirectory(name)
    ) {
      continue;
    }

    const dynamic = isStandardDynamicDirectory(name);
    if (!dynamic && (isDynamicSegment(name) || !segments.includes(name))) continue;

    enqueueResolutionState(queue, {
      dir: join(state.dir, name),
      segmentIndex: state.segmentIndex,
      pattern: appendRouteSegment(state.pattern, name),
      catchAllUsed: true,
    });
  }
}

function selectBestCandidate(candidates: Iterable<ResolutionCandidate>): EntityInfo | null {
  const ranked = [...candidates].sort((left, right) => compareCandidates(right, left));
  const best = ranked[0];
  if (!best) return null;

  const equallySpecific = ranked[1] && compareCandidates(best, ranked[1]) === 0;
  return equallySpecific ? null : best.entity;
}

function compareCandidates(left: ResolutionCandidate, right: ResolutionCandidate): number {
  return compareRouteSpecificity(left.specificity, right.specificity);
}

async function collectPatternPageBase(
  basePath: string,
  pattern: string,
  context: ResolutionContext,
): Promise<void> {
  const match = matchRoutePattern(pattern, context.matchSlug);
  if (!match) return;

  const entity = await tryLoadPageBase(basePath, context);
  if (!entity) return;

  const candidate = { entity, specificity: match.specificity };
  const existing = context.candidates.get(entity.entity.path);
  if (!existing || compareCandidates(candidate, existing) > 0) {
    context.candidates.set(entity.entity.path, candidate);
  }
}

function isSafeDirectoryEntry(name: string): boolean {
  return name.length > 0 &&
    name.length <= MAX_PATH_LENGTH &&
    name !== "." &&
    name !== ".." &&
    !name.startsWith("@") &&
    !name.startsWith("_") &&
    !/[\/\\]/.test(name) &&
    !containsPathControlCharacters(name) &&
    !isInterceptionRouteSegment(name);
}

async function readDirectoryNames(
  dir: string,
  context: ResolutionContext,
): Promise<string[]> {
  const cached = context.directoryNames.get(dir);
  if (cached) return await cached;

  const namesPromise = (async (): Promise<string[]> => {
    const names: string[] = [];
    try {
      for await (const entry of context.adapter.fs.readDir(dir)) {
        if (entry.isDirectory && !entry.isSymlink && isSafeDirectoryEntry(entry.name)) {
          names.push(entry.name);
        }
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    return [...new Set(names)].sort();
  })();

  context.directoryNames.set(dir, namesPromise);
  return await namesPromise;
}

async function isContainedPath(path: string, context: ResolutionContext): Promise<boolean> {
  const cached = context.validatedPaths.get(path);
  if (cached) return await cached;

  const validationPromise = validatePath(path, {
    level: "strict",
    baseDir: context.appRoot,
    adapter: context.adapter,
    allowAbsolute: true,
  }).then((result) => result.valid);
  context.validatedPaths.set(path, validationPromise);
  return await validationPromise;
}

async function tryLoadPageBase(
  basePath: string,
  context: ResolutionContext,
): Promise<EntityInfo | null> {
  for (const extension of APP_PAGE_EXTENSIONS) {
    const entity = await tryLoadPageFile(`${basePath}${extension}`, context);
    if (entity) return entity;
  }

  return null;
}

async function tryLoadPageFile(
  file: string,
  context: ResolutionContext,
): Promise<EntityInfo | null> {
  if (!(await isContainedPath(file, context))) return null;

  let raw: string;
  try {
    raw = await context.adapter.fs.readFile(file);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }

  let content = raw;
  let fm: Record<string, unknown> = {};

  if (raw.trim().startsWith("---")) {
    try {
      const ex = extract(raw);
      content = ex.body;
      fm = (ex.attrs as Record<string, unknown>) ?? {};
    } catch (_) {
      /* expected: malformed frontmatter - use raw content as-is */
      content = raw;
    }
  }

  const frontmatter: Record<string, unknown> = { ...fm };
  if (typeof frontmatter.layout === "boolean") {
    frontmatter.layout = frontmatter.layout ? "default" : "false";
  }

  return {
    entity: {
      id: file,
      path: file,
      slug: context.slug,
      type: "page",
      isPage: true,
      isLayout: false,
      isComponent: false,
      content,
      frontmatter: frontmatter as Frontmatter,
    },
  };
}
