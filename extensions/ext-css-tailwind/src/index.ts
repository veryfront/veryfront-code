/** Tailwind CSS implementation of the provider-neutral CSSProcessor contract. */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isProxy as isProxyWithoutHooks } from "node:util/types";
import type { ExtensionFactory } from "veryfront/extensions";
import { type CSSCompiler, type CSSProcessor, CSSProcessorName } from "veryfront/extensions/css";
import { IMPORT_RESOLUTION_ERROR } from "veryfront/errors";
import { compile } from "tailwindcss";
import extensionPackage from "../deno.json" with { type: "json" };
import { exactTailwindVersion } from "./manifest-dependency.ts";
import { loadPlugin } from "./plugin-loader.ts";
import { TAILWIND_PLUGIN_POLICY_IDENTITY } from "./plugin-policy.ts";

const ENGINE_SEMANTICS_VERSION = "veryfront.css-tailwind.v4";
const apply = Reflect.apply;
const arrayJoin = Array.prototype.join;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const getPrototypeOf = Object.getPrototypeOf;
const isArray = Array.isArray;
const objectPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;
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
  if (
    typeof value !== "object" ||
    value === null ||
    isArray(value) ||
    isProxyWithoutHooks(value)
  ) {
    throw new TypeError("ext-css-tailwind config must be an object");
  }
  let prototype: object | null;
  let keys: PropertyKey[];
  try {
    prototype = getPrototypeOf(value);
    keys = ownKeys(getOwnPropertyDescriptors(value));
  } catch (cause) {
    throw new TypeError("ext-css-tailwind config could not be inspected", { cause });
  }
  if (prototype !== objectPrototype && prototype !== null) {
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
    const identityParts = [
      ENGINE_SEMANTICS_VERSION,
      `ext-css-tailwind@${extensionPackage.version}`,
      `tailwindcss@${tailwindVersion}`,
      `base=${sha256(tailwindBaseStylesheet)}`,
      `default=${sha256(this.defaultStylesheet)}`,
      `plugins=${sha256(TAILWIND_PLUGIN_POLICY_IDENTITY)}`,
    ];
    this.cacheIdentity = apply(arrayJoin, identityParts, [";"]) as string;
    freeze(this);
  }

  async compile(stylesheet: string): Promise<CSSCompiler> {
    if (typeof stylesheet !== "string") {
      throw new TypeError("ext-css-tailwind stylesheet must be a string");
    }
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
    const buildDescriptor = getOwnPropertyDescriptor(native, "build");
    if (
      buildDescriptor === undefined ||
      !("value" in buildDescriptor) ||
      typeof buildDescriptor.value !== "function"
    ) {
      throw IMPORT_RESOLUTION_ERROR.create({
        detail: "ext-css-tailwind compiler did not expose a stable build method",
      });
    }
    const nativeBuild = buildDescriptor.value as (candidates: string[]) => string;
    return freeze({
      build(candidates: string[]): string {
        return apply(nativeBuild, native, [candidates]) as string;
      },
    });
  }
}

freeze(TailwindCSSProcessor.prototype);
freeze(TailwindCSSProcessor);

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
