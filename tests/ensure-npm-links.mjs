import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function ensureDirectorySymlink(sourcePath, targetPath) {
  if (existsSync(targetPath)) return;
  try {
    symlinkSync(sourcePath, targetPath, "dir");
  } catch {
    // Best effort; tests can still rely on existing node_modules resolution.
  }
}

function linkTopLevelPackage(npmModulesRoot, rootModulesRoot, packageName) {
  const sourcePath = resolve(npmModulesRoot, packageName);
  const targetPath = resolve(rootModulesRoot, packageName);
  if (!existsSync(sourcePath)) return;
  ensureDirectorySymlink(sourcePath, targetPath);
}

function linkScopedPackages(npmModulesRoot, rootModulesRoot, scopeName) {
  const sourceScopeDir = resolve(npmModulesRoot, scopeName);
  const targetScopeDir = resolve(rootModulesRoot, scopeName);
  if (!existsSync(sourceScopeDir)) return;

  if (!existsSync(targetScopeDir)) {
    ensureDirectorySymlink(sourceScopeDir, targetScopeDir);
    if (existsSync(targetScopeDir)) return;
  }

  let entries;
  try {
    entries = readdirSync(sourceScopeDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = resolve(sourceScopeDir, entry.name);
    const targetPath = resolve(targetScopeDir, entry.name);
    ensureDirectorySymlink(sourcePath, targetPath);
  }
}

export function ensureNpmNodeModulesLinks() {
  const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const npmModulesRoot = resolve(rootDir, "npm", "node_modules");
  const rootModulesRoot = resolve(rootDir, "node_modules");
  if (!existsSync(npmModulesRoot) || !existsSync(rootModulesRoot)) return;

  let entries;
  try {
    entries = readdirSync(npmModulesRoot, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      linkScopedPackages(npmModulesRoot, rootModulesRoot, entry.name);
      continue;
    }
    linkTopLevelPackage(npmModulesRoot, rootModulesRoot, entry.name);
  }
}
