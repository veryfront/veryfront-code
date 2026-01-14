import { join } from "@veryfront/platform/compat/path-helper.ts";
import type { PathCandidates } from "./types.ts";

const SUPPORTED_EXTENSIONS = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];

/** Generates path candidates for a base path with all supported extensions */
function withExtensions(basePath: string, filename: string): string[] {
  return SUPPORTED_EXTENSIONS.map((ext) => `${basePath}/${filename}${ext}`);
}

export function generateAppRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  const appBase = join(projectDir, "app");

  if (!normalizedSlug) {
    return withExtensions(appBase, "page");
  }

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
  const pagesBase = join(projectDir, "pages");
  const isIndex = normalizedSlug === "" || normalizedSlug === "index";

  if (isIndex) {
    return [
      ...withExtensions(pagesBase, "index"),
      ...withExtensions(projectDir, "index"),
    ];
  }

  return [
    ...SUPPORTED_EXTENSIONS.map((ext) => join(pagesBase, `${normalizedSlug}${ext}`)),
    ...withExtensions(join(pagesBase, normalizedSlug), "index"),
    ...SUPPORTED_EXTENSIONS.map((ext) => join(projectDir, `${normalizedSlug}${ext}`)),
  ];
}

export function getPathCandidates(
  projectDir: string,
  slug: string,
): PathCandidates {
  const normalizedSlug = slug || "";

  return {
    appRouter: generateAppRouterCandidates(projectDir, normalizedSlug),
    pagesRouter: generatePagesRouterCandidates(projectDir, normalizedSlug),
  };
}

export function getSupportedExtensions(): string[] {
  return [...SUPPORTED_EXTENSIONS];
}
