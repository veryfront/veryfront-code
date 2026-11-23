import { dirname, join } from "veryfront/platform/path";

export function isMissingKnowledgeOutput(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Both the source and candidate reservations must remain held through this call. */
export async function publishKnowledgeOutput(input: {
  path: string;
  claim: { path: string; generation: string };
  content: string;
  signal: AbortSignal | undefined;
  publication: { kind: "create" } | { kind: "replace"; validate: () => Promise<boolean> };
}): Promise<boolean> {
  const stage = join(dirname(input.claim.path), `${input.claim.generation}.output`);
  try {
    const mode = input.publication.kind === "replace" ? (await Deno.lstat(input.path)).mode : null;
    await Deno.writeTextFile(stage, input.content, {
      createNew: true,
      signal: input.signal,
      ...(mode === null ? {} : { mode: mode & 0o777 }),
    });
    // Creation honors umask; replacement retains the existing file's permissions.
    if (mode !== null) await Deno.chmod(stage, mode & 0o777);
    input.signal?.throwIfAborted();
    if (input.publication.kind === "replace") {
      if (!await input.publication.validate()) return false;
      input.signal?.throwIfAborted();
      await Deno.rename(stage, input.path);
    } else {
      try {
        await Deno.link(stage, input.path);
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
          throw new Deno.errors.AlreadyExists();
        }
        throw error;
      }
    }
    return true;
  } finally {
    await Deno.remove(stage).catch((error) => {
      if (!isMissingKnowledgeOutput(error)) throw error;
    });
  }
}
