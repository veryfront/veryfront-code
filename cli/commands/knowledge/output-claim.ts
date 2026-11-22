import { execFile } from "node:child_process";
import { lstat, readFile, stat } from "node:fs/promises";
import { hostname, platform } from "node:os";
import { kill, pid } from "node:process";
import { basename, dirname, join } from "veryfront/platform/path";
import { computeHash, computeHashBytes } from "veryfront/utils";
import { KNOWLEDGE_OUTPUT_CLAIM_DIRECTORY } from "./source-policy.ts";

interface ClaimRecord {
  version: 2;
  owner: string;
  scope: string | null;
  pid: number;
  generation: string;
  publicationHash: string | null;
}

type ClaimInspection =
  | { kind: "missing" }
  | { kind: "unstable" }
  | { kind: "busy"; owner: string | undefined }
  | { kind: "dead"; next: string; record: ClaimRecord };

const HASH = /^[a-f0-9]{64}$/;
const GENERATION = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_GENERATIONS = 64;

function missing(error: unknown): boolean {
  return error instanceof Deno.errors.NotFound ||
    error instanceof Error && "code" in error && error.code === "ENOENT";
}

function parseRecord(text: string): ClaimRecord | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value !== "object" || value === null ||
      !("version" in value && value.version === 2 &&
        "owner" in value && typeof value.owner === "string" && HASH.test(value.owner) &&
        "scope" in value &&
        (value.scope === null || typeof value.scope === "string" && HASH.test(value.scope)) &&
        "pid" in value && typeof value.pid === "number" && Number.isSafeInteger(value.pid) &&
        value.pid > 0 &&
        "generation" in value && typeof value.generation === "string" &&
        GENERATION.test(value.generation))
    ) return undefined;
    const publicationHash = "publicationHash" in value ? value.publicationHash : null;
    if (
      publicationHash !== null &&
      (typeof publicationHash !== "string" || !HASH.test(publicationHash))
    ) return undefined;
    return {
      version: 2,
      owner: value.owner,
      scope: value.scope,
      pid: value.pid,
      generation: value.generation,
      publicationHash,
    };
  } catch {
    return undefined;
  }
}

async function processScope(): Promise<string | null> {
  try {
    const name = hostname();
    let boot: string;
    let namespace = "host";
    if (platform() === "linux") {
      boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      const info = await stat("/proc/self/ns/pid", { bigint: true });
      namespace = `${info.dev}:${info.ino}`;
    } else if (platform() === "darwin") {
      boot = await new Promise<string>((resolve, reject) => {
        execFile("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"], {
          timeout: 2000,
          maxBuffer: 256,
        }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
      });
    } else {
      // Unknown process namespaces must not authorize recovery on shared storage.
      return null;
    }
    if (!name || !GENERATION.test(boot.toLowerCase())) return null;
    return await computeHash(JSON.stringify([platform(), name, boot.toLowerCase(), namespace]));
  } catch {
    return null;
  }
}

// This is immutable process identity, never an allocation or output-directory cache.
let scope: Promise<string | null> | undefined;
function localScope(): Promise<string | null> {
  return scope ??= processScope();
}

function provenDead(record: ClaimRecord, scope: string | null): boolean {
  if (scope === null || record.scope !== scope) return false;
  try {
    kill(record.pid, 0);
    return false; // A reused PID is deliberately indistinguishable from a live owner.
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

async function inspectClaim(path: string): Promise<ClaimInspection> {
  try {
    const before = await lstat(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.size > 1024n) {
      return { kind: "busy", owner: undefined };
    }
    const text = await Deno.readTextFile(path);
    const record = parseRecord(text);
    const owner = record?.owner ?? (HASH.test(text) ? text : undefined);
    if (before.nlink !== 1n) {
      if (before.nlink !== 2n || !record) return { kind: "busy", owner: undefined };
      // link(prepared, lock) can be interrupted before its finally removes prepared.
      const prepared = join(dirname(path), `${record.generation}.prepared`);
      let partner;
      try {
        partner = await lstat(prepared, { bigint: true });
      } catch {
        // Its creator may just have removed the prepared hardlink.
        return { kind: "unstable" };
      }
      if (
        !partner.isFile() || partner.isSymbolicLink() || partner.nlink !== 2n ||
        partner.dev !== before.dev || partner.ino !== before.ino ||
        await Deno.readTextFile(prepared) !== text
      ) return { kind: "busy", owner: undefined };
    }
    const after = await lstat(path, { bigint: true });
    if (
      !after.isFile() || after.isSymbolicLink() || before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      before.nlink !== after.nlink
    ) return { kind: "unstable" };
    if (record && provenDead(record, await localScope())) {
      // The old creator could have released and then exited while we inspected it.
      // Recheck after the death proof; a dead creator cannot subsequently remove this inode.
      const dead = await lstat(path, { bigint: true });
      if (
        !dead.isFile() || dead.isSymbolicLink() || dead.dev !== after.dev ||
        dead.ino !== after.ino ||
        dead.size !== after.size || dead.mtimeNs !== after.mtimeNs ||
        dead.ctimeNs !== after.ctimeNs ||
        dead.nlink !== after.nlink || await Deno.readTextFile(path) !== text
      ) return { kind: "unstable" };
      // Immutable dead generations stay in place, so simultaneous recovery cannot unlink a new owner.
      return {
        kind: "dead",
        record,
        next: join(dirname(path), `${await computeHash(basename(path) + "\0" + text)}.next`),
      };
    }
    return { kind: "busy", owner };
  } catch (error) {
    return missing(error) ? { kind: "missing" } : { kind: "busy", owner: undefined };
  }
}

/** Give a cooperative unlink one event-loop turn; this never expires or steals a claim. */
async function inspectStableClaim(
  path: string,
): Promise<Exclude<ClaimInspection, { kind: "unstable" }>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const claim = await inspectClaim(path);
    if (claim.kind !== "unstable") return claim;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { kind: "busy", owner: undefined };
}

/** Read the active generation; malformed, foreign, or unverifiable claims remain busy. */
export async function readKnowledgeClaimOwner(path: string): Promise<string | undefined> {
  for (let generation = 0; generation < MAX_GENERATIONS; generation += 1) {
    const claim = await inspectStableClaim(path);
    if (claim.kind === "missing") return undefined;
    if (claim.kind === "busy") return claim.owner;
    path = claim.next;
  }
  throw new Error(
    "Knowledge output reservation recovery limit reached; inspect its metadata before retrying",
  );
}

/** Reserve without stealing; only the caller may remove the returned owned generation. */
export async function acquireKnowledgeOutputClaim(
  outputDir: string,
  candidate: string,
  owner: string,
  publicationHash: string | null = null,
): Promise<
  { kind: "owned"; path: string; generation: string } | { kind: "busy"; owner: string | undefined }
> {
  const directory = join(outputDir, KNOWLEDGE_OUTPUT_CLAIM_DIRECTORY, "v1");
  await Deno.mkdir(directory, { recursive: true });
  let path = join(directory, `${await computeHash(candidate)}.lock`);
  const generation = crypto.randomUUID();
  const prepared = join(directory, `${generation}.prepared`);
  if (publicationHash !== null && !HASH.test(publicationHash)) {
    throw new Error("Invalid knowledge publication identity");
  }
  const record: ClaimRecord = {
    version: 2,
    owner,
    scope: await localScope(),
    pid,
    generation,
    publicationHash,
  };
  await Deno.writeTextFile(prepared, JSON.stringify(record), { createNew: true });
  try {
    let absentRetries = 0;
    for (let depth = 0; depth < MAX_GENERATIONS; depth += 1) {
      try {
        await Deno.link(prepared, path);
        return { kind: "owned", path, generation };
      } catch (error) {
        if (
          !(error instanceof Deno.errors.AlreadyExists) &&
          !(error instanceof Error && "code" in error && error.code === "EEXIST")
        ) throw new Error(`Cannot reserve knowledge output: ${candidate}.md`);
        const claim = await inspectStableClaim(path);
        if (claim.kind === "busy") return claim;
        if (claim.kind === "dead") path = claim.next;
        else if (++absentRetries >= 3) break;
      }
    }
    throw new Error(`Knowledge output reservation recovery limit reached: ${candidate}.md`);
  } finally {
    await Deno.remove(prepared);
  }
}

/** Read-only proof of a complete orphan publication; it never changes either linked file. */
export async function readProvenKnowledgeOutputStage(
  outputDir: string,
  candidate: string,
): Promise<{ stagePath: string; content: string } | undefined> {
  const directory = join(outputDir, KNOWLEDGE_OUTPUT_CLAIM_DIRECTORY, "v1");
  const output = join(outputDir, `${candidate}.md`);
  let claimPath = join(directory, `${await computeHash(candidate)}.lock`);
  for (let depth = 0; depth < MAX_GENERATIONS; depth += 1) {
    const claim = await inspectStableClaim(claimPath);
    if (claim.kind !== "dead") return undefined;
    if (claim.record.publicationHash !== null) {
      const stagePath = join(directory, `${claim.record.generation}.output`);
      try {
        const [before, stage] = await Promise.all([
          lstat(output, { bigint: true }),
          lstat(stagePath, { bigint: true }),
        ]);
        if (
          before.isFile() && !before.isSymbolicLink() && before.nlink === 2n &&
          stage.isFile() && !stage.isSymbolicLink() && stage.nlink === 2n &&
          before.dev === stage.dev && before.ino === stage.ino
        ) {
          const bytes = await Deno.readFile(stagePath);
          const [after, partner] = await Promise.all([
            lstat(output, { bigint: true }),
            lstat(stagePath, { bigint: true }),
          ]);
          if (
            after.isFile() && !after.isSymbolicLink() && partner.isFile() &&
            !partner.isSymbolicLink() &&
            after.nlink === 2n && partner.nlink === 2n &&
            after.dev === before.dev && after.ino === before.ino &&
            partner.dev === before.dev && partner.ino === before.ino &&
            after.size === before.size && after.mtimeNs === before.mtimeNs &&
            after.ctimeNs === before.ctimeNs &&
            partner.size === stage.size && partner.mtimeNs === stage.mtimeNs &&
            partner.ctimeNs === stage.ctimeNs &&
            await computeHashBytes(bytes) === claim.record.publicationHash
          ) {
            return {
              stagePath,
              content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
            };
          }
        }
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    claimPath = claim.next;
  }
  throw new Error(
    "Knowledge publication recovery limit reached; inspect its metadata before retrying",
  );
}
