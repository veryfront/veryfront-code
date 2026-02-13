/**
 * Binary Compilation and Management
 *
 * Handles compiled binary lifecycle for E2E tests:
 * - Hash-based caching to skip unnecessary recompilation
 * - Force fresh builds when needed
 * - Binary path configuration
 */

import { exists } from "#veryfront/platform/compat/fs.ts";

export const BINARY_PATH = Deno.env.get("VERYFRONT_BINARY") ?? "/tmp/veryfront-e2e-bin";
export const BINARY_HASH_PATH = `${BINARY_PATH}.srcHash`;

/**
 * Compute a hash of the source directory to detect changes.
 * Uses git tree hash for accuracy, falls back to HEAD or timestamp.
 */
export async function computeSourceHash(): Promise<string> {
  const decoder = new TextDecoder();

  // Try tree hash of src directory (most accurate)
  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD:src"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  // Fall back to HEAD commit
  try {
    const result = await new Deno.Command("git", {
      args: ["rev-parse", "HEAD"],
      stdout: "piped",
      stderr: "null",
    }).output();

    if (result.success) return decoder.decode(result.stdout).trim();
  } catch {
    // fall through
  }

  // Last resort: timestamp (always recompiles)
  return Date.now().toString();
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

  console.log("📦 Compiling binary...");
  const result = await new Deno.Command("deno", {
    args: ["compile", "--allow-all", "--unstable-net", "--output", BINARY_PATH, "cli/main.ts"],
    stdout: "inherit",
    stderr: "inherit",
  }).output();

  if (!result.success) throw new Error("Failed to compile binary");

  await Deno.writeTextFile(BINARY_HASH_PATH, currentHash);
  console.log("✅ Binary compiled");
}
