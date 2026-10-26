import { createHash } from "node:crypto";
import path from "node:path";
import { docsSourceIdentity } from "../docs/package-public-docs.ts";
import { UNITS } from "./run-generate.ts";

type Identity = Awaited<ReturnType<typeof docsSourceIdentity>>;
const generatedOutputs = new Set([
  ...UNITS.flatMap((unit) => unit.outputs),
  "src/integrations/_data.ts",
  "src/integrations/_tool_summaries.ts",
]);

async function git(root: string, args: string[]) {
  const result = await new Deno.Command("git", {
    args: ["-C", root, ...args],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!result.success) {
    throw new Error("Unable to verify npm documentation build sources");
  }
  return new TextDecoder().decode(result.stdout);
}

async function changedFiles(root: string) {
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return status.split("\0").filter(Boolean).map((entry) => {
    // Generators never rename/copy source paths. Do not misparse their second NUL record.
    if (/[RC]/.test(entry.slice(0, 2))) {
      throw new Error("Unexpected npm build source rename");
    }
    return entry.slice(3);
  });
}

async function fingerprint(root: string, relative: string) {
  const file = path.join(root, relative);
  if (await Deno.realPath(file) !== file || !(await Deno.lstat(file)).isFile) {
    throw new Error("Npm build inputs must be ordinary files");
  }
  return createHash("sha256").update(await Deno.readFile(file)).digest("hex");
}

/** One npm build: attest source first, then seal only declared generator outputs. */
export class NpmDocsBuildContext {
  private snapshot?: {
    root: string;
    version: string;
    identity: Identity;
    prepared: Map<string, string>;
    generated?: Map<string, string>;
  };

  constructor(
    private readonly outputs: ReadonlySet<string> = generatedOutputs,
  ) {}

  async capture(root: string, version: string, release: boolean) {
    if (this.snapshot) {
      throw new Error("Npm documentation build source was already captured");
    }
    root = await Deno.realPath(root);
    const identity = Object.freeze(
      await docsSourceIdentity(root, version, {
        allowLocal: !release,
      }),
    );
    if (release && identity.dirty) {
      throw new Error(
        "CI npm documentation requires clean pinned source before generation",
      );
    }
    const prepared = new Map<string, string>();
    if (!identity.dirty) {
      for (const file of await changedFiles(root)) {
        prepared.set(file, await fingerprint(root, file));
      }
    }
    this.snapshot = { root, version, identity, prepared };
  }

  private async verifySource() {
    const snapshot = this.snapshot;
    if (!snapshot) {
      throw new Error(
        "Npm documentation source must be captured before generation",
      );
    }
    if (snapshot.identity.dirty) return;
    if (
      (await git(snapshot.root, ["rev-parse", "HEAD"])).trim() !==
        snapshot.identity.revision
    ) {
      throw new Error("Npm source revision changed during generation");
    }
    for (const [file, expected] of snapshot.prepared) {
      if (await fingerprint(snapshot.root, file) !== expected) {
        throw new Error("Prepared npm source changed during generation");
      }
    }
    for (const file of await changedFiles(snapshot.root)) {
      if (!snapshot.prepared.has(file) && !this.outputs.has(file)) {
        throw new Error("Unexpected npm source change during generation");
      }
    }
  }

  async sealGeneratedOutputs() {
    await this.verifySource();
    const snapshot = this.snapshot!;
    if (snapshot.generated) {
      throw new Error("Npm generator outputs are already sealed");
    }
    const generated = new Map<string, string>();
    if (!snapshot.identity.dirty) {
      for (const file of this.outputs) {
        generated.set(file, await fingerprint(snapshot.root, file));
      }
    }
    snapshot.generated = generated;
  }

  async assertStable() {
    if (!this.snapshot) return; // Direct local DNT builds have no orchestrated generation phase.
    if (!this.snapshot.generated) {
      throw new Error("Npm generator outputs have not been sealed");
    }
    await this.verifySource();
    for (const [file, expected] of this.snapshot.generated) {
      if (await fingerprint(this.snapshot.root, file) !== expected) {
        throw new Error("Npm generator output changed after generation");
      }
    }
  }

  async identityForBuild(
    root: string,
    version: string,
    release: boolean,
  ): Promise<Identity> {
    if (!this.snapshot) {
      if (release) {
        throw new Error(
          "CI npm builds must use deno task build:npm to capture source before generation",
        );
      }
      return docsSourceIdentity(root, version, { allowLocal: true });
    }
    if (
      await Deno.realPath(root) !== this.snapshot.root ||
      version !== this.snapshot.version ||
      (release && this.snapshot.identity.dirty)
    ) {
      throw new Error(
        "Npm documentation build context does not match this build",
      );
    }
    await this.assertStable();
    return this.snapshot.identity;
  }
}

export const npmDocsBuildContext = new NpmDocsBuildContext();

export function isCiNpmBuild() {
  return Boolean(Deno.env.get("CI")) && Deno.env.get("CI") !== "false";
}
