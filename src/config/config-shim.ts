import { defineConfig, defineConfigWithEnv, mergeConfigs } from "./define-config.ts";
import { getEnv } from "#veryfront/platform/compat/process/env.ts";

export type ConfigShimBridge = Readonly<{
  defineConfig: typeof defineConfig;
  defineConfigWithEnv: typeof defineConfigWithEnv;
  getEnv: typeof getEnv;
  mergeConfigs: typeof mergeConfigs;
}>;

export type ConfigShimModule = Readonly<{
  source: string;
  url: string;
}>;

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Encode JavaScript source as deterministic UTF-8 base64 without relying on
 * Node-specific globals.
 *
 * @internal
 */
export function encodeConfigShimSource(source: string): string {
  const bytes = new TextEncoder().encode(source);
  let encoded = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const hasSecond = index + 1 < bytes.length;
    const hasThird = index + 2 < bytes.length;
    const second = hasSecond ? bytes[index + 1] ?? 0 : 0;
    const third = hasThird ? bytes[index + 2] ?? 0 : 0;

    encoded += BASE64_ALPHABET.charAt(first >> 2);
    encoded += BASE64_ALPHABET.charAt(((first & 0x03) << 4) | (second >> 4));
    encoded += hasSecond ? BASE64_ALPHABET.charAt(((second & 0x0f) << 2) | (third >> 6)) : "=";
    encoded += hasThird ? BASE64_ALPHABET.charAt(third & 0x3f) : "=";
  }

  return encoded;
}

export function createConfigShimModule(
  name: string,
  bridge: ConfigShimBridge,
): ConfigShimModule {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new TypeError(`Invalid config shim name "${name}"`);
  }

  const bridgeKey = `__veryfrontConfigShimBridgeV1:${name}:${crypto.randomUUID()}`;
  const frozenBridge = Object.freeze({ ...bridge });
  Object.defineProperty(globalThis, bridgeKey, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: frozenBridge,
  });

  const source = [
    `const bridge = globalThis[${JSON.stringify(bridgeKey)}];`,
    'if (!bridge) throw new Error("Veryfront config helper bridge is unavailable");',
    "export const defineConfig = bridge.defineConfig;",
    "export const defineConfigWithEnv = bridge.defineConfigWithEnv;",
    "export const getEnv = bridge.getEnv;",
    "export const mergeConfigs = bridge.mergeConfigs;",
  ].join("\n");

  return Object.freeze({
    source,
    url: `data:text/javascript;base64,${encodeConfigShimSource(source)}`,
  });
}

const defaultConfigShim = createConfigShimModule("loader", {
  defineConfig,
  defineConfigWithEnv,
  getEnv,
  mergeConfigs,
});

/** Source for the bare `veryfront` module used while evaluating project config. */
export const VERYFRONT_CONFIG_SHIM_SOURCE = defaultConfigShim.source;

/** Data URL form used by temp-file config imports. */
export const VERYFRONT_CONFIG_SHIM_URL = defaultConfigShim.url;
