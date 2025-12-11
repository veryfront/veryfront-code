import { join } from "std/path/mod.ts";
import { bundlerLogger as logger } from "@veryfront/utils";
import { createFileSystem } from "../platform/compat/fs.ts";

const SIZE_LIMITS = {
  DEP_SIZE_ESTIMATE: 25_000,
  UI_LIB_SIZE_ESTIMATE: 150_000,
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
  sharedDeps: Map<string, number>;
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
  benefit: number;
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
        if (entry.isFile && entry.name.endsWith(".mdx")) {
          mdxFiles.push(path);
        } else if (entry.isDirectory && !entry.name.startsWith(".")) {
          await findMDX(path);
        }
      }
    } catch (error) {
      logger.debug(`Directory not accessible: ${dir}`, error);
    }
  }

  await findMDX(join(projectDir, "pages"));

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

      for (const dep of [...pageImports.remote, ...pageImports.shared]) {
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

function generateChunkSuggestions(
  pages: Map<string, PageImports>,
  sharedDeps: Map<string, number>,
) {
  const suggestions: ChunkSuggestion[] = [];

  const commonDeps = Array.from(sharedDeps.entries())
    .filter(([_, count]) => count >= 2)
    .map(([dep, _]) => dep);

  if (commonDeps.length > 0) {
    const pagesUsingCommon: string[] = [];
    for (const [path, imports] of pages) {
      const uses = [...imports.remote, ...imports.shared].some((dep) => commonDeps.includes(dep));
      if (uses) pagesUsingCommon.push(path);
    }

    suggestions.push({
      name: "common",
      deps: commonDeps,
      pages: pagesUsingCommon,
      benefit: commonDeps.length *
        pagesUsingCommon.length *
        SIZE_LIMITS.DEP_SIZE_ESTIMATE,
    });
  }

  const reactDeps = Array.from(sharedDeps.keys()).filter(
    (dep) => dep.includes("react") || dep.includes("jsx-runtime"),
  );

  if (reactDeps.length > 0) {
    const pagesUsingReact = Array.from(pages.keys()).filter((path) => {
      const imports = pages.get(path)!;
      return [...imports.remote, ...imports.shared].some((dep) => reactDeps.includes(dep));
    });

    suggestions.push({
      name: "react-vendor",
      deps: reactDeps,
      pages: pagesUsingReact,
      benefit: 200000,
    });
  }

  const uiDeps = Array.from(sharedDeps.keys()).filter(
    (dep) => dep.includes("@mui/") || dep.includes("framer-motion") || dep.includes("@headlessui/"),
  );

  if (uiDeps.length > 0) {
    const pagesUsingUI = Array.from(pages.keys()).filter((path) => {
      const imports = pages.get(path)!;
      return [...imports.remote, ...imports.shared].some((dep) => uiDeps.includes(dep));
    });

    suggestions.push({
      name: "ui-vendor",
      deps: uiDeps,
      pages: pagesUsingUI,
      benefit: uiDeps.length * SIZE_LIMITS.UI_LIB_SIZE_ESTIMATE,
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

    for (const chunk of analysis.suggestedChunks) {
      const pageDeps = [...imports.remote, ...imports.shared];
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
