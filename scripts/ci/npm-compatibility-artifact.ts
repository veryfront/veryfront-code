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

interface PackageManifest {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly dependencies?: Record<string, string>;
}

interface NpmPackResult {
  readonly filename?: unknown;
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
): Promise<string> {
  const output = await new Deno.Command("npm", {
    args: ["pack", "--json", "--pack-destination", destination],
    cwd: packageDirectory,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `npm pack failed for ${packageDirectory}: ${
        new TextDecoder().decode(output.stderr).trim()
      }`,
    );
  }
  const result = JSON.parse(
    new TextDecoder().decode(output.stdout),
  ) as NpmPackResult[];
  const filename = result[0]?.filename;
  if (typeof filename !== "string" || basename(filename) !== filename) {
    throw new Error(
      `npm pack returned an invalid filename for ${packageDirectory}`,
    );
  }
  return filename;
}

export async function createNpmCompatibilityArtifact(
  npmDirectory: string,
  destination: string,
): Promise<NpmCompatibilityManifest> {
  const resolvedDestination = resolve(destination);
  await Deno.mkdir(resolvedDestination, { recursive: true });
  const packageSources = await Promise.all(
    (await packageDirectories(npmDirectory)).map(async (directory) => ({
      directory,
      manifest: await readPackageManifest(directory),
    })),
  );
  packageSources.sort((left, right) =>
    compareText(left.manifest.name, right.manifest.name)
  );

  const root = packageSources.find(({ manifest }) =>
    manifest.name === "veryfront"
  );
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
    const file = await packPackage(source.directory, resolvedDestination);
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
): Promise<LoadedNpmCompatibilityArtifact> {
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
  const [command, directory, destination] = args;
  if (command === "pack" && directory && destination) {
    const manifest = await createNpmCompatibilityArtifact(
      directory,
      destination,
    );
    const loaded = await loadNpmCompatibilityArtifact(destination);
    console.log(JSON.stringify({
      manifestSha256: loaded.manifestSha256,
      packages: manifest.packages.length,
    }));
    return;
  }
  if (command === "verify" && directory && destination === undefined) {
    const loaded = await loadNpmCompatibilityArtifact(directory);
    console.log(`npm compatibility manifest SHA-256: ${loaded.manifestSha256}`);
    return;
  }
  if (command === "materialize" && directory && destination) {
    await materializeNpmCompatibilityArtifact(directory, destination);
    return;
  }
  throw new Error(
    "Usage: npm-compatibility-artifact.ts pack <npm-directory> <destination> | verify <artifact-directory> | materialize <artifact-directory> <npm-directory>",
  );
}

if (import.meta.main) await main(Deno.args);
