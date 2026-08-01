/** Resolve Tailwind's exact version from this extension's checked-in manifest. */

const TAILWIND_NPM_PREFIX = "npm:tailwindcss@";
const EXACT_SEMVER_PATTERN =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:(?:0|[1-9]\d*)|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function exactTailwindVersion(specifier: unknown): string {
  if (typeof specifier !== "string" || !specifier.startsWith(TAILWIND_NPM_PREFIX)) {
    throw new TypeError(
      "ext-css-tailwind imports.tailwindcss must target npm:tailwindcss at an exact semantic version",
    );
  }

  const version = specifier.slice(TAILWIND_NPM_PREFIX.length);
  if (!EXACT_SEMVER_PATTERN.test(version)) {
    throw new TypeError(
      "ext-css-tailwind imports.tailwindcss must use an exact semantic version without a range or subpath",
    );
  }
  return version;
}
