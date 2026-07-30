/** Fail-closed validation for package artifacts immediately before npm publish. */

import { parseExtensionRuntimeManifestModule } from "../build/extension-runtime-manifest.ts";

type GeneratedPackage = {
  name?: unknown;
  version?: unknown;
  veryfront?: {
    extension?: unknown;
    npm?: { runtimeVersionFromManifest?: unknown };
  };
};

const [packageDir, expectedVersion, ...extraArguments] = Deno.args;
if (!packageDir || !expectedVersion || extraArguments.length !== 0) {
  throw new TypeError(
    "Usage: validate-npm-package-version.ts <package-dir> <expected-version>",
  );
}

const packagePath = `${packageDir}/package.json`;
const pkg = JSON.parse(await Deno.readTextFile(packagePath)) as GeneratedPackage;
if (typeof pkg.name !== "string" || pkg.name.length === 0) {
  throw new TypeError(`${packagePath} is missing a package name`);
}
if (pkg.version !== expectedVersion) {
  throw new Error(
    `${pkg.name} package version ${String(pkg.version)} does not match ${expectedVersion}`,
  );
}

const runtimeVersionFromManifest =
  pkg.veryfront?.npm?.runtimeVersionFromManifest;
if (
  runtimeVersionFromManifest !== undefined &&
  typeof runtimeVersionFromManifest !== "boolean"
) {
  throw new TypeError(
    `${pkg.name} veryfront.npm.runtimeVersionFromManifest must be boolean`,
  );
}

if (runtimeVersionFromManifest === true) {
  if (pkg.veryfront?.extension !== true) {
    throw new TypeError(
      `${pkg.name} runtime manifest versions are valid only for extensions`,
    );
  }
  const runtimeManifestPath = `${packageDir}/esm/deno.js`;
  const runtimeManifest = parseExtensionRuntimeManifestModule(
    await Deno.readTextFile(runtimeManifestPath),
    runtimeManifestPath,
  );
  if (runtimeManifest === null) {
    throw new Error(
      `${pkg.name} runtime manifest module is missing its generated default manifest`,
    );
  }
  if (runtimeManifest.name !== pkg.name) {
    throw new Error(`${pkg.name} runtime manifest has a different package name`);
  }
  if (runtimeManifest.version !== expectedVersion) {
    throw new Error(
      `${pkg.name} runtime manifest version ${String(runtimeManifest.version)} does not match ${expectedVersion}`,
    );
  }
}
