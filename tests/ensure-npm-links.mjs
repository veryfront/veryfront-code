import { existsSync, readdirSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveDirectoryLinkType(platform = process.platform) {
  return platform === "win32" ? "junction" : "dir";
}

export function ensureDirectoryLink(
  sourcePath,
  targetPath,
  packageName,
  { pathExists = existsSync, createSymlink = symlinkSync } = {},
) {
  if (pathExists(targetPath)) return;
  try {
    createSymlink(sourcePath, targetPath, resolveDirectoryLinkType());
  } catch (error) {
    if (error?.code === "EEXIST") return;
    throw new Error(`Cannot link npm dependency "${packageName}" into node_modules.`, {
      cause: error,
    });
  }
}

function linkTopLevelPackage(npmModulesRoot, rootModulesRoot, packageName) {
  const sourcePath = resolve(npmModulesRoot, packageName);
  const targetPath = resolve(rootModulesRoot, packageName);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `npm dependency "${packageName}" disappeared while links were prepared.`,
    );
  }
  ensureDirectoryLink(sourcePath, targetPath, packageName);
}

function linkScopedPackages(npmModulesRoot, rootModulesRoot, scopeName) {
  const sourceScopeDir = resolve(npmModulesRoot, scopeName);
  const targetScopeDir = resolve(rootModulesRoot, scopeName);
  if (!existsSync(sourceScopeDir)) return;

  if (!existsSync(targetScopeDir)) {
    ensureDirectoryLink(sourceScopeDir, targetScopeDir, scopeName);
    if (existsSync(targetScopeDir)) return;
  }

  let entries;
  try {
    entries = readdirSync(sourceScopeDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot read npm dependency scope "${scopeName}".`, {
      cause: error,
    });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = resolve(sourceScopeDir, entry.name);
    const targetPath = resolve(targetScopeDir, entry.name);
    ensureDirectoryLink(sourcePath, targetPath, `${scopeName}/${entry.name}`);
  }
}

export function ensureNpmNodeModulesLinks(
  rootDir = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
) {
  const npmModulesRoot = resolve(rootDir, "npm", "node_modules");
  const rootModulesRoot = resolve(rootDir, "node_modules");
  if (!existsSync(npmModulesRoot)) {
    throw new Error(
      'Cannot prepare runtime tests because npm/node_modules is missing. Run "deno task build:npm" first.',
    );
  }
  if (!existsSync(rootModulesRoot)) {
    throw new Error(
      'Cannot prepare runtime tests because node_modules is missing. Run "deno install" first.',
    );
  }

  let entries;
  try {
    entries = readdirSync(npmModulesRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(
      "Cannot read npm/node_modules while preparing runtime tests.",
      {
        cause: error,
      },
    );
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
