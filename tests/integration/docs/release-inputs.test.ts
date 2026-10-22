import { makeTempDirWithOptions } from "#veryfront/testing/deno-compat.ts";
import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import { createHash } from "node:crypto";
import path from "node:path";
import { releaseDocsInputs } from "../../../scripts/docs/release-inputs.ts";

Deno.test("generated release inputs require an exact fingerprint and cannot authorize neighboring files", async () => {
  const repository = await Deno.realPath(await makeTempDirWithOptions());
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
    await Deno.mkdir(path.join(repository, "docs/public"), { recursive: true });
    await Deno.writeFile(path.join(repository, "docs/public/reference.md"), bytes);
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
    const inventory = new Map([[
      "docs/public/reference.md",
      createHash("sha256").update(bytes).digest("hex"),
    ]]);
    await Deno.remove(path.join(repository, "docs/public/reference.md"));
    await assertRejects(() => releaseDocsInputs(repository, revision, inventory));
    await Deno.writeTextFile(path.join(repository, "docs/public/reference.md"), "Changed");
    await assertRejects(
      () => releaseDocsInputs(repository, revision, inventory),
      Error,
      "changed after generation",
    );
    await Deno.remove(path.join(repository, "docs/public/reference.md"));
    await Deno.writeFile(path.join(repository, "outside.md"), bytes);
    await Deno.symlink(
      path.join(repository, "outside.md"),
      path.join(repository, "docs/public/reference.md"),
    );
    await assertRejects(
      () => releaseDocsInputs(repository, revision, inventory),
      Error,
      "symlinks",
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

Deno.test("public repository identities remove credentials and reject local or private mirror origins", async () => {
  const { publicRepositoryUrl } = await import("../../../scripts/docs/repository-url.ts");
  for (
    const remote of [
      "https://secret:PRIVATE_CANARY@github.com/veryfront/veryfront-code.git?token=PRIVATE_CANARY",
      "ssh://secret:PRIVATE_CANARY@github.com/veryfront/veryfront-code.git",
      "git@github.com:veryfront/veryfront-code.git",
      "git+https://github.com/veryfront/veryfront-code.git",
    ]
  ) assertEquals(publicRepositoryUrl(remote), "https://github.com/veryfront/veryfront-code");
  for (
    const remote of [
      "/private/PRIVATE_CANARY/repo",
      "https://PRIVATE_CANARY.internal/repo",
      "ssh://PRIVATE_CANARY@mirror.internal/repo",
      "file:///private/repo",
    ]
  ) {
    assertThrows(() => publicRepositoryUrl(remote), Error, "GitHub repository origin");
  }
});
