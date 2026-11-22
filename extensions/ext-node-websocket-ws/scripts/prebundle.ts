#!/usr/bin/env -S deno run --frozen -A
/** Bundle the pinned ws implementation with optional native accelerators disabled. */
import { fileURLToPath } from "node:url";
import { build, stop } from "npm:esbuild@0.28.1";
import sourceIntegrity from "./ws-source-integrity.json" with { type: "json" };
const checkOnly = Deno.args.length === 1 && Deno.args[0] === "--check";
if (Deno.args.length !== (checkOnly ? 1 : 0)) throw new TypeError("Usage: prebundle.ts [--check]");
const root = new URL("../../../", import.meta.url);
const resolved = new URL(import.meta.resolve("ws"));
if (resolved.protocol !== "file:") {
  throw new TypeError("Expected a locally resolved frozen WebSocket package");
}
const packageRoot = new URL("./", resolved);
async function captureSourceGraph(): Promise<
  { digest: string; license: string; manifest: string }
> {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const readFile = async (relative: string): Promise<void> => {
    const url = new URL(relative, packageRoot);
    if (!(await Deno.lstat(url)).isFile) {
      throw new Error("WebSocket source inputs must be regular files");
    }
    files.set(relative, await Deno.readFile(url));
  };
  const walk = async (relative: string): Promise<void> => {
    for await (const entry of Deno.readDir(new URL(relative, packageRoot))) {
      const path = relative + entry.name;
      if (entry.isDirectory) await walk(path + "/");
      else if (entry.isFile) await readFile(path);
      else throw new Error("WebSocket source inputs must not contain symbolic links");
    }
  };
  await readFile("package.json");
  await readFile("LICENSE");
  await readFile("index.js");
  await readFile("wrapper.mjs");
  await walk("lib/");
  const rows: string[] = [];
  // Integrity rows use code-unit ordering, independent of the host locale.
  const paths = [...files.keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  for (const path of paths) {
    const bytes = files.get(path)!;
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex();
    rows.push(path + String.fromCharCode(0) + digest + String.fromCharCode(10));
  }
  if (files.size !== sourceIntegrity.sourceFileCount) {
    throw new Error("WebSocket source file count differs from the qualified package");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rows.join(""))),
  ).toHex();
  return {
    digest,
    license: new TextDecoder("utf-8", { fatal: true }).decode(files.get("LICENSE")!),
    manifest: new TextDecoder("utf-8", { fatal: true }).decode(files.get("package.json")!),
  };
}
const source = await captureSourceGraph();
if (source.digest !== sourceIntegrity.sourceGraphSha256) {
  throw new Error("WebSocket source differs from the qualified published archive");
}
const manifest = JSON.parse(source.manifest) as {
  name: string;
  version: string;
  main: string;
};
if (
  manifest.name !== sourceIntegrity.package || manifest.version !== sourceIntegrity.version ||
  manifest.main !== "index.js"
) {
  throw new Error("The WebSocket package does not expose the qualified entry");
}
const lock = JSON.parse(await Deno.readTextFile(new URL("deno.lock", root))) as {
  npm: Record<string, { integrity: string }>;
};
const identity = `${manifest.name}@${manifest.version}`;
const integrity = lock.npm[identity]?.integrity;
if (integrity !== sourceIntegrity.integrity) {
  throw new Error("WebSocket repository lock does not match the qualified package integrity");
}
const entry = new URL("wrapper.mjs", packageRoot);
let bundle: string;
try {
  const result = await build({
    entryPoints: [fileURLToPath(entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    minify: true,
    write: false,
    legalComments: "inline",
    define: {
      "process.env.WS_NO_BUFFER_UTIL": "true",
      "process.env.WS_NO_UTF_8_VALIDATE": "true",
    },
    banner: {
      js:
        'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
  });
  if (result.outputFiles.length !== 1) throw new Error("Expected one WebSocket runtime bundle");
  bundle = result.outputFiles[0]!.text;
} finally {
  await stop();
}
const bundleBytes = new TextEncoder().encode(bundle);
if (bundle.trim().length === 0 || bundleBytes.length > 128 * 1024) {
  throw new RangeError("WebSocket runtime must be nonempty and at most 128 KiB");
}
if (/process\.env|Deno\.env|bufferutil|utf-8-validate/.test(bundle)) {
  throw new Error("WebSocket runtime must not access host env or optional native modules");
}
const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bundleBytes)).toHex();
if ((await captureSourceGraph()).digest !== source.digest) {
  throw new Error("WebSocket source changed during bundling");
}
const license = source.license;
if (license.includes("*/")) throw new Error("Unexpected license comment delimiter");
const generated =
  `// deno-fmt-ignore-file\n// deno-lint-ignore-file -- Verified generated upstream WebSocket bundle.\n/**\n * Official ${identity}, with optional native accelerators disabled at build time.\n * Package integrity: ${integrity}\n * Upstream source SHA-256: ${source.digest}
 * Bundle SHA-256: ${digest}\n * Generated by extensions/ext-node-websocket-ws/scripts/prebundle.ts.\n *\n${
    license.split("\n").map((line) => line.length > 0 ? " * " + line.trimEnd() : " *").join("\n")
  }\n */\n${bundle}`;
const output = new URL("../src/portable-runtime.generated.js", import.meta.url);
if (checkOnly) {
  if (await Deno.readTextFile(output) !== generated) {
    throw new Error("WebSocket portable bundle is stale; run its prebundle generator");
  }
} else {
  const temporary = await Deno.makeTempFile({
    dir: fileURLToPath(new URL("../src/", import.meta.url)),
    prefix: ".websocket-runtime-",
    suffix: ".tmp",
  });
  try {
    await Deno.writeTextFile(temporary, generated);
    await Deno.rename(temporary, output);
  } catch (error) {
    try {
      await Deno.remove(temporary);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Deno.errors.NotFound)) {
        throw new AggregateError([error, cleanupError], "WebSocket generation and cleanup failed");
      }
    }
    throw error;
  }
  console.log(
    `WebSocket portable runtime ${identity}: ${bundleBytes.length} bytes, sha256:${digest}`,
  );
}
