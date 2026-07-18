/**
 * Binary Compilation and Management
 *
 * Handles compiled binary lifecycle for E2E tests:
 * - Hash-based caching to skip unnecessary recompilation
 * - Force fresh builds when needed
 * - Binary path configuration
 */

import { exists } from "#veryfront/platform/compat/fs.ts";
import { join, relative } from "#veryfront/compat/path/index.ts";

export const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? "/tmp/veryfront-e2e-bin";
export const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;
const HASH_INPUTS = [
  "src",
  "cli",
  "scripts/build",
  "extensions",
  "react",
  "deno.json",
  "deno.lock",
] as const;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input as unknown as BufferSource);
  return toHex(new Uint8Array(digest));
}

async function walkFiles(path: string): Promise<string[]> {
  const stat = await Deno.stat(path);
  if (stat.isFile) return [path];

  const files: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (entry.name === ".DS_Store") continue;
    const childPath = `${path}/${entry.name}`;
    if (entry.isDirectory) {
      files.push(...await walkFiles(childPath));
      continue;
    }
    if (entry.isFile) files.push(childPath);
  }

  return files.sort();
}

async function computeWorkingTreeHash(cwd: string): Promise<string> {
  const encoder = new TextEncoder();
  const fileHashes: string[] = [];

  for (const input of HASH_INPUTS) {
    const inputPath = join(cwd, input);
    if (!await exists(inputPath)) continue;
    for (const file of await walkFiles(inputPath)) {
      const content = await Deno.readFile(file);
      const contentHash = await sha256Hex(content);
      const relativePath = relative(cwd, file).replaceAll("\\", "/");
      fileHashes.push(`${relativePath}\0${contentHash}`);
    }
  }

  return `v3-${await sha256Hex(encoder.encode(fileHashes.join("\n")))}`;
}

/**
 * Compute a hash of the source directory to detect changes.
 * Hashes the working tree for binary build inputs so uncommitted edits
 * also invalidate the cached compiled test binary.
 */
export async function computeSourceHash(cwd = Deno.cwd()): Promise<string> {
  const decoder = new TextDecoder();

  try {
    const statusResult = await new Deno.Command("git", {
      args: ["status", "--porcelain", "--", ...HASH_INPUTS],
      cwd,
      stdout: "piped",
      stderr: "null",
    }).output();

    if (!statusResult.success) {
      return await computeWorkingTreeHash(cwd);
    }

    const statusOutput = decoder.decode(statusResult.stdout).trim();
    if (statusOutput.length > 0) {
      return await computeWorkingTreeHash(cwd);
    }
  } catch {
    return await computeWorkingTreeHash(cwd);
  }

  // Fast path for clean trees: use git object IDs.
  try {
    const results = await Promise.all(
      HASH_INPUTS.map((input) =>
        new Deno.Command("git", {
          args: ["rev-parse", `HEAD:${input}`],
          cwd,
          stdout: "piped",
          stderr: "null",
        }).output()
      ),
    );

    if (results.every((result) => result.success)) {
      const hashes = results.map((result) => decoder.decode(result.stdout).trim());
      return `v4-${hashes.join("-")}`;
    }
  } catch {
    // fall through
  }

  return await computeWorkingTreeHash(cwd);
}

/**
 * Ensure the binary is compiled and up-to-date.
 * Skips compilation if source hasn't changed (unless VERYFRONT_BINARY_FRESH=1).
 */
export async function ensureBinaryCompiled(): Promise<void> {
  const forceFresh = Deno.env.get("VERYFRONT_BINARY_FRESH") === "1";
  const binaryExists = await exists(BINARY_PATH);
  const currentHash = await computeSourceHash();

  if (binaryExists && !forceFresh) {
    try {
      const storedHash = await Deno.readTextFile(BINARY_HASH_PATH);
      if (storedHash.trim() === currentHash) {
        console.log("✅ Using existing binary (source unchanged):", BINARY_PATH);
        return;
      }
      console.log("🔄 Source code changed, recompiling...");
    } catch {
      console.log("🔄 No source hash found, recompiling...");
    }
  }

  if (forceFresh) console.log("🗑️  Force fresh build (VERYFRONT_BINARY_FRESH=1)");
  if (binaryExists) await Deno.remove(BINARY_PATH);

  console.log("📦 Preparing build artifacts...");
  const prepareResult = await new Deno.Command("deno", {
    args: ["task", "build:prepare"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!prepareResult.success) throw new Error("Failed to prepare framework sources");

  console.log("📦 Compiling binary...");
  const result = await new Deno.Command("deno", {
    args: [
      "run",
      "-A",
      "scripts/build/compile-binary.ts",
      "--output",
      BINARY_PATH,
    ],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) throw new Error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("✅ Binary compiled");
}
