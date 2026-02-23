#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

await import("../esm/_dnt.polyfills.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const nativeBinary = join(
  __dirname,
  process.platform === "win32" ? "veryfront.exe" : "veryfront",
);

async function runJsFallback() {
  await import("../esm/cli/main.js");
}

if (existsSync(nativeBinary)) {
  const child = spawn(nativeBinary, process.argv.slice(2), {
    stdio: "inherit",
  });
  child.on("close", (code) => process.exit(code ?? 0));
  child.on("error", () =>
    runJsFallback().catch((err) => {
      console.error(err);
      process.exit(1);
    }),
  );
} else {
  runJsFallback().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
