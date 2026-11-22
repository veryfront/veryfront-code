import { lstat } from "node:fs/promises";
import { join } from "veryfront/platform/path";
import { computeHash } from "veryfront/utils";
import { acquireKnowledgeOutputClaim } from "./output-claim.ts";
import { KNOWLEDGE_OUTPUT_CLAIM_DIRECTORY } from "./source-policy.ts";

export interface SourceOutputIndex {
  read(owners: string[]): Promise<Array<{ owner: string; candidate: string }>>;
  record(owner: string, candidate: string): Promise<void>;
}

/** Serialize a source across title families; hints never replace fresh output validation. */
export async function withKnowledgeSourceClaim<T>(
  outputDir: string,
  source: string,
  signal: AbortSignal | undefined,
  write: (index: SourceOutputIndex) => Promise<T>,
): Promise<T> {
  const owner = await computeHash(source);
  // A slash cannot occur in an automatically allocated stem, separating source claims.
  const candidate = `source/${owner}`;
  signal?.throwIfAborted();
  const claim = await acquireKnowledgeOutputClaim(outputDir, candidate, owner);
  if (claim.kind !== "owned") {
    throw new Error("Knowledge source output is busy or reserved; retry after its writer finishes");
  }
  const directory = join(outputDir, KNOWLEDGE_OUTPUT_CLAIM_DIRECTORY, "v1", "sources");
  try {
    return await write({
      read: async (owners) => {
        const hints: Array<{ owner: string; candidate: string }> = [];
        for (const sourceOwner of new Set(owners)) {
          const hash = await computeHash(sourceOwner);
          const path = join(directory, `${hash}.json`);
          try {
            const before = await lstat(path, { bigint: true });
            if (!before.isFile() || before.nlink !== 1n || before.size > 4096n) continue;
            const value: unknown = JSON.parse(await Deno.readTextFile(path));
            const after = await lstat(path, { bigint: true });
            if (
              before.ino !== after.ino || before.dev !== after.dev || after.nlink !== 1n ||
              before.ctimeNs !== after.ctimeNs
            ) continue;
            if (
              value === null || typeof value !== "object" || !("version" in value) ||
              value.version !== 1 || !("owner" in value) || value.owner !== hash ||
              !("candidate" in value) || typeof value.candidate !== "string"
            ) continue;
            const stem = value.candidate;
            if (
              !stem || stem === "." || stem === ".." || /[/\\\0]/.test(stem) ||
              stem.length > 255
            ) continue;
            hints.push({ owner: sourceOwner, candidate: stem });
          } catch (error) {
            if (
              error instanceof SyntaxError || error instanceof Deno.errors.NotFound ||
              (error instanceof Error && "code" in error && error.code === "ENOENT")
            ) continue;
            throw error;
          }
        }
        return hints;
      },
      record: async (sourceOwner, stem) => {
        await Deno.mkdir(directory, { recursive: true });
        const hash = await computeHash(sourceOwner);
        const prepared = join(directory, `${crypto.randomUUID()}.prepared`);
        try {
          await Deno.writeTextFile(
            prepared,
            JSON.stringify({ version: 1, owner: hash, candidate: stem }),
            {
              createNew: true,
            },
          );
          await Deno.rename(prepared, join(directory, `${hash}.json`));
        } finally {
          await Deno.remove(prepared).catch((error) => {
            if (
              !(error instanceof Deno.errors.NotFound) &&
              !(error instanceof Error && "code" in error && error.code === "ENOENT")
            ) throw error;
          });
        }
      },
    });
  } finally {
    await Deno.remove(claim.path);
  }
}
