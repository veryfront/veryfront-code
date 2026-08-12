import { join } from "#std/path";

type PrepareRcBuildVersionOptions = {
  rootDir?: string;
  version: string;
};

const VERSION_CONSTANT_PATTERN =
  /^export const VERSION = "([^"]+)";$/gm;

/** Inject the CI-generated RC version before npm build artifacts are created. */
export async function prepareRcBuildVersion(
  options: PrepareRcBuildVersionOptions,
): Promise<void> {
  const rootDir = options.rootDir ?? Deno.cwd();
  const manifestPath = join(rootDir, "deno.json");
  const versionConstantPath = join(
    rootDir,
    "src/utils/version-constant.ts",
  );
  const manifestSource = await Deno.readTextFile(manifestPath);
  const manifest = JSON.parse(manifestSource) as { version?: unknown };
  const baseVersion = manifest.version;

  if (typeof baseVersion !== "string" || baseVersion.length === 0) {
    throw new Error("deno.json must define a non-empty string version");
  }
  if (!/^\d+\.\d+\.\d+-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*$/.test(baseVersion)) {
    throw new Error(`deno.json version ${baseVersion} is not a prerelease version`);
  }

  const versionPrefix = `${baseVersion}.`;
  const runNumber = options.version.startsWith(versionPrefix)
    ? options.version.slice(versionPrefix.length)
    : "";
  if (!/^[1-9]\d*$/.test(runNumber)) {
    throw new Error(
      `RC build version ${options.version} must extend ${baseVersion} with a numeric run number`,
    );
  }

  const versionConstantSource = await Deno.readTextFile(versionConstantPath);
  const versionConstantMatches = [...versionConstantSource.matchAll(
    VERSION_CONSTANT_PATTERN,
  )];
  if (versionConstantMatches.length !== 1) {
    throw new Error(
      "src/utils/version-constant.ts must contain exactly one exported VERSION constant",
    );
  }
  if (versionConstantMatches[0][1] !== baseVersion) {
    throw new Error(
      `src/utils/version-constant.ts version ${versionConstantMatches[0][1]} does not match deno.json version ${baseVersion}`,
    );
  }

  const manifestVersionPattern =
    /^(\s*"version"\s*:\s*)"([^"]+)"(,?\s*)$/gm;
  const manifestVersionMatches = [...manifestSource.matchAll(
    manifestVersionPattern,
  )];
  if (
    manifestVersionMatches.length !== 1 ||
    manifestVersionMatches[0][2] !== baseVersion
  ) {
    throw new Error("deno.json must contain exactly one matching version field");
  }

  const nextManifestSource = manifestSource.replace(
    manifestVersionPattern,
    `$1"${options.version}"$3`,
  );
  const nextVersionConstantSource = versionConstantSource.replace(
    VERSION_CONSTANT_PATTERN,
    `export const VERSION = "${options.version}";`,
  );

  await Deno.writeTextFile(manifestPath, nextManifestSource);
  await Deno.writeTextFile(versionConstantPath, nextVersionConstantSource);
}

if (import.meta.main) {
  const version = Deno.env.get("VERSION");
  if (!version) {
    throw new Error("VERSION must be set for RC build preparation");
  }
  await prepareRcBuildVersion({ version });
  console.log(`Prepared npm source artifacts for ${version}`);
}
