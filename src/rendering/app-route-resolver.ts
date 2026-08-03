/**
 * App Router Entity Resolution
 *
 * Resolves exact and parameterized App Router pages through the same captured,
 * bounded filesystem authority used by Pages Router entity discovery.
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import type { EntityInfo, Frontmatter } from "#veryfront/types";
import {
  type EntityResolutionOptions,
  type EntityResolutionSession,
  withEntityResolutionAdmission,
} from "#veryfront/types/entities/getEntityInfo.ts";
import {
  containsPathControlCharacters,
  parseRouteParameterSegment,
  type RouteParameterKind,
} from "#veryfront/utils/route-path-utils.ts";
import { MAX_PATH_LENGTH_CHARS, MAX_ROUTE_SEGMENTS } from "#veryfront/utils/constants/limits.ts";
import { ROUTE_CONFLICT } from "#veryfront/errors/error-registry/route.ts";
import { isAbsolute, join } from "#veryfront/compat/path";

interface RouteDirectory {
  readonly name: string;
  readonly kind: RouteParameterKind | "literal";
}

const APP_PAGE_EXTENSION_PRIORITY = [
  ".mdx",
  ".md",
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
] as const;

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
  options: EntityResolutionOptions = {},
): Promise<EntityInfo | null> {
  const normalizedSlug = normalizeRouteSlug(slug);
  const normalizedAppDir = normalizeProjectDirectory(appDirName);
  if (
    !isBoundedPath(projectDir) ||
    normalizedSlug === null ||
    normalizedAppDir === null
  ) return null;

  const appRoot = join(projectDir, normalizedAppDir);
  if (!isBoundedPath(appRoot)) return null;

  return await withEntityResolutionAdmission(
    projectDir,
    adapter,
    options,
    async (session) => {
      const exactMatch = await tryExactMatch(
        appRoot,
        normalizedSlug,
        normalizedAppDir,
        session,
      );
      if (exactMatch) return exactMatch;

      return await tryDynamicMatch(
        appRoot,
        normalizedSlug,
        normalizedAppDir,
        session,
      );
    },
  );
}

async function tryExactMatch(
  appRoot: string,
  slug: string,
  virtualRoot: string,
  session: EntityResolutionSession,
): Promise<EntityInfo | null> {
  const base = slug === "" ? appRoot : join(appRoot, slug);

  if (session.hasResolveFile) {
    for (const basePath of [`${base}/page`, base]) {
      const resolvedPath = await session.resolveFile(basePath);
      if (resolvedPath === null) continue;

      const entity = await loadAppPage(
        resolvedPath,
        slug,
        appRoot,
        virtualRoot,
        session,
      );
      if (entity) return entity;
    }
    return null;
  }

  for (const extension of APP_PAGE_EXTENSION_PRIORITY) {
    const entity = await loadAppPage(
      `${base}/page${extension}`,
      slug,
      appRoot,
      virtualRoot,
      session,
    );
    if (entity) return entity;
  }
  for (const extension of APP_PAGE_EXTENSION_PRIORITY) {
    const entity = await loadAppPage(
      `${base}${extension}`,
      slug,
      appRoot,
      virtualRoot,
      session,
    );
    if (entity) return entity;
  }

  return null;
}

async function tryDynamicMatch(
  appRoot: string,
  slug: string,
  virtualRoot: string,
  session: EntityResolutionSession,
): Promise<EntityInfo | null> {
  const segments = slug === "" ? [] : slug.split("/");
  let currentDir = appRoot;

  for (let index = 0; index < segments.length; index++) {
    const routeDirectory = await findRouteDirectory(
      currentDir,
      segments[index]!,
      session,
    );
    if (!routeDirectory) return null;

    currentDir = join(currentDir, routeDirectory.name);
    if (
      routeDirectory.kind === "catch-all" ||
      routeDirectory.kind === "optional-catch-all"
    ) break;
  }

  const directPage = await loadPageFromDirectory(
    currentDir,
    slug,
    appRoot,
    virtualRoot,
    session,
  );
  if (directPage) return directPage;

  const optionalDirectory = await findOptionalCatchAllDirectory(currentDir, session);
  if (optionalDirectory) {
    return await loadPageFromDirectory(
      join(currentDir, optionalDirectory),
      slug,
      appRoot,
      virtualRoot,
      session,
    );
  }

  return null;
}

async function findRouteDirectory(
  directory: string,
  segment: string,
  session: EntityResolutionSession,
): Promise<RouteDirectory | null> {
  const entries = await readDirectoryOrNull(directory, session);
  if (!entries) return null;

  const literal = entries.find((entry) => entry.isDirectory && entry.name === segment);
  if (literal) return { name: literal.name, kind: "literal" };

  for (const kind of ["dynamic", "catch-all", "optional-catch-all"] as const) {
    const candidates = entries
      .filter((entry) => entry.isDirectory)
      .map((entry) => ({
        entry,
        parameter: parseRouteParameterSegment(entry.name),
      }))
      .filter((candidate) =>
        candidate.parameter?.kind === kind && candidate.parameter.suffix === ""
      );
    if (candidates.length > 1) {
      throw ROUTE_CONFLICT.create({
        detail: `Multiple ${kind} App Router directories match the same route segment`,
        context: { candidateCount: candidates.length },
      });
    }
    const candidate = candidates[0];
    if (candidate) return { name: candidate.entry.name, kind };
  }

  return null;
}

async function findOptionalCatchAllDirectory(
  directory: string,
  session: EntityResolutionSession,
): Promise<string | null> {
  const entries = await readDirectoryOrNull(directory, session);
  if (!entries) return null;
  const candidates = entries.filter((entry) => {
    if (!entry.isDirectory) return false;
    const parameter = parseRouteParameterSegment(entry.name);
    return parameter?.kind === "optional-catch-all" && parameter.suffix === "";
  });
  if (candidates.length > 1) {
    throw ROUTE_CONFLICT.create({
      detail: "Multiple optional catch-all App Router directories match the same route",
      context: { candidateCount: candidates.length },
    });
  }
  return candidates[0]?.name ?? null;
}

async function readDirectoryOrNull(
  directory: string,
  session: EntityResolutionSession,
): Promise<Awaited<ReturnType<EntityResolutionSession["readDirectory"]>> | null> {
  try {
    return await session.readDirectory(directory);
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return null;
    throw error;
  }
}

async function loadPageFromDirectory(
  directory: string,
  slug: string,
  appRoot: string,
  virtualRoot: string,
  session: EntityResolutionSession,
): Promise<EntityInfo | null> {
  for (const extension of APP_PAGE_EXTENSION_PRIORITY) {
    const entity = await loadAppPage(
      join(directory, `page${extension}`),
      slug,
      appRoot,
      virtualRoot,
      session,
    );
    if (entity) return entity;
  }
  return null;
}

async function loadAppPage(
  filePath: string,
  slug: string,
  appRoot: string,
  virtualRoot: string,
  session: EntityResolutionSession,
): Promise<EntityInfo | null> {
  const info = await session.readEntityWithinRoot(
    filePath,
    appRoot,
    virtualRoot,
  );
  if (!info) return null;

  const frontmatter: Frontmatter = { ...info.entity.frontmatter };
  if (typeof frontmatter.layout === "boolean") {
    frontmatter.layout = frontmatter.layout ? "default" : "false";
  }

  return {
    ...info,
    entity: {
      ...info.entity,
      slug,
      type: "page",
      isPage: true,
      isLayout: false,
      isComponent: false,
      frontmatter,
    },
  };
}

function normalizeRouteSlug(value: string): string | null {
  if (!isBoundedPath(value) || value.includes("\\")) return null;
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (
    segments.length > MAX_ROUTE_SEGMENTS ||
    segments.some((segment) => segment === "..")
  ) return null;
  return segments.join("/");
}

function normalizeProjectDirectory(value: string): string | null {
  if (!isBoundedPath(value) || value.includes("\\") || isAbsolute(value)) return null;
  const segments = value.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.some((segment) => segment === "..")) return null;
  return segments.length === 0 ? "." : segments.join("/");
}

function isBoundedPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PATH_LENGTH_CHARS &&
    !containsPathControlCharacters(value);
}
