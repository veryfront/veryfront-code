
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { EntityInfo, Frontmatter } from "@veryfront/types";
import { join } from "../platform/compat/path-helper.ts";
import { serverLogger as logger } from "@veryfront/utils";

let extractYaml: ((content: string) => any) | undefined;
let jsYamlModule: typeof import("js-yaml") | null = null;

// @ts-ignore - Deno global
if (typeof Deno === "undefined") {
  extractYaml = (content: string) => {
    const frontMatterRegex = /^---\n([\s\S]*?)\n---/;
    const match = content.match(frontMatterRegex);
    if (match && match[1]) {
      if (jsYamlModule) {
        const attrs = jsYamlModule.load(match[1]);
        const body = content.slice(match[0].length);
        return { attrs, body };
      }
      return { attrs: {}, body: content };
    }
    return { attrs: {}, body: content };
  };

  import("js-yaml").then((mod) => {
    jsYamlModule = mod;
  }).catch((e) => {
    logger.warn("Could not import js-yaml for Node.js frontmatter parsing.", e);
  });
} else {
  // @ts-ignore - Deno global
  const { extract } = await import("std/front_matter/yaml.ts");
  extractYaml = extract;
}

export async function getAppRouteEntity(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName = "app",
): Promise<EntityInfo | null> {
  const exactMatch = await tryExactMatch(projectDir, slug, adapter, appDirName);
  if (exactMatch) return exactMatch;

  return await tryDynamicMatch(projectDir, slug, adapter, appDirName);
}

async function tryExactMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const base = slug ? join(projectDir, appDirName, slug) : join(projectDir, appDirName);
  const candidates = [
    `${base}/page.mdx`,
    `${base}/page.tsx`,
    `${base}/page.jsx`,
    `${base}/page.ts`,
    `${base}/page.js`,
    `${base}.mdx`,
    `${base}.tsx`,
    `${base}.jsx`,
    `${base}.ts`,
    `${base}.js`,
  ];

  for (const file of candidates) {
    const entity = await tryLoadPageFile(file, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

async function tryDynamicMatch(
  projectDir: string,
  slug: string,
  adapter: RuntimeAdapter,
  appDirName: string,
): Promise<EntityInfo | null> {
  const segments = slug ? slug.split("/").filter(Boolean) : [];
  let currentDir = join(projectDir, appDirName);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;
    const exactPath = join(currentDir, segment);

    try {
      const stat = await adapter.fs.stat(exactPath);
      if (stat.isDirectory) {
        currentDir = exactPath;
        continue;
      }
    } catch {
      // Exact match failed, try dynamic segments
    }

    let foundDynamic = false;
    let isCatchAll = false;
    try {
      const entries = await adapter.fs.readDir(currentDir);
      for await (const entry of entries) {
        if (entry.isDirectory && isDynamicSegment(entry.name)) {
          currentDir = join(currentDir, entry.name);
          foundDynamic = true;
          if (entry.name.startsWith("[...")) {
            isCatchAll = true;
          }
          break;
        }
      }
    } catch {
      // adapter.fs.readDir failed - no fallback to Deno for npm compatibility
    }

    if (!foundDynamic) {
      return null;
    }

    if (isCatchAll) {
      break;
    }
  }

  const pageExtensions = [".mdx", ".tsx", ".jsx", ".ts", ".js"];
  for (const ext of pageExtensions) {
    const pageFile = join(currentDir, `page${ext}`);
    const entity = await tryLoadPageFile(pageFile, slug, adapter);
    if (entity) return entity;
  }

  return null;
}

function isDynamicSegment(name: string): boolean {
  return name.startsWith("[") && name.endsWith("]");
}

async function tryLoadPageFile(
  file: string,
  slug: string,
  adapter: RuntimeAdapter,
): Promise<EntityInfo | null> {
  try {
    const info = await adapter.fs.stat(file);
    if (!info.isFile) return null;

    const raw = await adapter.fs.readFile(file);
    let content = raw;
    let fm: Record<string, unknown> = {};

    try {
      if (raw.trim().startsWith("---") && extractYaml) {
        const ex = extractYaml(raw);
        content = ex.body;
        fm = (ex.attrs as Record<string, unknown>) || {};
      }
    } catch {
      /* best-effort frontmatter extraction */
    }

    const coercedFm: Record<string, unknown> = { ...fm };
    if (typeof coercedFm.layout === "boolean") {
      coercedFm.layout = coercedFm.layout ? "default" : "false";
    }

    return {
      entity: {
        id: file,
        slug,
        type: "page",
        isPage: true,
        isLayout: false,
        isProvider: false,
        isComponent: false,
        content,
        frontmatter: coercedFm as Frontmatter,
      },
    };
  } catch {
    return null;
  }
}
