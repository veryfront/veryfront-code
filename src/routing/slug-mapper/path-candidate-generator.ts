import { join } from "#veryfront/compat/path";
import { INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";
import type { PathCandidates } from "./types.ts";
import { normalizeSlug } from "./slug-normalizer.ts";

const SUPPORTED_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];
const MAX_ROUTE_SLUG_LENGTH = 4_096;

function normalizeCandidateSlug(slug: string): string {
  if (
    typeof slug !== "string" || slug.length > MAX_ROUTE_SLUG_LENGTH || slug.includes("\0") ||
    slug.includes("\\")
  ) {
    throw INVALID_ARGUMENT.create({
      message: "Route slug must be a valid project-relative path",
    });
  }

  const normalized = normalizeSlug(slug);
  if (normalized.split("/").some((segment) => segment === "." || segment === "..")) {
    throw INVALID_ARGUMENT.create({
      message: "Route slug must not contain path traversal segments",
    });
  }

  return normalized;
}

function withExtensions(basePath: string, filename: string): string[] {
  return SUPPORTED_EXTENSIONS.map((ext) => `${basePath}/${filename}${ext}`);
}

function withJoinedExtensions(basePath: string, filenameWithExtBase: string): string[] {
  return SUPPORTED_EXTENSIONS.map((ext) => join(basePath, `${filenameWithExtBase}${ext}`));
}

export function generateAppRouterCandidates(projectDir: string, normalizedSlug: string): string[] {
  normalizedSlug = normalizeCandidateSlug(normalizedSlug);
  const appBase = join(projectDir, "app");

  if (!normalizedSlug) return withExtensions(appBase, "page");

  const slugBase = join(appBase, normalizedSlug);

  return [
    ...withExtensions(slugBase, "page"),
    ...SUPPORTED_EXTENSIONS.map((ext) => `${slugBase}${ext}`),
  ];
}

export function generatePagesRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
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
  const normalizedSlug = normalizeCandidateSlug(slug);

  return {
    appRouter: generateAppRouterCandidates(projectDir, normalizedSlug),
    pagesRouter: generatePagesRouterCandidates(projectDir, normalizedSlug),
  };
}

export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}
