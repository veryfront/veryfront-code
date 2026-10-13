#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import * as nodeModule from "node:module";
import process from "node:process";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  formatUnsupportedNodeMessage,
  meetsMinimumNodeVersion,
} from "./node-engine-precondition.js";

function checkedProjectCli(packageFile, pnpApi) {
  const preserveVirtualPath = pnpApi !== undefined;
  const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
  if (pkg.name !== "veryfront") {
    throw new Error("Invalid project Veryfront package identity");
  }
  const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.veryfront;
  if (typeof bin !== "string" || !bin || isAbsolute(bin)) {
    throw new Error("Project Veryfront installation has no valid CLI entry");
  }
  const packageRoot = dirname(packageFile);
  const entry = resolve(packageRoot, bin);
  const entryRelative = relative(packageRoot, entry);
  const physicalRoot = realpathSync(packageRoot);
  const physicalEntry = realpathSync(entry);
  const physicalRelative = relative(physicalRoot, physicalEntry);
  if (
    [entryRelative, physicalRelative].some((value) =>
      isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`)
    )
  ) {
    throw new Error("Project Veryfront CLI entry escapes its package");
  }
  // PnP virtual paths encode peer ownership even when their physical bytes are
  // shared. Preserve that issuer for the ESM loader and createRequire.
  const selected = preserveVirtualPath ? entry : physicalEntry;
  const self = preserveVirtualPath
    ? fileURLToPath(import.meta.url)
    : realpathSync(fileURLToPath(import.meta.url));
  if (selected === self) return undefined;
  if (physicalEntry === realpathSync(fileURLToPath(import.meta.url))) {
    if (!pnpApi || typeof pnpApi.findPackageLocator !== "function") {
      return undefined;
    }
    const targetLocator = pnpApi.findPackageLocator(entry);
    const selfLocator = pnpApi.findPackageLocator(
      fileURLToPath(import.meta.url),
    );
    if (
      targetLocator && selfLocator && targetLocator.name === selfLocator.name &&
      targetLocator.reference === selfLocator.reference
    ) return undefined;
  }
  return selected;
}

function findProjectPnp() {
  let directory = process.cwd();
  while (true) {
    const candidate = join(directory, ".pnp.cjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolveProjectCli() {
  const issuer = join(process.cwd(), "package.json");
  const require = createRequire(issuer);
  const pnpFile = findProjectPnp();
  if (pnpFile) {
    const api = require(pnpFile);
    if (
      typeof api.setup !== "function" ||
      typeof api.resolveToUnqualified !== "function"
    ) throw new Error("Invalid project Plug'n'Play API");

    let root;
    try {
      root = api.resolveToUnqualified("veryfront", issuer);
    } catch (error) {
      if (error?.pnpCode === "UNDECLARED_DEPENDENCY") return undefined;
      throw error;
    }
    if (typeof root !== "string") {
      throw new Error("Project Plug'n'Play framework resolution failed");
    }
    const entry = checkedProjectCli(join(root, "package.json"), api);
    if (!entry) return undefined;
    const loader = join(dirname(pnpFile), ".pnp.loader.mjs");
    if (!existsSync(loader)) {
      throw new Error(
        "Enable pnpEnableEsmLoader in .yarnrc.yml and run yarn install for the project CLI",
      );
    }
    if (typeof nodeModule.register !== "function") {
      throw new Error(formatUnsupportedNodeMessage(process.versions.node));
    }
    nodeModule.register(pathToFileURL(loader).href, import.meta.url);
    return entry;
  }
  for (const root of require.resolve.paths("veryfront") ?? []) {
    const packageFile = join(root, "veryfront", "package.json");
    if (existsSync(packageFile)) return checkedProjectCli(packageFile);
  }
  return undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeBinary = join(
  __dirname,
  process.platform === "win32" ? "veryfront.exe" : "veryfront",
);

async function runJsFallback() {
  // Only the bundled JS CLI needs a modern Node: the compat layer reads
  // process.getBuiltinModule (Node 22.3.0+) while its module graph loads and
  // otherwise throws an internal assertion with no version, fix or docs link.
  // The native binary above is self-contained, so it stays ungated.
  if (!meetsMinimumNodeVersion(process.versions.node)) {
    console.error(formatUnsupportedNodeMessage(process.versions.node));
    process.exit(1);
  }
  await import("../esm/cli/main.js");
}

const pnpStartup = findProjectPnp();
let needsPnpStartup = false;
if (pnpStartup && !process.versions.pnp) {
  const issuer = join(process.cwd(), "package.json");
  const api = createRequire(issuer)(pnpStartup);
  if (typeof api.resolveToUnqualified !== "function") {
    throw new Error("Invalid project Plug'n'Play API");
  }
  try {
    needsPnpStartup =
      typeof api.resolveToUnqualified("veryfront", issuer) === "string";
  } catch (error) {
    if (error?.pnpCode !== "UNDECLARED_DEPENDENCY") throw error;
  }
}
if (needsPnpStartup) {
  // Install PnP before Node initializes its ESM/CJS filesystem bindings. Late
  // monkey-patching cannot safely load zip-backed CommonJS peers on Node 24.
  const loader = join(dirname(pnpStartup), ".pnp.loader.mjs");
  if (!existsSync(loader)) {
    throw new Error(
      "Enable pnpEnableEsmLoader in .yarnrc.yml and run yarn install for the project CLI",
    );
  }
  const child = spawn(process.execPath, [
    ...process.execArgv,
    "--require",
    pnpStartup,
    "--experimental-loader",
    loader,
    fileURLToPath(import.meta.url),
    ...process.argv.slice(2),
  ], { stdio: "inherit" });
  const forwardSignal = (signal) => child.kill(signal);
  const onInterrupt = () => forwardSignal("SIGINT");
  const onTerminate = () => forwardSignal("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  child.once("error", (error) => {
    console.error(error);
    process.exit(1);
  });
  child.once("exit", (code, signal) => {
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
} else {
  const projectCli = resolveProjectCli();
  if (projectCli) {
    // Select the whole project framework graph before global polyfills or React
    // imports load. This keeps framework contexts and the renderer on one peer.
    process.argv[1] = projectCli;
    await import(pathToFileURL(projectCli).href);
  } else {
    await import("../esm/_dnt.polyfills.js");
    if (existsSync(nativeBinary)) {
      const child = spawn(nativeBinary, process.argv.slice(2), {
        stdio: "inherit",
      });
      child.on("close", (code) => process.exit(code ?? 0));
      child.on("error", () =>
        runJsFallback().catch((err) => {
          console.error(err);
          process.exit(1);
        }));
    } else {
      runJsFallback().catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
  }
}
