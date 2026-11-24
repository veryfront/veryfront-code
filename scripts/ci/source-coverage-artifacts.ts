/** Current-source coverage receipts, kept separate from reused queue coverage. */
export const SOURCE_COVERAGE_LABELS = ["context-ownership", "connected-local"] as const;
type Label = typeof SOURCE_COVERAGE_LABELS[number];
export interface CoverageIdentity {
  source: string;
  run: string;
  attempt: number;
}

function identity(value: CoverageIdentity): void {
  if (
    typeof value.source !== "string" || typeof value.run !== "string" ||
    !/^[a-f0-9]{40}$/.test(value.source) || !/^[1-9]\d{0,19}$/.test(value.run) ||
    !Number.isSafeInteger(value.attempt) || value.attempt < 1
  ) {
    throw new Error("Invalid source coverage identity");
  }
}

function label(value: string): Label {
  if (!(SOURCE_COVERAGE_LABELS as readonly string[]).includes(value)) {
    throw new Error("Unknown source coverage producer");
  }
  return value as Label;
}

async function regularFile(path: string, maximum: number): Promise<Uint8Array> {
  const stat = await Deno.lstat(path);
  if (!stat.isFile || stat.isSymlink || stat.size < 1 || stat.size > maximum) {
    throw new Error("Invalid source coverage file");
  }
  const bytes = await Deno.readFile(path);
  if (bytes.length !== stat.size) throw new Error("Source coverage file changed");
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function requireLcov(bytes: Uint8Array): void {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!/^SF:.+$/m.test(text) || !/^end_of_record$/m.test(text)) {
    throw new Error("Source coverage has no complete LCOV record");
  }
}

export async function recordSourceCoverage(
  producer: string,
  directory: string,
  expected: CoverageIdentity,
): Promise<void> {
  identity(expected);
  const stage = label(producer);
  const bytes = await regularFile(`${directory}/lcov.info`, 64 * 1024 * 1024);
  requireLcov(bytes);
  await Deno.writeTextFile(
    `${directory}/source-coverage.json`,
    JSON.stringify({ schema: 1, stage, ...expected, sha256: await sha256(bytes) }) + "\n",
    { createNew: true },
  );
}

async function settleOperations<T>(operations: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(operations);
  const values: T[] = [];
  const errors: unknown[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") values.push(result.value);
    else errors.push(result.reason);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Coverage artifact operations failed");
  return values;
}

interface Receipt {
  path: string;
  attempt: number;
}
interface VerifiedCoverage {
  stage: Label;
  bytes: Uint8Array;
}

async function inventoryReceipts(
  directory: string,
  maximumAttempt: number,
): Promise<Map<Label, Receipt>> {
  const root = await Deno.lstat(directory);
  if (!root.isDirectory || root.isSymlink) throw new Error("Invalid coverage receipt directory");
  const selected = new Map<Label, Receipt>();
  for await (const entry of Deno.readDir(directory)) {
    const match = /^coverage-source-(context-ownership|connected-local)-attempt-([1-9]\d*)$/.exec(
      entry.name,
    );
    const attempt = Number(match?.[2]);
    if (
      !match || !entry.isDirectory || entry.isSymlink || !Number.isSafeInteger(attempt) ||
      attempt > maximumAttempt
    ) throw new Error("Unexpected coverage receipt artifact");
    const stage = label(match[1]);
    if (attempt > (selected.get(stage)?.attempt ?? 0)) {
      selected.set(stage, { path: `${directory}/${entry.name}`, attempt });
    }
  }
  return selected;
}

function validateManifest(
  value: unknown,
  stage: Label,
  receipt: Receipt,
  expected: CoverageIdentity,
): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Source coverage receipt identity mismatch");
  }
  const manifest = value as Record<string, unknown>;
  const fields = ["schema", "stage", "source", "run", "attempt", "sha256"];
  if (
    Object.keys(manifest).length !== fields.length ||
    !fields.every((field) => Object.hasOwn(manifest, field)) ||
    manifest.schema !== 1 || manifest.stage !== stage || manifest.source !== expected.source ||
    manifest.run !== expected.run || manifest.attempt !== receipt.attempt
  ) {
    throw new Error("Source coverage receipt identity mismatch");
  }
  return manifest;
}

async function readVerifiedCoverage(
  stage: Label,
  receipt: Receipt | undefined,
  expected: CoverageIdentity,
): Promise<VerifiedCoverage> {
  if (!receipt) throw new Error("Missing source coverage producer");
  const [metadata, bytes] = await settleOperations([
    regularFile(`${receipt.path}/source-coverage.json`, 8192),
    regularFile(`${receipt.path}/lcov.info`, 64 * 1024 * 1024),
  ]);
  const manifest = validateManifest(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(metadata)),
    stage,
    receipt,
    expected,
  );
  if (manifest.sha256 !== await sha256(bytes)) throw new Error("Source coverage digest mismatch");
  requireLcov(bytes);
  for await (const entry of Deno.readDir(receipt.path)) {
    if (!["lcov.info", "source-coverage.json"].includes(entry.name)) {
      throw new Error("Unexpected source coverage payload");
    }
  }
  return { stage, bytes };
}

async function requireMissingDestination(path: string): Promise<void> {
  try {
    await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  throw new Error("Source coverage destination already exists");
}

async function writeVerifiedCoverage(output: string, verified: VerifiedCoverage[]): Promise<void> {
  await settleOperations(
    verified.map(({ stage }) => requireMissingDestination(`${output}/coverage-${stage}`)),
  );
  await Deno.mkdir(output, { recursive: true });
  const destination = await Deno.lstat(output);
  if (!destination.isDirectory || destination.isSymlink) {
    throw new Error("Unsafe coverage destination");
  }
  await settleOperations(verified.map(async ({ stage, bytes }) => {
    await Deno.mkdir(`${output}/coverage-${stage}`);
    await Deno.writeFile(`${output}/coverage-${stage}/lcov.info`, bytes, { createNew: true });
  }));
}

/** Select successful upstream receipts from the current or an earlier retry attempt. */
export async function selectSourceCoverage(
  directory: string,
  output: string,
  expected: CoverageIdentity,
): Promise<void> {
  identity(expected);
  const selected = await inventoryReceipts(directory, expected.attempt);
  // Every producer is verified before any output is created. Reads have disjoint paths.
  const verified = await settleOperations(
    SOURCE_COVERAGE_LABELS.map((stage) =>
      readVerifiedCoverage(stage, selected.get(stage), expected)
    ),
  );
  await writeVerifiedCoverage(output, verified);
}

if (import.meta.main) {
  const expected = {
    source: Deno.env.get("GITHUB_SHA") ?? "",
    run: Deno.env.get("GITHUB_RUN_ID") ?? "",
    attempt: Number(Deno.env.get("GITHUB_RUN_ATTEMPT")),
  };
  const [mode, first, second, extra] = Deno.args;
  if (!first || !second || extra) {
    throw new Error("Expected record <producer> <directory> or select <input> <output>");
  }
  if (mode === "record") await recordSourceCoverage(first, second, expected);
  else if (mode === "select") await selectSourceCoverage(first, second, expected);
  else throw new Error("Unknown coverage receipt operation");
}
