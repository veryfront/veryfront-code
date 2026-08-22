import { fromFileUrl } from "#std/path";

const FORBIDDEN_TRACKED_DOC_PREFIXES = [
  "docs/internal/",
  "docs/superpowers/",
] as const;

export function findForbiddenTrackedDocs(paths: Iterable<string>): string[] {
  return Array.from(paths, (path) => path.replaceAll("\\", "/"))
    .filter((path) => FORBIDDEN_TRACKED_DOC_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .sort();
}

export async function validateTrackedDocs(
  repoRoot = fromFileUrl(new URL("../../", import.meta.url)),
): Promise<void> {
  const command = new Deno.Command("git", {
    args: [
      "-C",
      repoRoot,
      "ls-files",
      "-z",
      "--",
      "docs/internal",
      "docs/superpowers",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const output = await command.output();

  if (!output.success) {
    const detail = new TextDecoder().decode(output.stderr).trim();
    throw new Error(`Unable to inspect tracked docs${detail ? `: ${detail}` : ""}`);
  }

  const trackedPaths = new TextDecoder().decode(output.stdout).split("\0").filter(Boolean);
  const forbiddenPaths = findForbiddenTrackedDocs(trackedPaths);

  if (forbiddenPaths.length > 0) {
    throw new Error(
      "Temporary docs must not be tracked. Move durable current-state content to docs/architecture " +
        "and keep plans or rollout notes in the issue tracker:\n" +
        forbiddenPaths.map((path) => `- ${path}`).join("\n"),
    );
  }
}

if (import.meta.main) {
  await validateTrackedDocs();
  console.log("Tracked docs layout is clean.");
}
