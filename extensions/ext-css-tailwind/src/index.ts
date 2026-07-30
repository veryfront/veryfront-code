/** Tailwind CSS implementation of the provider-neutral CSSProcessor contract. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ExtensionFactory } from "veryfront/extensions";
import { type CSSCompiler, type CSSProcessor, CSSProcessorName } from "veryfront/extensions/css";
import { IMPORT_RESOLUTION_ERROR } from "veryfront/errors";
import { compile } from "tailwindcss";
import extensionPackage from "../deno.json" with { type: "json" };
import { exactTailwindVersion } from "./manifest-dependency.ts";
import { loadPlugin } from "./plugin-loader.ts";
import { TAILWIND_PLUGIN_POLICY_IDENTITY } from "./plugin-policy.ts";

const ENGINE_SEMANTICS_VERSION = "veryfront.css-tailwind.v4";
const tailwindVersion = exactTailwindVersion(extensionPackage.imports.tailwindcss);
export const TAILWIND_DEFAULT_STYLESHEET = `@import "tailwindcss";
@plugin "@tailwindcss/typography";
@custom-variant dark (&:is(.dark, [data-theme="dark"]) *, &:is(.dark, [data-theme="dark"]));`;
function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function loadTailwindBaseStylesheet(): string {
  const resolved = import.meta.resolve("tailwindcss/index.css");
  try {
    return readFileSync(new URL(resolved), "utf8");
  } catch (cause) {
    throw IMPORT_RESOLUTION_ERROR.create({
      detail: `ext-css-tailwind could not read its pinned base stylesheet: ${resolved}`,
      cause,
    });
  }
}

const tailwindBaseStylesheet = loadTailwindBaseStylesheet();

function assertEmptyConfig(value: unknown): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("ext-css-tailwind config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = Object.getPrototypeOf(value);
    keys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-css-tailwind config could not be inspected", { cause });
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("ext-css-tailwind config must not inherit configuration");
  }
  if (keys.length !== 0) {
    throw new TypeError("ext-css-tailwind does not accept configuration properties");
  }
}

export class TailwindCSSProcessor implements CSSProcessor {
  readonly cacheIdentity: string;
  readonly defaultStylesheet = TAILWIND_DEFAULT_STYLESHEET;

  constructor() {
    this.cacheIdentity = [
      ENGINE_SEMANTICS_VERSION,
      `ext-css-tailwind@${extensionPackage.version}`,
      `tailwindcss@${tailwindVersion}`,
      `base=${sha256(tailwindBaseStylesheet)}`,
      `default=${sha256(this.defaultStylesheet)}`,
      `plugins=${sha256(TAILWIND_PLUGIN_POLICY_IDENTITY)}`,
    ].join(";");
    Object.freeze(this);
  }

  async compile(stylesheet: string): Promise<CSSCompiler> {
    const native = await compile(stylesheet, {
      base: "/",
      loadStylesheet: (id: string) => {
        if (id !== "tailwindcss") {
          throw IMPORT_RESOLUTION_ERROR.create({
            detail: `ext-css-tailwind cannot resolve stylesheet import "${id}"`,
          });
        }
        return Promise.resolve({
          content: tailwindBaseStylesheet,
          base: "/",
          path: "/tailwindcss/index.css",
        });
      },
      loadModule: (id: string) =>
        Promise.resolve({
          // deno-lint-ignore no-explicit-any -- Tailwind's vendor API accepts opaque plugin modules.
          module: loadPlugin(id) as any,
          base: "/",
          path: "/",
        }),
    });
    return {
      build(candidates: string[]): string {
        return native.build(candidates);
      },
    };
  }
}

const extTailwind: ExtensionFactory = (config) => {
  assertEmptyConfig(config);
  return {
    name: "ext-css-tailwind",
    version: extensionPackage.version,
    contracts: { provides: [CSSProcessorName] },
    capabilities: [{ type: "fs:read" }],
    setup(ctx) {
      ctx.provide(CSSProcessorName, new TailwindCSSProcessor());
      ctx.logger.debug(`[ext-css-tailwind] ${CSSProcessorName} registered`);
    },
  };
};

export default extTailwind;
