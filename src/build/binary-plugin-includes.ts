const BINARY_TAILWIND_PLUGIN_PACKAGES = [
  "tailwindcss-animate@1.0.7",
  "@tailwindcss/typography@0.5.19",
  "@tailwindcss/forms@0.5.11",
  "tailwind-scrollbar-hide@2.0.0",
  "daisyui@5.5.14",
] as const;

export function getTailwindPluginBundleUrl(packageName: string): string {
  return `https://esm.sh/${packageName}?bundle&external=tailwindcss&target=denonext`;
}

export function getBinaryPluginBundleIncludes(): string[] {
  return BINARY_TAILWIND_PLUGIN_PACKAGES.map(getTailwindPluginBundleUrl);
}

export { BINARY_TAILWIND_PLUGIN_PACKAGES };
