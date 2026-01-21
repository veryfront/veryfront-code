import { join } from "#veryfront/platform/compat/path/index.ts";
import { bundlerLogger as logger } from "#veryfront/utils";
import { createFileSystem } from "../platform/compat/fs.ts";

/** Directories within .veryfront that should be excluded from scanning */
const VERYFRONT_EXCLUDED_DIRS = new Set([
  "cache",
  "compiled",
  "tmp",
  "temp",
  "output",
  "optimized-images",
  "css",
]);

/** Check if a directory should be skipped during scanning */
function shouldSkipDir(name: string, parentPath?: string): boolean {
  // Allow .veryfront directory itself
  if (name === ".veryfront") return false;
  // Skip other hidden directories
  if (name.startsWith(".")) return true;
  // If inside .veryfront, check against excluded subdirectories
  if (parentPath?.includes(".veryfront")) {
    if (VERYFRONT_EXCLUDED_DIRS.has(name)) return true;
  }
  return false;
}

const SIZE_LIMITS = {
  DEP_SIZE_ESTIMATE: 25_000,
  UI_LIB_SIZE_ESTIMATE: 150_000,
  REACT_SIZE_ESTIMATE: 200_000,
};

function analyzeImports(content: string) {
  const importRegex = /import\s+[^'"\n]+from\s+['"]([^'"]+)['"];?/g;
  const local: { path: string }[] = [];
  const remote: { url: string }[] = [];
  const shared: { pkg: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    const spec = m[1] ?? "";
    if (spec.startsWith(".") || spec.startsWith("/")) {
      local.push({ path: spec });
    } else if (spec.startsWith("http://") || spec.startsWith("https://")) {
      remote.push({ url: spec });
    } else if (spec.length > 0) {
      shared.push({ pkg: spec });
    }
  }
  return { local, remote, shared };
}

export interface ChunkAnalysis {
  pages: Map<string, PageImports>;
  sharedDeps: Map<string, number>; // dep -> usage count
  suggestedChunks: ChunkSuggestion[];
}

export interface PageImports {
  path: string;
  local: string[];
  remote: string[];
  shared: string[];
}

export interface ChunkSuggestion {
  name: string;
  deps: string[];
  pages: string[];
  benefit: number; // estimated bytes saved
}

export interface ChunkManifest {
  version: string;
  chunks: Record<string, {
    deps: string[];
    size: number;
  }>;
  pages: Record<string, {
    chunks: string[];
    deps: {
      local: string[];
      remote: string[];
      shared: string[];
    };
  }>;
}

type FSLike = {
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  readTextFile(path: string): Promise<string>;
};

export async function analyzeProjectChunks(
  projectDir: string,
  fs?: FSLike,
): Promise<ChunkAnalysis> {
  const fsAdapter = fs ?? createFileSystem();
  const pages = new Map<string, PageImports>();
  const sharedDeps = new Map<string, number>();
  const mdxFiles: string[] = [];

  async function findMDX(dir: string) {
    try {
      const entries = fsAdapter.readDir(dir);
      for await (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isFile && (entry.name.endsWith(".mdx") || entry.name.endsWith(".md"))) {
          mdxFiles.push(path);
        } else if (entry.isDirectory && !shouldSkipDir(entry.name, dir)) {
          await findMDX(path);
        }
      }
    } catch (error) {
      logger.debug(`Directory not accessible: ${dir}`, error);
    }
  }

  // Scan pages directory and .veryfront directory
  await findMDX(join(projectDir, "pages"));
  await findMDX(join(projectDir, ".veryfront"));

  for (const mdxPath of mdxFiles) {
    try {
      const content = await fsAdapter.readTextFile(mdxPath);
      const imports = analyzeImports(content);

      const pageImports: PageImports = {
        path: mdxPath,
        local: imports.local.map((i: { path: string }) => i.path),
        remote: imports.remote.map((i: { url: string }) => i.url),
        shared: imports.shared.map((i: { pkg: string }) => i.pkg),
      };

      pages.set(mdxPath, pageImports);

      for (const dep of getExternalDeps(pageImports)) {
        sharedDeps.set(dep, (sharedDeps.get(dep) || 0) + 1);
      }
    } catch (error) {
      logger.error(`Failed to analyze ${mdxPath}:`, error);
    }
  }

  const suggestedChunks = generateChunkSuggestions(pages, sharedDeps);

  return {
    pages,
    sharedDeps,
    suggestedChunks,
  };
}

/** Get all external dependencies (remote URLs and shared packages) from imports */
function getExternalDeps(imports: PageImports): string[] {
  return [...imports.remote, ...imports.shared];
}

/** Find all pages that use any of the given dependencies */
function findPagesUsingDeps(pages: Map<string, PageImports>, deps: string[]): string[] {
  const result: string[] = [];
  for (const [path, imports] of pages) {
    const usesAny = getExternalDeps(imports).some((dep) => deps.includes(dep));
    if (usesAny) result.push(path);
  }
  return result;
}

interface ChunkConfig {
  name: string;
  getDeps: (sharedDeps: Map<string, number>) => string[];
  calculateBenefit: (deps: string[], pages: string[]) => number;
}

const CHUNK_CONFIGS: ChunkConfig[] = [
  {
    name: "common",
    getDeps: (sharedDeps) =>
      Array.from(sharedDeps.entries())
        .filter(([_, count]) => count >= 2)
        .map(([dep]) => dep),
    calculateBenefit: (deps, pages) =>
      deps.length * pages.length * SIZE_LIMITS.DEP_SIZE_ESTIMATE,
  },
  {
    name: "react-vendor",
    getDeps: (sharedDeps) =>
      Array.from(sharedDeps.keys()).filter(
        (dep) => dep.includes("react") || dep.includes("jsx-runtime"),
      ),
    calculateBenefit: () => SIZE_LIMITS.REACT_SIZE_ESTIMATE,
  },
  {
    name: "ui-vendor",
    getDeps: (sharedDeps) =>
      Array.from(sharedDeps.keys()).filter(
        (dep) =>
          dep.includes("@mui/") || dep.includes("framer-motion") || dep.includes("@headlessui/"),
      ),
    calculateBenefit: (deps) => deps.length * SIZE_LIMITS.UI_LIB_SIZE_ESTIMATE,
  },
];

function generateChunkSuggestions(
  pages: Map<string, PageImports>,
  sharedDeps: Map<string, number>,
): ChunkSuggestion[] {
  const suggestions: ChunkSuggestion[] = [];

  for (const config of CHUNK_CONFIGS) {
    const deps = config.getDeps(sharedDeps);
    if (deps.length === 0) continue;

    const pagesUsingDeps = findPagesUsingDeps(pages, deps);
    suggestions.push({
      name: config.name,
      deps,
      pages: pagesUsingDeps,
      benefit: config.calculateBenefit(deps, pagesUsingDeps),
    });
  }

  return suggestions.sort((a, b) => b.benefit - a.benefit);
}

export function generateChunkManifest(analysis: ChunkAnalysis): ChunkManifest {
  const manifest: ChunkManifest = {
    version: "1.0",
    chunks: {},
    pages: {},
  };

  for (const suggestion of analysis.suggestedChunks) {
    manifest.chunks[suggestion.name] = {
      deps: suggestion.deps,
      size: suggestion.benefit,
    };
  }

  for (const [pagePath, imports] of analysis.pages) {
    const pageChunks: string[] = [];

    const pageDeps = getExternalDeps(imports);
    for (const chunk of analysis.suggestedChunks) {
      const usesChunk = chunk.deps.some((dep) => pageDeps.includes(dep));
      if (usesChunk) {
        pageChunks.push(chunk.name);
      }
    }

    manifest.pages[pagePath] = {
      chunks: pageChunks,
      deps: {
        local: imports.local,
        remote: imports.remote,
        shared: imports.shared,
      },
    };
  }

  return manifest;
}
