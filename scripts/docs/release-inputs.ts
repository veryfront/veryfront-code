import path from "node:path";
import { createHash } from "node:crypto";

/** Release docs may read committed source or explicitly fingerprinted generator output. */
export async function releaseDocsInputs(
  repository: string,
  revision: string,
  generated: Map<string, string> = new Map(),
) {
  const root = await Deno.realPath(repository);
  const result = await new Deno.Command("git", {
    args: ["-C", root, "ls-tree", "-r", "--name-only", "-z", revision],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error("Unable to verify release documentation inputs");
  }
  const tracked = new Set(new TextDecoder().decode(result.stdout).split("\0"));
  return (file: string, bytes: Uint8Array) => {
    const relative = path.relative(root, file).split(path.sep).join("/");
    // Generated files can also be tracked: always verify their latest generator fingerprint.
    const expected = generated.get(relative);
    if (expected) {
      if (createHash("sha256").update(bytes).digest("hex") !== expected) {
        throw new Error(
          `Generated documentation changed after generation: ${relative}`,
        );
      }
    } else if (!tracked.has(relative)) {
      throw new Error(`Untracked release documentation input: ${relative}`);
    }
  };
}
