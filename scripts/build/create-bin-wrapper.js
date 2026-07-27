#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { constants as osConstants } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));

export function exitCodeForSignal(signal) {
  const signalNumber = osConstants.signals?.[signal];
  return signalNumber ? 128 + signalNumber : 1;
}

export function exitFromChildStatus(
  code,
  signal,
  { killSelf = process.kill, exit = process.exit } = {},
) {
  if (signal) {
    try {
      killSelf(process.pid, signal);
    } catch {
      exit(exitCodeForSignal(signal));
    }
    return;
  }

  exit(code ?? 1);
}

export function runCreateVeryfront(args = process.argv.slice(2)) {
  const candidates = [
    join(here, "..", "..", "veryfront", "bin", "veryfront.js"),
    join(here, "..", "node_modules", "veryfront", "bin", "veryfront.js"),
  ];

  const veryfrontBin = candidates.find((candidate) => existsSync(candidate));
  if (!veryfrontBin) {
    console.error(
      "Could not find the veryfront CLI. Reinstall create-veryfront and try again.",
    );
    process.exit(1);
  }

  const child = spawn(process.execPath, [veryfrontBin, "init", ...args], {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    exitFromChildStatus(code, signal);
  });

  child.on("error", (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

if (
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCreateVeryfront();
}
