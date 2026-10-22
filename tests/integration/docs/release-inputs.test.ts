import { assertRejects, assertThrows } from "#std/assert";
import { createHash } from "node:crypto";
import path from "node:path";
import { releaseDocsInputs } from "../../../scripts/docs/release-inputs.ts";

Deno.test("generated release inputs require an exact fingerprint and cannot authorize neighboring files", async () => {
  const repository = await Deno.realPath(await Deno.makeTempDir());
  try {
    const git = async (...args: string[]) => {
      const result = await new Deno.Command("git", {
        args: ["-C", repository, ...args],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      return new TextDecoder().decode(result.stdout).trim();
    };
    await git("init", "-q");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-qm",
      "fixture",
    );
    const revision = await git("rev-parse", "HEAD");
    const bytes = new TextEncoder().encode("Generated reference");
    const verify = await releaseDocsInputs(
      repository,
      revision,
      new Map([
        [
          "docs/public/reference.md",
          createHash("sha256").update(bytes).digest("hex"),
        ],
      ]),
    );
    verify(path.join(repository, "docs/public/reference.md"), bytes);
    assertThrows(
      () => verify(path.join(repository, "docs/public/private.md"), bytes),
      Error,
      "Untracked",
    );
    assertThrows(
      () =>
        verify(
          path.join(repository, "docs/public/reference.md"),
          new TextEncoder().encode("Changed"),
        ),
      Error,
      "changed after generation",
    );
    await assertRejects(
      () => releaseDocsInputs(repository, "0".repeat(40)),
      Error,
      "Unable to verify",
    );
  } finally {
    await Deno.remove(repository, { recursive: true });
  }
});
