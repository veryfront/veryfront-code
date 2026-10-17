import { privateJsonParse, privateJsonStringify } from "#veryfront/security/private-json.ts";
import { pushPrivateArray } from "#veryfront/security/private-array.ts";
import {
  createPrivateTextDecoder,
  encodePrivateText,
  privateTextStartsWith,
} from "#veryfront/security/private-text.ts";
import {
  privateByteLength,
  privateByteSubarray,
  PrivateUint8Array,
} from "#veryfront/security/private-bytes.ts";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  type DurableRunIdentity,
  getDurableRunIdentitySchema,
  MAX_DURABLE_HOME_BYTES,
  MAX_DURABLE_RECORD_BYTES,
  MAX_DURABLE_RECORDS,
  snapshotDurableValue,
} from "./durable-run-home-schema.ts";

const apply = Reflect.apply;
const sort = Array.prototype.sort;
const regexTest = RegExp.prototype.test;
const objectKeys = Object.keys;
const safeInteger = Number.isSafeInteger;
const nativeString = String;
const padStart = String.prototype.padStart;
const recordPattern = /^\d{10}\.json$/;
const byteLength = (text: string) => privateByteLength(encodePrivateText(text));
const recordName = (sequence: number) =>
  `${apply(padStart, nativeString(sequence), [10, "0"])}.json`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const invalid = () => new Error("Durable run home is invalid or conflicts with this run");
function isExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

async function syncDirectory(directory: string): Promise<void> {
  const folder = await open(directory, constants.O_RDONLY);
  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}

async function readBounded(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_DURABLE_RECORD_BYTES) throw invalid();
    const bytes = new PrivateUint8Array(info.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const result = await file.read(bytes, count, bytes.length - count, null);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    if (count !== info.size) throw invalid();
    return createPrivateTextDecoder("utf-8", { fatal: true }).decode(
      privateByteSubarray(bytes, 0, count),
    );
  } finally {
    await file.close();
  }
}

/** Publish complete immutable bytes exclusively; a crash before link leaves an ignored temporary. */
async function publish(directory: string, name: string, text: string): Promise<void> {
  if (byteLength(text) > MAX_DURABLE_RECORD_BYTES) throw invalid();
  const temporary = join(directory, `.pending-${randomUUID()}`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await link(temporary, join(directory, name));
    await syncDirectory(directory);
  } finally {
    await unlink(temporary);
  }
}

export type DurableRunRecord = {
  sequence: number;
  value: ReturnType<typeof snapshotDurableValue>;
};

/** Internal disk primitive only. Live API generation authority remains the caller's responsibility. */
export class DurableRunHome {
  private constructor(private directory: string, private identity: DurableRunIdentity) {}

  static async open(
    input: { directory: string; identity: DurableRunIdentity },
  ): Promise<DurableRunHome> {
    const identity = getDurableRunIdentitySchema().parse(input.identity);
    try {
      await mkdir(input.directory, { mode: 0o700 });
    } catch (error) {
      if (!isExists(error)) throw error;
    }
    const info = await lstat(input.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
    await syncDirectory(dirname(input.directory));
    const manifest = privateJsonStringify({ version: 1, identity });
    try {
      await publish(input.directory, "identity.json", manifest);
    } catch (error) {
      if (!isExists(error)) throw error;
    }
    if (await readBounded(join(input.directory, "identity.json")) !== manifest) throw invalid();
    await syncDirectory(input.directory);
    const home = new DurableRunHome(input.directory, identity);
    await home.read();
    return home;
  }

  async read(): Promise<DurableRunRecord[]> {
    const names: string[] = [];
    const directory = await opendir(this.directory);
    for await (const entry of directory) {
      // Pending publications may belong to a live writer; ignore without retaining them.
      if (privateTextStartsWith(entry.name, ".pending-")) continue;
      if (names.length >= MAX_DURABLE_RECORDS + 64) throw invalid();
      pushPrivateArray(names, entry.name);
    }
    const records: string[] = [];
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!;
      if (apply(regexTest, recordPattern, [name])) pushPrivateArray(records, name);
      else if (name === "execution-binding.json") {
        const binding: unknown = privateJsonParse(await readBounded(join(this.directory, name)));
        if (
          !binding || typeof binding !== "object" || !("version" in binding) ||
          binding.version !== 1 || !("identity" in binding) || !("requestHash" in binding) ||
          typeof binding.requestHash !== "string" ||
          !apply(regexTest, /^[a-f0-9]{64}$/, [binding.requestHash]) ||
          objectKeys(binding).length !== 3 ||
          privateJsonStringify(binding.identity) !== privateJsonStringify(this.identity)
        ) throw invalid();
      } else if (name !== "identity.json") throw invalid();
    }
    apply(sort, records, [
      (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
    ]);
    if (records.length > MAX_DURABLE_RECORDS) throw invalid();
    const result: DurableRunRecord[] = [];
    let totalBytes = 0;
    for (let index = 0; index < records.length; index++) {
      const name = records[index]!;
      if (name !== recordName(index + 1)) throw invalid();
      const text = await readBounded(join(this.directory, name));
      totalBytes += byteLength(text);
      if (totalBytes > MAX_DURABLE_HOME_BYTES) throw invalid();
      const raw: unknown = privateJsonParse(text);
      if (
        !raw || typeof raw !== "object" || !("body" in raw) || !("checksum" in raw) ||
        typeof raw.body !== "string" || typeof raw.checksum !== "string" ||
        objectKeys(raw).length !== 2 || digest(raw.body) !== raw.checksum
      ) throw invalid();
      const body: unknown = privateJsonParse(raw.body);
      if (
        !body || typeof body !== "object" || !("identity" in body) || !("sequence" in body) ||
        !("value" in body) || !("version" in body) || body.version !== 1 ||
        objectKeys(body).length !== 4 || body.sequence !== index + 1 ||
        privateJsonStringify(getDurableRunIdentitySchema().parse(body.identity)) !==
          privateJsonStringify(this.identity)
      ) {
        throw invalid();
      }
      pushPrivateArray(result, { sequence: index + 1, value: snapshotDurableValue(body.value) });
    }
    return result;
  }

  /** Bind request-scoped execution settings once, across every owner generation. */
  async assertExecutionBinding(requestHash: string, requireExisting: boolean): Promise<void> {
    if (!apply(regexTest, /^[a-f0-9]{64}$/, [requestHash])) throw invalid();
    const manifest = privateJsonStringify({ version: 1, identity: this.identity, requestHash });
    const path = join(this.directory, "execution-binding.json");
    if (!requireExisting) {
      try {
        await publish(this.directory, "execution-binding.json", manifest);
      } catch (error) {
        if (!isExists(error)) throw error;
      }
    }
    if (await readBounded(path) !== manifest) throw invalid();
  }

  async append(input: { sequence: number; value: unknown }): Promise<void> {
    if (
      !safeInteger(input.sequence) || input.sequence < 1 ||
      input.sequence > MAX_DURABLE_RECORDS
    ) {
      throw invalid();
    }
    const value = snapshotDurableValue(input.value);
    const records = await this.read();
    const previous = records[input.sequence - 1];
    if (previous) {
      if (privateJsonStringify(previous.value) !== privateJsonStringify(value)) throw invalid();
      await syncDirectory(this.directory);
      return;
    }
    if (input.sequence !== records.length + 1) throw invalid();
    const body = privateJsonStringify({
      version: 1,
      identity: this.identity,
      sequence: input.sequence,
      value,
    });
    const text = privateJsonStringify({ body, checksum: digest(body) });
    let total = 0;
    for (let index = 0; index < records.length; index++) {
      const record = records[index]!;
      total += byteLength(privateJsonStringify({
        body: privateJsonStringify({ version: 1, identity: this.identity, ...record }),
        checksum: "0000000000000000000000000000000000000000000000000000000000000000",
      }));
    }
    if (total + byteLength(text) > MAX_DURABLE_HOME_BYTES) throw invalid();
    try {
      await publish(this.directory, recordName(input.sequence), text);
    } catch (error) {
      if (!isExists(error)) throw error;
      // Concurrent writers may only converge on identical immutable bytes.
      if (await readBounded(join(this.directory, recordName(input.sequence))) !== text) {
        throw invalid();
      }
      await syncDirectory(this.directory);
    }
  }
}
