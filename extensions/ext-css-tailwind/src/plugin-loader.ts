/** Static plugin loading owned entirely by ext-css-tailwind. */

import forms from "@tailwindcss/forms";
import typography from "@tailwindcss/typography";
import daisyui from "daisyui";
import scrollbarHide from "tailwind-scrollbar-hide";
import tailwindcssAnimate from "tailwindcss-animate";
import { IMPORT_RESOLUTION_ERROR, SECURITY_VIOLATION } from "veryfront/errors";
import {
  bareName,
  resolveTailwindPluginPolicy,
  TAILWIND_PLUGIN_ALLOWLIST,
} from "./plugin-policy.ts";

const STATIC_PLUGIN_BY_NAME: Readonly<Record<string, unknown>> = Object.freeze({
  "@tailwindcss/forms": forms,
  "@tailwindcss/typography": typography,
  daisyui,
  "tailwind-scrollbar-hide": scrollbarHide,
  "tailwindcss-animate": tailwindcssAnimate,
});

function requirePinnedPlugin(specifier: string): string {
  try {
    return resolveTailwindPluginPolicy(specifier).name;
  } catch (cause) {
    throw SECURITY_VIOLATION.create({
      detail: `Package "${bareName(specifier)}" is not an audited ext-css-tailwind plugin`,
      cause,
    });
  }
}

function assertStaticPlugin(name: string, value: unknown): void {
  if (
    typeof value !== "function" &&
    (typeof value !== "object" || value === null)
  ) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: `Tailwind plugin "${name}" did not export a plugin value`,
    });
  }
}

function assertCompleteStaticRegistry(): void {
  const registeredNames = Object.keys(STATIC_PLUGIN_BY_NAME).sort();
  if (
    registeredNames.length !== TAILWIND_PLUGIN_ALLOWLIST.length ||
    registeredNames.some((name, index) => name !== TAILWIND_PLUGIN_ALLOWLIST[index])
  ) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: "ext-css-tailwind static plugin registry does not match its audited policy",
    });
  }
  for (const name of registeredNames) {
    assertStaticPlugin(name, STATIC_PLUGIN_BY_NAME[name]);
  }
}

assertCompleteStaticRegistry();

/**
 * Resolve an audited plugin from the extension's immutable local registry.
 * Unknown packages and version overrides fail before Tailwind receives a value.
 */
export function loadPlugin(id: string): unknown {
  const name = requirePinnedPlugin(id);
  const plugin = STATIC_PLUGIN_BY_NAME[name];
  assertStaticPlugin(name, plugin);
  return plugin;
}
