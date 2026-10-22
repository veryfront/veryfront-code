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
    args: ["-C", root, "ls-tree", "-r", "-z", revision],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error("Unable to verify release documentation inputs");
  }
  const tracked = new Map(
    new TextDecoder().decode(result.stdout).split("\0").filter(Boolean).map(
      (entry) => {
        const separator = entry.indexOf("\t");
        const header = entry.slice(0, separator).split(" ");
        return [entry.slice(separator + 1), header[2]!] as const;
      },
    ),
  );
  // Validate the complete declared generation, including JSON/snippets not copied into
  // a content package. Otherwise a deleted reference can silently shrink a release.
  for (const [relative, expected] of generated) {
    if (
      path.isAbsolute(relative) || relative.includes("\\") ||
      relative.split("/").some((part) =>
        !part || part === "." || part === ".."
      ) || !/^[a-f0-9]{64}$/.test(expected)
    ) {
      throw new Error("Invalid generated documentation file inventory");
    }
    const file = path.join(root, relative);
    if (await Deno.realPath(file) !== file) {
      throw new Error("Generated documentation cannot use symlinks");
    }
    if (!(await Deno.lstat(file)).isFile) {
      throw new Error("Generated documentation input must be a file");
    }
    if (
      createHash("sha256").update(await Deno.readFile(file)).digest("hex") !==
        expected
    ) {
      throw new Error(
        `Generated documentation changed after generation: ${relative}`,
      );
    }
  }
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
    } else {
      const blob = tracked.get(relative);
      if (!blob) {
        throw new Error(`Untracked release documentation input: ${relative}`);
      }
      const actual = createHash(blob.length === 64 ? "sha256" : "sha1").update(
        `blob ${bytes.byteLength}\0`,
      ).update(bytes).digest("hex");
      if (actual !== blob) {
        throw new Error(
          `Committed documentation changed after source pinning: ${relative}`,
        );
      }
    }
  };
}
