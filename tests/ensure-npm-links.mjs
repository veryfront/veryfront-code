import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
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

function linkVendoredJsrPackages(rootDir, rootModulesRoot) {
  const configPath = resolve(rootDir, "deno.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new TypeError(`${configPath} must contain a JSON object`);
  }
  if (!config.imports || typeof config.imports !== "object") {
    throw new TypeError(`${configPath} must contain an imports object`);
  }

  const packages = new Map();
  for (const target of Object.values(config.imports)) {
    if (typeof target !== "string") continue;
    const match = target.match(/^jsr:(@[^/]+\/[^@/]+)@([^/]+)/);
    if (!match) continue;
    const [, packageName, version] = match;
    const existingVersion = packages.get(packageName);
    if (existingVersion && existingVersion !== version) {
      throw new Error(
        `Cannot link multiple JSR versions for ${packageName}: ` +
          `${existingVersion} and ${version}`,
      );
    }
    packages.set(packageName, version);
  }

  for (const [packageName, version] of packages) {
    const sourcePath = resolve(
      rootDir,
      "npm/esm/deps/jsr.io",
      packageName,
      version,
    );
    if (!existsSync(sourcePath)) continue;

    const targetPath = resolve(rootModulesRoot, packageName);
    if (existsSync(targetPath)) continue;
    mkdirSync(dirname(targetPath), { recursive: true });
    ensureDirectorySymlink(sourcePath, targetPath);
  }
}

function linkBuiltWorkspacePackages(rootDir, rootModulesRoot) {
  const configPath = resolve(rootDir, "deno.json");
  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  if (!config || typeof config !== "object" || !Array.isArray(config.workspace)) {
    throw new TypeError(`${configPath} must contain a workspace array`);
  }

  for (const workspacePath of config.workspace) {
    if (typeof workspacePath !== "string") {
      throw new TypeError(`${configPath} workspace entries must be strings`);
    }

    const sourcePath = resolve(rootDir, "npm", workspacePath);
    const packageConfigPath = resolve(sourcePath, "package.json");
    if (!existsSync(packageConfigPath)) continue;

    const packageConfig = JSON.parse(readFileSync(packageConfigPath, "utf-8"));
    const packageName = packageConfig?.name;
    if (typeof packageName !== "string") continue;

    const targetPath = resolve(rootModulesRoot, packageName);
    if (existsSync(targetPath)) continue;
    mkdirSync(dirname(targetPath), { recursive: true });
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

  ensureDirectorySymlink(
    resolve(rootDir, "npm"),
    resolve(rootModulesRoot, "veryfront"),
  );
  linkVendoredJsrPackages(rootDir, rootModulesRoot);
  linkBuiltWorkspacePackages(rootDir, rootModulesRoot);
}
