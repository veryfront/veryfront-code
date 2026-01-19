// Custom Node.js ESM resolver hooks for Deno-style imports
import { readFileSync, existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve as pathResolve, dirname, extname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, '..');

// Read deno.json to get import map (split local file vs URL-based imports)
const fileImportMap = {};
const urlImportMap = {};

function addImports(denoImports, options = { includeFile: true }) {
  const includeFile = options?.includeFile ?? true;
  for (const [key, value] of Object.entries(denoImports || {})) {
    if (typeof value !== 'string') continue;
    if (includeFile && (value.startsWith('./') || value.startsWith('../'))) {
      fileImportMap[key] = value;
    } else if (value.startsWith('http://') || value.startsWith('https://')) {
      urlImportMap[key] = value;
    }
  }
}

try {
  const denoJsonPath = pathResolve(projectRoot, 'deno.json');
  const denoJson = JSON.parse(readFileSync(denoJsonPath, 'utf-8'));
  addImports(denoJson.imports, { includeFile: true });
} catch (e) {
  console.warn('Could not read deno.json:', e.message);
}

try {
  const cwdDenoJsonPath = pathResolve(process.cwd(), 'deno.json');
  const cwdDenoJson = JSON.parse(readFileSync(cwdDenoJsonPath, 'utf-8'));
  addImports(cwdDenoJson.imports, { includeFile: false });
} catch {
  // Ignore missing or invalid cwd deno.json
}

// Read package.json imports (these take priority for @std/* since they point to shims)
try {
  const packageJsonPath = pathResolve(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const pkgImports = packageJson.imports || {};

  // Merge package.json imports, giving them priority
  for (const [key, value] of Object.entries(pkgImports)) {
    if (typeof value === 'string' && (value.startsWith('./') || value.startsWith('../'))) {
      fileImportMap[key] = value;
    }
  }
} catch (e) {
  console.warn('Could not read package.json:', e.message);
}

function resolveFromImportMap(specifier) {
  // 1. Direct match (highest priority)
  if (fileImportMap[specifier]) {
    return fileImportMap[specifier];
  }

  // 2. Prefix match with wildcard (e.g., @veryfront/testing/* -> ./src/testing/*.ts)
  for (const [prefix, target] of Object.entries(fileImportMap)) {
    if (prefix.endsWith('/*') && specifier.startsWith(prefix.slice(0, -1))) {
      let suffix = specifier.slice(prefix.length - 1);
      // If target ends with *.ts and suffix also ends with .ts, strip .ts from suffix
      // to avoid double extensions (e.g., env.ts -> env.ts.ts)
      if (target.endsWith('*.ts') && suffix.endsWith('.ts')) {
        suffix = suffix.slice(0, -3);
      }
      return target.replace('*', suffix);
    }
  }

  // 3. Prefix match without wildcard (e.g., @veryfront/ -> ./src/)
  for (const [prefix, target] of Object.entries(fileImportMap)) {
    if (prefix.endsWith('/') && !prefix.endsWith('/*') && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

function resolveFromUrlImportMap(specifier) {
  // 1. Direct match (highest priority)
  if (urlImportMap[specifier]) {
    return urlImportMap[specifier];
  }

  // 2. Prefix match with wildcard
  for (const [prefix, target] of Object.entries(urlImportMap)) {
    if (prefix.endsWith('/*') && specifier.startsWith(prefix.slice(0, -1))) {
      const suffix = specifier.slice(prefix.length - 1);
      return target.replace('*', suffix);
    }
  }

  // 3. Prefix match without wildcard
  for (const [prefix, target] of Object.entries(urlImportMap)) {
    if (prefix.endsWith('/') && !prefix.endsWith('/*') && specifier.startsWith(prefix)) {
      const suffix = specifier.slice(prefix.length);
      return target + suffix;
    }
  }

  return null;
}

function findActualFile(relativePath) {
  const fullPath = pathResolve(projectRoot, relativePath);

  // Direct path exists
  if (existsSync(fullPath)) {
    const stats = statSync(fullPath);
    if (stats.isFile()) return fullPath;
    // If it's a directory, try index.ts or index.tsx
    if (stats.isDirectory()) {
      if (existsSync(pathResolve(fullPath, 'index.ts'))) return pathResolve(fullPath, 'index.ts');
      if (existsSync(pathResolve(fullPath, 'index.tsx'))) return pathResolve(fullPath, 'index.tsx');
    }
  }

  // Try adding .ts extension
  if (existsSync(fullPath + '.ts')) return fullPath + '.ts';
  // Try adding .tsx extension
  if (existsSync(fullPath + '.tsx')) return fullPath + '.tsx';

  // Try index.ts in directory
  if (existsSync(pathResolve(fullPath, 'index.ts'))) return pathResolve(fullPath, 'index.ts');
  // Try index.tsx in directory
  if (existsSync(pathResolve(fullPath, 'index.tsx'))) return pathResolve(fullPath, 'index.tsx');

  // If path ends with .ts, try without it (might be directory)
  if (relativePath.endsWith('.ts')) {
    const withoutTs = relativePath.slice(0, -3);
    const dirPath = pathResolve(projectRoot, withoutTs);
    if (existsSync(dirPath + '.ts')) return dirPath + '.ts';
    if (existsSync(dirPath + '.tsx')) return dirPath + '.tsx';
    if (existsSync(pathResolve(dirPath, 'index.ts'))) return pathResolve(dirPath, 'index.ts');
    if (existsSync(pathResolve(dirPath, 'index.tsx'))) return pathResolve(dirPath, 'index.tsx');
  }

  return null;
}

const DEBUG = process.env.DEBUG_RESOLVER === '1';

// Lazy-load esbuild for .tsx transformation
let esbuild = null;
async function getEsbuild() {
  if (!esbuild) {
    esbuild = await import('esbuild');
  }
  return esbuild;
}

const HTTP_CACHE_DIR = join(tmpdir(), 'veryfront-http-cache');

function getHttpCacheKey(url) {
  return createHash('sha256').update(url).digest('hex').slice(0, 16);
}

function getHttpCachePath(url) {
  let ext = '.mjs';
  try {
    const pathname = new URL(url).pathname;
    const pathExt = extname(pathname);
    if (pathExt) ext = pathExt;
  } catch {
    // Ignore URL parse errors, keep default extension
  }
  return join(HTTP_CACHE_DIR, `${getHttpCacheKey(url)}${ext}`);
}

async function readFromHttpCache(url) {
  try {
    return await readFile(getHttpCachePath(url), 'utf-8');
  } catch {
    return null;
  }
}

async function writeToHttpCache(url, content) {
  try {
    await mkdir(HTTP_CACHE_DIR, { recursive: true });
    await writeFile(getHttpCachePath(url), content, 'utf-8');
  } catch (error) {
    if (DEBUG) {
      console.error(`[http-cache] Failed to cache ${url}:`, error.message || error);
    }
  }
}

async function fetchHttpModule(url) {
  const cached = await readFromHttpCache(url);
  if (cached) return cached;

  const response = await fetch(url, {
    headers: {
      Accept: 'application/javascript, text/javascript, */*',
      'User-Agent': 'veryfront-node-loader/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }

  const content = await response.text();
  await writeToHttpCache(url, content);
  return content;
}

export async function resolve(specifier, context, nextResolve) {
  // Strip query strings from specifier for matching (used by dynamic imports like ?ts=...)
  let cleanSpecifier = specifier;
  const queryIndex = specifier.indexOf('?');
  if (queryIndex > 0) {
    cleanSpecifier = specifier.slice(0, queryIndex);
  }

  // Handle HTTP(S) URLs
  if (cleanSpecifier.startsWith('https://') || cleanSpecifier.startsWith('http://')) {
    return {
      shortCircuit: true,
      url: specifier,
      format: 'module',
    };
  }

  // Handle npm: protocol (Deno-specific) -> strip npm: prefix
  if (cleanSpecifier.startsWith('npm:')) {
    const packageSpec = cleanSpecifier.slice(4);
    // Handle npm:package@version -> package
    const atIndex = packageSpec.indexOf('@', 1); // Skip potential @scope
    const packageName = atIndex > 0 ? packageSpec.slice(0, atIndex) : packageSpec;
    return nextResolve(packageName, context);
  }

  const hasHttpParent = context.parentURL?.startsWith('https://') ||
    context.parentURL?.startsWith('http://');

  if (hasHttpParent) {
    // Resolve relative/absolute paths from HTTP parents
    if (
      cleanSpecifier.startsWith('./') ||
      cleanSpecifier.startsWith('../') ||
      cleanSpecifier.startsWith('/')
    ) {
      const resolved = new URL(specifier, context.parentURL).href;
      return {
        shortCircuit: true,
        url: resolved,
        format: 'module',
      };
    }

    // Allow built-ins to resolve normally
    if (
      cleanSpecifier.startsWith('node:') ||
      cleanSpecifier.startsWith('data:') ||
      cleanSpecifier.startsWith('file:') ||
      cleanSpecifier.startsWith('bun:')
    ) {
      return nextResolve(specifier, context);
    }

    // Map bare specifiers from HTTP modules using import map, fallback to esm.sh
    const mappedUrl = resolveFromUrlImportMap(cleanSpecifier);
    const fallbackUrl = `https://esm.sh/${specifier}`;
    return {
      shortCircuit: true,
      url: mappedUrl ?? fallbackUrl,
      format: 'module',
    };
  }

  // Debug: log all specifiers containing certain keywords
  if (DEBUG && (cleanSpecifier.includes('veryfront') || cleanSpecifier.includes('errors') || cleanSpecifier.includes('@std'))) {
    console.error(`[resolver] CHECKING: "${cleanSpecifier}" from ${context.parentURL || 'unknown'}`);
  }

  // Handle @veryfront and @std imports
  if (cleanSpecifier.startsWith('@veryfront/') || cleanSpecifier.startsWith('@veryfront') ||
      cleanSpecifier.startsWith('@std/') || cleanSpecifier.startsWith('veryfront/')) {
    const mapped = resolveFromImportMap(cleanSpecifier);
    if (DEBUG) {
      console.error(`[resolver] ${cleanSpecifier} -> mapped: ${mapped}`);
    }
    if (mapped) {
      const actualPath = findActualFile(mapped.replace(/^\.\//, ''));
      if (DEBUG) {
        console.error(`[resolver] ${cleanSpecifier} -> actualPath: ${actualPath}`);
      }
      if (actualPath) {
        return {
          shortCircuit: true,
          url: pathToFileURL(actualPath).href,
        };
      }
    }
  }

  // Apply URL import map for bare specifiers (esm.sh URLs in deno.json)
  const isBare = !cleanSpecifier.startsWith('.') &&
    !cleanSpecifier.startsWith('/') &&
    !cleanSpecifier.startsWith('file:') &&
    !cleanSpecifier.startsWith('data:') &&
    !cleanSpecifier.startsWith('node:') &&
    !cleanSpecifier.startsWith('bun:');
  if (isBare) {
    const mappedUrl = resolveFromUrlImportMap(cleanSpecifier);
    if (mappedUrl) {
      if (DEBUG) {
        console.error(`[resolver] URL import map: ${cleanSpecifier} -> ${mappedUrl}`);
      }
      return {
        shortCircuit: true,
        url: mappedUrl,
        format: 'module',
      };
    }
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('https://') || url.startsWith('http://')) {
    const source = await fetchHttpModule(url);
    return {
      shortCircuit: true,
      format: 'module',
      source,
    };
  }

  // Handle .tsx files - transform with esbuild
  if (url.startsWith('file://') && url.endsWith('.tsx')) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, 'utf-8');

    try {
      const es = await getEsbuild();
      const result = await es.transform(source, {
        loader: 'tsx',
        format: 'esm',
        target: 'esnext',
        jsx: 'automatic',
        sourcefile: filePath,
      });

      return {
        shortCircuit: true,
        format: 'module',
        source: result.code,
      };
    } catch (error) {
      console.error(`[loader] Failed to transform ${filePath}:`, error.message);
      throw error;
    }
  }

  return nextLoad(url, context);
}
