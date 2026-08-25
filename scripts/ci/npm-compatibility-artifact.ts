import { basename, join, resolve } from "#std/path";

export interface NpmCompatibilityPackage {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
}

export interface NpmCompatibilityManifest {
  readonly schemaVersion: 1;
  readonly rootPackage: "veryfront";
  readonly rootExtensionNames: readonly string[];
  readonly packages: readonly NpmCompatibilityPackage[];
}

export interface LoadedNpmCompatibilityArtifact {
  readonly root: string;
  readonly rootExtensionNames: readonly string[];
  readonly extensions: readonly {
    readonly name: string;
    readonly tarball: string;
  }[];
  readonly manifestSha256: string;
}

interface LoadNpmCompatibilityArtifactOptions {
  readonly expectedGitHead?: string;
}

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly gitHead?: unknown;
  readonly dependencies?: Record<string, string>;
}

interface NpmPackResult {
  readonly filename?: unknown;
}

type NpmCompatibilityArtifactOperation = "pack" | "verify" | "materialize";

export class NpmCompatibilityArtifactError extends Error {
  constructor(
    readonly operation: NpmCompatibilityArtifactOperation,
    message: string,
    readonly context: { readonly packageName?: string } = {},
  ) {
    super(message);
    this.name = "NpmCompatibilityArtifactError";
  }
}

const MANIFEST_FILE = "manifest.json";
const EXTENSION_PREFIX = "@veryfront/ext-";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function sha256File(path: string): Promise<string> {
  const bytes = await Deno.readFile(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function validateGitHead(gitHead: string): void {
  if (!/^[0-9a-f]{40}$/.test(gitHead)) {
    throw new Error(
      "Canonical npm artifact gitHead must be a 40-character lowercase hexadecimal commit",
    );
  }
}

async function verifyPackageMetadata(
  tarball: string,
  entry: NpmCompatibilityPackage,
  expectedGitHead?: string,
): Promise<void> {
  const output = await new Deno.Command("tar", {
    args: ["-xOf", tarball, "package/package.json"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new NpmCompatibilityArtifactError(
      "verify",
      `Failed to inspect canonical package metadata for ${entry.name}`,
      { packageName: entry.name },
    );
  }
  let manifest: PackageManifest;
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(output.stdout),
    ) as PackageManifest;
  } catch {
    throw new NpmCompatibilityArtifactError(
      "verify",
      `Canonical package metadata for ${entry.name} is not valid JSON`,
      { packageName: entry.name },
    );
  }
  if (manifest.name !== entry.name) {
    throw new NpmCompatibilityArtifactError(
      "verify",
      `Canonical package ${entry.name} name does not match the canonical manifest`,
      { packageName: entry.name },
    );
  }
  if (manifest.version !== entry.version) {
    throw new NpmCompatibilityArtifactError(
      "verify",
      `Canonical package ${entry.name} version does not match the canonical manifest`,
      { packageName: entry.name },
    );
  }
  if (expectedGitHead !== undefined && manifest.gitHead !== expectedGitHead) {
    throw new NpmCompatibilityArtifactError(
      "verify",
      `Canonical package ${entry.name} gitHead does not match the release commit`,
      { packageName: entry.name },
    );
  }
}

async function readPackageManifest(directory: string): Promise<{
  name: string;
  version: string;
  dependencies: Record<string, string>;
}> {
  const manifest = JSON.parse(
    await Deno.readTextFile(join(directory, "package.json")),
  ) as PackageManifest;
  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    throw new Error(`${directory}/package.json must declare a package name`);
  }
  if (typeof manifest.version !== "string" || manifest.version.length === 0) {
    throw new Error(`${directory}/package.json must declare a package version`);
  }
  return {
    name: manifest.name,
    version: manifest.version,
    dependencies: manifest.dependencies ?? {},
  };
}

async function packageDirectories(npmDirectory: string): Promise<string[]> {
  const directories = [npmDirectory];
  const extensionsDirectory = join(npmDirectory, "extensions");
  try {
    for await (const entry of Deno.readDir(extensionsDirectory)) {
      if (!entry.isDirectory) continue;
      const directory = join(extensionsDirectory, entry.name);
      try {
        const stat = await Deno.stat(join(directory, "package.json"));
        if (stat.isFile) directories.push(directory);
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return directories;
}

async function packPackage(
  packageDirectory: string,
  destination: string,
  packageName: string,
  gitHead?: string,
): Promise<string> {
  const packageManifestPath = join(packageDirectory, "package.json");
  const originalPackageManifest = gitHead
    ? await Deno.readTextFile(packageManifestPath)
    : undefined;
  if (originalPackageManifest) {
    const packageManifest = JSON.parse(originalPackageManifest) as Record<
      string,
      unknown
    >;
    await Deno.writeTextFile(
      packageManifestPath,
      `${JSON.stringify({ ...packageManifest, gitHead }, null, 2)}\n`,
    );
  }
  let output: Deno.CommandOutput;
  try {
    output = await new Deno.Command("npm", {
      args: ["pack", "--json", "--pack-destination", destination],
      cwd: packageDirectory,
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    if (originalPackageManifest) {
      await Deno.writeTextFile(packageManifestPath, originalPackageManifest);
    }
  }
  if (!output.success) {
    throw new NpmCompatibilityArtifactError(
      "pack",
      `npm pack failed for ${packageDirectory}: ${
        new TextDecoder().decode(output.stderr).trim().slice(0, 4096)
      }`,
      { packageName },
    );
  }
  const result = JSON.parse(
    new TextDecoder().decode(output.stdout),
  ) as NpmPackResult[];
  const filename = result[0]?.filename;
  if (typeof filename !== "string" || basename(filename) !== filename) {
    throw new NpmCompatibilityArtifactError(
      "pack",
      `npm pack returned an invalid filename for ${packageDirectory}`,
      { packageName },
    );
  }
  return filename;
}

export async function createNpmCompatibilityArtifact(
  npmDirectory: string,
  destination: string,
  options: { readonly gitHead?: string } = {},
): Promise<NpmCompatibilityManifest> {
  const resolvedDestination = resolve(destination);
  if (options.gitHead !== undefined) validateGitHead(options.gitHead);
  await Deno.mkdir(resolvedDestination, { recursive: true });
  const packageSources = await Promise.all(
    (await packageDirectories(npmDirectory)).map(async (directory) => ({
      directory,
      manifest: await readPackageManifest(directory),
    })),
  );
  packageSources.sort((left, right) => compareText(left.manifest.name, right.manifest.name));

  const root = packageSources.find(({ manifest }) => manifest.name === "veryfront");
  if (!root) throw new Error("npm compatibility artifact requires veryfront");
  for (const { manifest } of packageSources) {
    if (manifest.version !== root.manifest.version) {
      throw new Error(
        `${manifest.name} version ${manifest.version} does not match root package version ${root.manifest.version}`,
      );
    }
  }
  const rootExtensionNames = Object.entries(root.manifest.dependencies)
    .filter(([name, version]) =>
      name.startsWith(EXTENSION_PREFIX) && version === root.manifest.version
    )
    .map(([name]) => name)
    .sort(compareText);

  const packages: NpmCompatibilityPackage[] = [];
  for (const source of packageSources) {
    const file = await packPackage(
      source.directory,
      resolvedDestination,
      source.manifest.name,
      options.gitHead,
    );
    packages.push({
      name: source.manifest.name,
      version: source.manifest.version,
      file,
      sha256: await sha256File(join(resolvedDestination, file)),
    });
  }

  const manifest: NpmCompatibilityManifest = {
    schemaVersion: 1,
    rootPackage: "veryfront",
    rootExtensionNames,
    packages,
  };
  await Deno.writeTextFile(
    join(resolvedDestination, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

function validateManifest(value: unknown): NpmCompatibilityManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("npm compatibility manifest must be an object");
  }
  const manifest = value as Partial<NpmCompatibilityManifest>;
  if (
    manifest.schemaVersion !== 1 || manifest.rootPackage !== "veryfront" ||
    !Array.isArray(manifest.rootExtensionNames) ||
    !manifest.rootExtensionNames.every((name) => typeof name === "string") ||
    !Array.isArray(manifest.packages)
  ) {
    throw new Error("npm compatibility manifest has an unsupported shape");
  }
  for (const entry of manifest.packages) {
    if (
      entry === null || typeof entry !== "object" ||
      typeof entry.name !== "string" || typeof entry.version !== "string" ||
      typeof entry.file !== "string" || basename(entry.file) !== entry.file ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error("npm compatibility manifest contains an invalid package");
    }
  }
  return manifest as NpmCompatibilityManifest;
}

export async function loadNpmCompatibilityArtifact(
  directory: string,
  options: LoadNpmCompatibilityArtifactOptions = {},
): Promise<LoadedNpmCompatibilityArtifact> {
  if (options.expectedGitHead !== undefined) {
    validateGitHead(options.expectedGitHead);
  }
  const manifestPath = join(directory, MANIFEST_FILE);
  const manifest = validateManifest(
    JSON.parse(await Deno.readTextFile(manifestPath)),
  );
  const packagePaths = new Map<string, string>();
  for (const entry of manifest.packages) {
    if (packagePaths.has(entry.name)) {
      throw new Error(
        `Duplicate package in npm compatibility manifest: ${entry.name}`,
      );
    }
    const path = join(directory, entry.file);
    const actual = await sha256File(path);
    if (actual !== entry.sha256) {
      throw new Error(
        `SHA-256 mismatch for ${entry.name}: expected ${entry.sha256}, received ${actual}`,
      );
    }
    await verifyPackageMetadata(path, entry, options.expectedGitHead);
    packagePaths.set(entry.name, path);
  }
  const root = packagePaths.get(manifest.rootPackage);
  if (!root) throw new Error("npm compatibility manifest is missing veryfront");
  for (const name of manifest.rootExtensionNames) {
    if (!packagePaths.has(name)) {
      throw new Error(`npm compatibility manifest is missing ${name}`);
    }
  }

  return {
    root,
    rootExtensionNames: [...manifest.rootExtensionNames],
    extensions: manifest.packages
      .filter(({ name }) => name.startsWith(EXTENSION_PREFIX))
      .map(({ name }) => ({ name, tarball: packagePaths.get(name)! })),
    manifestSha256: await sha256File(manifestPath),
  };
}

async function extractPackage(
  tarball: string,
  destination: string,
): Promise<void> {
  await Deno.mkdir(destination, { recursive: true });
  const output = await new Deno.Command("tar", {
    args: ["-xzf", tarball, "--strip-components=1", "-C", destination],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `Failed to materialize ${basename(tarball)}: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
}

export async function materializeNpmCompatibilityArtifact(
  artifactDirectory: string,
  destination: string,
): Promise<void> {
  if (resolve(artifactDirectory) === resolve(destination)) {
    throw new Error("Artifact and materialized npm directories must differ");
  }
  const loaded = await loadNpmCompatibilityArtifact(artifactDirectory);
  await Deno.remove(destination, { recursive: true }).catch((error) => {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  });
  await extractPackage(loaded.root, destination);
  for (const extension of loaded.extensions) {
    const directoryName = extension.name.slice("@veryfront/".length);
    await extractPackage(
      extension.tarball,
      join(destination, "extensions", directoryName),
    );
  }
}

async function main(args: string[]): Promise<void> {
  const [command, directory, destination, gitHead] = args;
  if (command === "pack" && directory && destination && gitHead) {
    const manifest = await createNpmCompatibilityArtifact(
      directory,
      destination,
      { gitHead },
    );
    const loaded = await loadNpmCompatibilityArtifact(destination);
    console.log(JSON.stringify({
      manifestSha256: loaded.manifestSha256,
      packages: manifest.packages.length,
    }));
    return;
  }
  if (command === "verify" && directory && gitHead === undefined) {
    const loaded = await loadNpmCompatibilityArtifact(
      directory,
      destination === undefined ? {} : { expectedGitHead: destination },
    );
    console.log(`npm compatibility manifest SHA-256: ${loaded.manifestSha256}`);
    return;
  }
  if (command === "materialize" && directory && destination) {
    await materializeNpmCompatibilityArtifact(directory, destination);
    return;
  }
  throw new Error(
    "Usage: npm-compatibility-artifact.ts pack <npm-directory> <destination> <git-head> | verify <artifact-directory> [git-head] | materialize <artifact-directory> <npm-directory>",
  );
}

function safePackageName(value: string | undefined): string | undefined {
  if (
    value && value.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)
  ) {
    return value;
  }
  return undefined;
}

export function formatNpmCompatibilityArtifactCliError(
  error: unknown,
  requestedOperation?: string,
): string {
  const operation = error instanceof NpmCompatibilityArtifactError
    ? error.operation
    : requestedOperation === "pack" || requestedOperation === "verify" ||
        requestedOperation === "materialize"
    ? requestedOperation
    : undefined;
  const packageName = error instanceof NpmCompatibilityArtifactError
    ? safePackageName(error.context.packageName)
    : undefined;
  const operationText = operation ? ` ${operation}` : " command";
  const packageText = packageName ? ` for ${packageName}` : "";
  return `npm compatibility artifact${operationText} failed${packageText}.`;
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    console.error(formatNpmCompatibilityArtifactCliError(error, Deno.args[0]));
    Deno.exit(1);
  }
}
