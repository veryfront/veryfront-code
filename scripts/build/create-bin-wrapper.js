#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, "..", "..", "veryfront", "bin", "veryfront.js"),
  join(here, "..", "node_modules", "veryfront", "bin", "veryfront.js"),
];

const veryfrontBin = candidates.find((candidate) => existsSync(candidate));
if (!veryfrontBin) {
  console.error("Could not find the veryfront CLI. Reinstall create-veryfront and try again.");
  process.exit(1);
}

const child = spawn(process.execPath, [veryfrontBin, "init", ...process.argv.slice(2)], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
