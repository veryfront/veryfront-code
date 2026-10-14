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

let launcherCommand = "cli";

function selectedProjectDirectory() {
  const args = process.argv.slice(2);
  // -d is a directory for CommonArgs.projectDir commands, but debug for dev.
  const directoryAliasCommands = new Set([
    "analyze-chunks",
    "clean",
    "deploy",
    "env",
    "files",
    "integration",
    "knowledge",
    "project",
    "projects",
    "pull",
    "push",
    "routes",
    "schedule",
    "up",
    "uploads",
    "webhook",
  ]);
  let command;
  // Mirror the canonical CLI Boolean arity; unknown options take a value.
  // The source-parity test rejects drift from cli/shared/args.ts.
  const booleanFlags = new Set([
    "accept-dispatch",
    "adopt-new-deps",
    "all",
    "auto",
    "binary",
    "build",
    "cache",
    "check",
    "clear",
    "color",
    "compress",
    "debug",
    "delete",
    "deploy",
    "dry-run",
    "force",
    "github",
    "global",
    "google",
    "headless",
    "help",
    "hmr",
    "json",
    "list",
    "microsoft",
    "ndjson",
    "no-adopt-pins",
    "no-animation",
    "no-browser",
    "no-color",
    "no-compress",
    "no-gpg-sign",
    "no-hmr",
    "no-input",
    "no-split",
    "no-ssg",
    "no-tui",
    "okf-bundle",
    "open",
    "parallel",
    "prefetch",
    "prune",
    "quiet",
    "recursive",
    "remote",
    "require-export",
    "site",
    "skip-env-prompt",
    "skip-install",
    "split",
    "ssg",
    "strict",
    "studio",
    "token",
    "update",
    "verbose",
    "verify",
    "version",
    "yes",
  ]);
  const shortBooleanFlags = new Set(["h", "v", "q", "f", "s", "j", "y"]);
  for (let index = 0; index < args.length && args[index] !== "--"; index++) {
    const arg = args[index];
    if (!arg.startsWith("-")) {
      command = arg;
      break;
    }
    const key = arg.replace(/^-+/, "").split("=")[0];
    if (
      !arg.includes("=") && !booleanFlags.has(key) &&
      !shortBooleanFlags.has(key) && args[index + 1] &&
      !args[index + 1].startsWith("-")
    ) index++;
  }
  launcherCommand = command ?? "cli";
  let project;
  let projectDirectory;
  for (let index = 0; index < args.length && args[index] !== "--"; index++) {
    const arg = args[index];
    const directoryKeys = directoryAliasCommands.has(command)
      ? ["--project-dir", "--dir", "-d"]
      : ["--project-dir", "--dir"];
    const key = ["--project", ...directoryKeys].find((name) =>
      arg === name || arg.startsWith(`${name}=`)
    );
    if (key) {
      const value = arg === key ? args[++index] : arg.slice(key.length + 1);
      if (!value || value.startsWith("--")) {
        throw new Error(`${key} requires a project directory`);
      }
      if (key !== "--project") {
        projectDirectory = resolve(process.cwd(), value);
      } else project = resolve(process.cwd(), value);
    }
  }
  // Explicit project-dir belongs to every project-aware command, including
  // schedule, routes and local task execution.
  if (projectDirectory) return projectDirectory;
  if (command === "dev" || command === "lock") return project ?? process.cwd();
  if (command === "start" || command === undefined) {
    return project ?? process.cwd();
  }
  return process.cwd();
}

function findProjectPnp() {
  let directory = selectedProjectDirectory();
  while (true) {
    const candidate = join(directory, ".pnp.cjs");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function resolveProjectCli() {
  const issuer = join(selectedProjectDirectory(), "package.json");
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

function prepareProjectLaunch() {
  const pnpStartup = findProjectPnp();
  let needsPnpStartup = false;
  if (pnpStartup && !process.versions.pnp) {
    const issuer = join(selectedProjectDirectory(), "package.json");
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
    const loader = join(dirname(pnpStartup), ".pnp.loader.mjs");
    if (!existsSync(loader)) {
      throw new Error(
        "Enable pnpEnableEsmLoader in .yarnrc.yml and run yarn install for the project CLI",
      );
    }
    return { pnpStartup, loader };
  }
  return { projectCli: resolveProjectCli() };
}
function launcherJsonMode() {
  let enabled = false;
  let ndjsonEnabled = false;
  for (const arg of process.argv.slice(2)) {
    if (arg === "--") break;
    if (arg === "--ndjson") ndjsonEnabled = true;
    else if (arg.startsWith("--ndjson=")) {
      const value = arg.slice("--ndjson=".length).trim().toLowerCase();
      ndjsonEnabled = !["false", "0", "no", "off", ""].includes(value);
    } else if (arg === "--json" || arg === "-j") enabled = true;
    else if (arg.startsWith("--json=")) {
      const value = arg.slice("--json=".length).trim().toLowerCase();
      enabled = !["false", "0", "no", "off", ""].includes(value);
    }
  }
  return enabled || ndjsonEnabled;
}

function failProjectLaunch(error) {
  const messages = new Set([
    "Enable pnpEnableEsmLoader in .yarnrc.yml and run yarn install for the project CLI",
    "Invalid project Veryfront package identity",
    "Project Veryfront installation has no valid CLI entry",
    "Project Veryfront CLI entry escapes its package",
    "Invalid project Plug'n'Play API",
    "Project Plug'n'Play framework resolution failed",
  ]);
  const message =
    typeof error?.message === "string" && messages.has(error.message)
      ? error.message
      : "Project CLI setup failed; verify the project directory and reinstall its dependencies";
  if (launcherJsonMode()) {
    console.log(JSON.stringify({
      success: false,
      command: launcherCommand,
      error: { code: "RUNTIME_ERROR", slug: "command-failed", message },
    }));
  } else console.error(message);
  process.exit(1);
}

let launch;
try {
  launch = prepareProjectLaunch();
} catch (error) {
  failProjectLaunch(error);
}
if (launch.pnpStartup) {
  const { pnpStartup, loader } = launch;
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
  const { projectCli } = launch;
  if (projectCli) {
    // Select the whole project framework graph before global polyfills or React
    // imports load. This keeps framework contexts and the renderer on one peer.
    process.argv[1] = projectCli;
    try {
      await import(pathToFileURL(projectCli).href);
    } catch (error) {
      failProjectLaunch(error);
    }
  } else {
    await import("../esm/_dnt.polyfills.js");
    if (existsSync(nativeBinary)) {
      const child = spawn(nativeBinary, process.argv.slice(2), {
        stdio: "inherit",
      });
      child.on("close", (code) => process.exit(code ?? 0));
      child.on("error", () =>
        runJsFallback().catch(failProjectLaunch));
    } else {
      runJsFallback().catch(failProjectLaunch);
    }
  }
}
