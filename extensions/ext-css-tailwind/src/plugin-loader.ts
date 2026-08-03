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

function getStaticPlugin(name: string): unknown {
  switch (name) {
    case "@tailwindcss/forms":
      return forms;
    case "@tailwindcss/typography":
      return typography;
    case "daisyui":
      return daisyui;
    case "tailwind-scrollbar-hide":
      return scrollbarHide;
    case "tailwindcss-animate":
      return tailwindcssAnimate;
    default:
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: `Tailwind plugin "${name}" is absent from the static extension registry`,
      });
  }
}

function requirePinnedPlugin(specifier: string): string {
  try {
    return resolveTailwindPluginPolicy(specifier).name;
  } catch (cause) {
    const displayName = typeof specifier === "string" ? bareName(specifier) : "<non-string>";
    throw SECURITY_VIOLATION.create({
      detail: `Package "${displayName}" is not an audited ext-css-tailwind plugin`,
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
  for (let index = 0; index < TAILWIND_PLUGIN_ALLOWLIST.length; index++) {
    const name = TAILWIND_PLUGIN_ALLOWLIST[index];
    if (name === undefined) {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: "ext-css-tailwind plugin policy contains an invalid entry",
      });
    }
    assertStaticPlugin(name, getStaticPlugin(name));
  }
}

assertCompleteStaticRegistry();

/**
 * Resolve an audited plugin from the extension's immutable local registry.
 * Unknown packages and version overrides fail before Tailwind receives a value.
 */
export function loadPlugin(id: string): unknown {
  const name = requirePinnedPlugin(id);
  const plugin = getStaticPlugin(name);
  assertStaticPlugin(name, plugin);
  return plugin;
}
