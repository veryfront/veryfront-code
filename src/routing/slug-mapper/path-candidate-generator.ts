import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import type { PathCandidates } from "./types.ts";

const SUPPORTED_EXTENSIONS = [".mdx", ".tsx", ".jsx", ".ts", ".js"];

export function generateAppRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  const candidates: string[] = [];

  if (normalizedSlug) {
    const base = join(projectDir, "app", normalizedSlug);

    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(`${base}/page${ext}`);
    }

    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(`${base}${ext}`);
    }
  } else {
    const appBase = join(projectDir, "app");
    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(`${appBase}/page${ext}`);
    }
  }

  return candidates;
}

export function generatePagesRouterCandidates(
  projectDir: string,
  normalizedSlug: string,
): string[] {
  const candidates: string[] = [];

  if (normalizedSlug === "" || normalizedSlug === "index") {
    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(join(projectDir, "pages", `index${ext}`));
      candidates.push(join(projectDir, `index${ext}`));
    }
  } else {
    for (const ext of SUPPORTED_EXTENSIONS) {
      candidates.push(join(projectDir, "pages", `${normalizedSlug}${ext}`));

      candidates.push(
        join(projectDir, "pages", normalizedSlug, `index${ext}`),
      );

      candidates.push(join(projectDir, `${normalizedSlug}${ext}`));
    }
  }

  return candidates;
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
