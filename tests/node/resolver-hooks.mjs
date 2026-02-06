/**
 * Minimal Node.js ESM resolver hooks for TypeScript extension resolution.
 *
 * This hook now ONLY handles:
 * 1. TypeScript extension resolution (.ts, .tsx, index.ts)
 * 2. npm: protocol stripping (for Deno compat)
 *
 * Import aliasing (#veryfront/*, #std/*) is handled by package.json imports field.
 * React and HTTP modules are handled by shared facades (src/react/shared-*.ts).
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve as pathResolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, '../..');

// Build import map from deno.json and package.json
const fileImportMap = {};

function addImports(denoImports, options = { includeFile: true }) {
  const includeFile = options?.includeFile ?? true;
  for (const [key, value] of Object.entries(denoImports || {})) {
    if (typeof value !== 'string') continue;
    if (includeFile && (value.startsWith('./') || value.startsWith('../'))) {
      fileImportMap[key] = value;
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

  // 2. Prefix match with wildcard (e.g., #veryfront/testing/* -> ./src/testing/*.ts)
  for (const [prefix, target] of Object.entries(fileImportMap)) {
    if (prefix.endsWith('/*') && specifier.startsWith(prefix.slice(0, -1))) {
      let suffix = specifier.slice(prefix.length - 1);
      // If target ends with *.ts and suffix also ends with .ts, strip .ts from suffix
      if (target.endsWith('*.ts') && suffix.endsWith('.ts')) {
        suffix = suffix.slice(0, -3);
      }
      return target.replace('*', suffix);
    }
  }

  // 3. Prefix match without wildcard (e.g., #veryfront/ -> ./src/)
  for (const [prefix, target] of Object.entries(fileImportMap)) {
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
  if (existsSync(pathResolve(fullPath, 'index.tsx'))) return pathResolve(fullPath, 'index.tsx');

  // If path ends with .ts, try without it
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

export async function resolve(specifier, context, nextResolve) {
  // Strip query strings from specifier for matching
  let cleanSpecifier = specifier;
  const queryIndex = specifier.indexOf('?');
  if (queryIndex > 0) {
    cleanSpecifier = specifier.slice(0, queryIndex);
  }

  // Handle npm: protocol (Deno-specific) -> strip npm: prefix
  if (cleanSpecifier.startsWith('npm:')) {
    const packageSpec = cleanSpecifier.slice(4);
    const atIndex = packageSpec.indexOf('@', 1);
    const packageName = atIndex > 0 ? packageSpec.slice(0, atIndex) : packageSpec;
    return nextResolve(packageName, context);
  }

  // Handle @std/* and veryfront/* imports via import map
  if (
    cleanSpecifier.startsWith('@std/') ||
    cleanSpecifier.startsWith('veryfront/')
  ) {
    const mapped = resolveFromImportMap(cleanSpecifier);
    if (mapped) {
      const actualPath = findActualFile(mapped.replace(/^\.\//, ''));
      if (actualPath) {
        return {
          shortCircuit: true,
          url: pathToFileURL(actualPath).href,
        };
      }
    }
  }

  // Handle #veryfront/* and #std/* imports via import map for extension resolution
  // Package.json resolves the alias, but Node doesn't add .ts extensions
  if (
    cleanSpecifier.startsWith('#veryfront/') ||
    cleanSpecifier.startsWith('#veryfront') ||
    cleanSpecifier.startsWith('#std/') ||
    cleanSpecifier.startsWith('#testing')
  ) {
    const mapped = resolveFromImportMap(cleanSpecifier);
    if (mapped) {
      const actualPath = findActualFile(mapped.replace(/^\.\//, ''));
      if (actualPath) {
        return {
          shortCircuit: true,
          url: pathToFileURL(actualPath).href,
        };
      }
    }
  }

  // Let Node.js handle everything else (including react, react-dom via node_modules)
  return nextResolve(specifier, context);
}

// Lazy-load esbuild for TSX transformation
let esbuild = null;
async function getEsbuild() {
  if (!esbuild) {
    esbuild = await import('esbuild');
  }
  return esbuild;
}

/**
 * Custom load hook for TypeScript/TSX/JSX files.
 * Node's --experimental-strip-types doesn't support enums and other advanced TS features.
 * We use esbuild for full TypeScript transformation.
 */
export async function load(url, context, nextLoad) {
  // Only handle file:// URLs
  if (!url.startsWith('file://')) {
    return nextLoad(url, context);
  }

  const filePath = fileURLToPath(url);

  // Handle JSON files (Node requires import attributes for JSON)
  if (filePath.endsWith('.json')) {
    const source = readFileSync(filePath, 'utf-8');
    return {
      shortCircuit: true,
      format: 'json',
      source,
    };
  }

  // Determine the loader based on file extension
  let loader = null;
  if (filePath.endsWith('.tsx')) {
    loader = 'tsx';
  } else if (filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')) {
    loader = 'ts';
  } else if (filePath.endsWith('.jsx')) {
    loader = 'jsx';
  }

  // Transform TypeScript/TSX/JSX files with esbuild
  if (loader) {
    const source = readFileSync(filePath, 'utf-8');
    const esb = await getEsbuild();

    const result = await esb.transform(source, {
      loader,
      format: 'esm',
      sourcefile: filePath,
      jsx: 'automatic',
      jsxImportSource: 'react',
      target: 'node20',
    });

    return {
      shortCircuit: true,
      format: 'module',
      source: result.code,
    };
  }

  // Let Node handle everything else
  return nextLoad(url, context);
}
