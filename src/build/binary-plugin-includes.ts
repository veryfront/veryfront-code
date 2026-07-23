const BINARY_TAILWIND_PLUGIN_PACKAGES = [
  "tailwindcss-animate@1.0.7",
  "@tailwindcss/typography@0.5.19",
  "@tailwindcss/forms@0.5.11",
  "tailwind-scrollbar-hide@2.0.0",
  "daisyui@5.5.14",
] as const;

const NPM_PACKAGE_SPECIFIER_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._+-]*)?$/i;

function assertPackageSpecifier(packageName: string): void {
  if (
    typeof packageName !== "string" || packageName.trim() !== packageName ||
    !NPM_PACKAGE_SPECIFIER_PATTERN.test(packageName)
  ) {
    throw new TypeError("Tailwind plugin package must be a valid npm package specifier");
  }
}

function barePackageName(spec: string): string {
  if (spec.startsWith("@")) {
    const versionIndex = spec.indexOf("@", 1);
    return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
  }

  const versionIndex = spec.indexOf("@");
  return versionIndex === -1 ? spec : spec.slice(0, versionIndex);
}

const BINARY_TAILWIND_PLUGIN_PACKAGE_BY_NAME = new Map(
  BINARY_TAILWIND_PLUGIN_PACKAGES.map((pkg) => [barePackageName(pkg), pkg]),
);

export function resolveTailwindPluginBundlePackage(packageName: string): string {
  assertPackageSpecifier(packageName);
  if (packageName.includes("@", packageName.startsWith("@") ? 1 : 0)) {
    return packageName;
  }

  return BINARY_TAILWIND_PLUGIN_PACKAGE_BY_NAME.get(packageName) ?? packageName;
}

export function getTailwindPluginBundleUrl(packageName: string): string {
  const resolvedPackage = resolveTailwindPluginBundlePackage(packageName);
  return `https://esm.sh/${resolvedPackage}?bundle&external=tailwindcss&target=denonext`;
}

export function getBinaryPluginBundleIncludes(): string[] {
  return BINARY_TAILWIND_PLUGIN_PACKAGES.map(getTailwindPluginBundleUrl);
}

export { BINARY_TAILWIND_PLUGIN_PACKAGES };
