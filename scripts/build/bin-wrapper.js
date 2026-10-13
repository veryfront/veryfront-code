#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  formatUnsupportedNodeMessage,
  meetsMinimumNodeVersion,
} from "./node-engine-precondition.js";

function resolveProjectCli() {
  const require = createRequire(join(process.cwd(), "package.json"));
  const roots = require.resolve.paths("veryfront") ?? [];
  for (const root of roots) {
    const packageFile = join(root, "veryfront", "package.json");
    if (!existsSync(packageFile)) continue;
    const pkg = JSON.parse(readFileSync(packageFile, "utf8"));
    if (pkg.name !== "veryfront") {
      throw new Error("Invalid project Veryfront package identity");
    }
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.veryfront;
    if (typeof bin !== "string" || !bin || isAbsolute(bin)) {
      throw new Error("Project Veryfront installation has no valid CLI entry");
    }
    const packageRoot = realpathSync(dirname(packageFile));
    const entry = realpathSync(resolve(packageRoot, bin));
    const entryRelative = relative(packageRoot, entry);
    if (
      isAbsolute(entryRelative) || entryRelative === ".." ||
      entryRelative.startsWith(`..${sep}`)
    ) {
      throw new Error("Project Veryfront CLI entry escapes its package");
    }
    return entry === realpathSync(fileURLToPath(import.meta.url))
      ? undefined
      : entry;
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
