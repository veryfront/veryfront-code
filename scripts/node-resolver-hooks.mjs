/**
 * Simplified Node.js ESM resolver hooks for import aliasing.
 *
 * This hook now ONLY handles:
 * 1. @veryfront/* aliases → ./src/* paths
 * 2. @std/* aliases → ./src/platform/compat/std/* shims
 * 3. npm: protocol stripping (for Deno compat)
 *
 * React and HTTP modules are now handled by shared facades (src/react/shared-*.ts)
 * which pre-cache esm.sh modules to file:// paths.
 *
 * Note: To fully eliminate this hook, migrate imports to use # prefix:
 * - @veryfront/* → #veryfront/*
 * - @std/* → #std/*
 * Then package.json imports field will work natively.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve as pathResolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = pathResolve(__dirname, '..');

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

  // 2. Prefix match with wildcard (e.g., @veryfront/testing/* -> ./src/testing/*.ts)
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

  // 3. Prefix match without wildcard (e.g., @veryfront/ -> ./src/)
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

  // Handle @veryfront/* and @std/* imports via import map
  if (
    cleanSpecifier.startsWith('@veryfront/') ||
    cleanSpecifier.startsWith('@veryfront') ||
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

  // Let Node.js handle everything else (including react, react-dom via node_modules)
  return nextResolve(specifier, context);
}

// No custom load hook needed anymore:
// - React/HTTP modules are handled by shared facades
// - .tsx files are handled by --experimental-transform-types
