import { join } from "#veryfront/compat/path";
import type { PathCandidates } from "./types.ts";
import { normalizeSlug } from "./slug-normalizer.ts";

const SUPPORTED_EXTENSIONS = Object.freeze([".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"]);
const MAX_CANDIDATE_SLUG_LENGTH = 4_096;
const MAX_CANDIDATE_SLUG_SEGMENTS = 256;

function withExtensions(basePath: string, filename: string): string[] {
  return SUPPORTED_EXTENSIONS.map((ext) => join(basePath, `${filename}${ext}`));
}

function withJoinedExtensions(basePath: string, filenameWithExtBase: string): string[] {
  return SUPPORTED_EXTENSIONS.map((ext) => join(basePath, `${filenameWithExtBase}${ext}`));
}

export function generateAppRouterCandidates(projectDir: string, normalizedSlug: string): string[] {
  assertProjectDirectory(projectDir);
  normalizedSlug = normalizeCandidateSlug(normalizedSlug);
  const appBase = join(projectDir, "app");

  if (!normalizedSlug) return withExtensions(appBase, "page");

  const slugBase = join(appBase, normalizedSlug);

  return [
    ...withExtensions(slugBase, "page"),
    ...SUPPORTED_EXTENSIONS.map((ext) => join(appBase, `${normalizedSlug}${ext}`)),
  ];
}

export function generatePagesRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  assertProjectDirectory(projectDir);
  normalizedSlug = normalizeCandidateSlug(normalizedSlug);
  const pagesBase = join(projectDir, "pages");
  const isIndex = normalizedSlug === "" || normalizedSlug === "index";

  if (isIndex) {
    return [...withExtensions(pagesBase, "index"), ...withExtensions(projectDir, "index")];
  }

  const pagesSlugBase = join(pagesBase, normalizedSlug);

  return [
    ...withJoinedExtensions(pagesBase, normalizedSlug),
    ...withExtensions(pagesSlugBase, "index"),
    ...withJoinedExtensions(projectDir, normalizedSlug),
  ];
}

export function getPathCandidates(projectDir: string, slug: string): PathCandidates {
  assertProjectDirectory(projectDir);
  const normalizedSlug = normalizeCandidateSlug(slug);

  return {
    appRouter: generateAppRouterCandidates(projectDir, normalizedSlug),
    pagesRouter: generatePagesRouterCandidates(projectDir, normalizedSlug),
  };
}

export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}

function assertProjectDirectory(projectDir: unknown): asserts projectDir is string {
  if (
    typeof projectDir !== "string" || projectDir.length === 0 || hasControlCharacters(projectDir)
  ) {
    throw new TypeError("Project directory must be a non-empty control-free string");
  }
}

function normalizeCandidateSlug(slug: unknown): string {
  if (
    typeof slug !== "string" ||
    slug.length > MAX_CANDIDATE_SLUG_LENGTH ||
    slug.includes("\\") ||
    hasControlCharacters(slug)
  ) {
    throw new TypeError(
      `Route candidate slug must be a control-free URL-path string no longer than ${MAX_CANDIDATE_SLUG_LENGTH} characters`,
    );
  }

  const normalized = normalizeSlug(slug);
  const segments = normalized ? normalized.split("/") : [];
  if (
    segments.length > MAX_CANDIDATE_SLUG_SEGMENTS ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError(
      `Route candidate slug must contain at most ${MAX_CANDIDATE_SLUG_SEGMENTS} non-traversal segments`,
    );
  }
  return normalized;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
