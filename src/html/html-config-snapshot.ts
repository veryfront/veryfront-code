import type { VeryfrontConfig } from "#veryfront/config";
import { assertHTMLJsonValueIsNotProxy, snapshotHTMLJsonValue } from "./json-snapshot.ts";

interface ConfigProjection {
  readonly [key: string]: true | ConfigProjection;
}

const SHELL_CONFIG_PROJECTION = {
  react: { version: true },
  directories: { app: true, pages: true },
  client: {
    moduleResolution: true,
    cdn: {
      provider: true,
      versions: { react: true, veryfront: true },
    },
  },
  dev: { hmr: true, components: true },
} as const satisfies ConfigProjection;

const HYDRATION_CONFIG_PROJECTION = {
  directories: { app: true },
} as const satisfies ConfigProjection;

function projectConfigOwnData(
  value: unknown,
  projection: ConfigProjection,
  label: string,
): unknown {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

  assertHTMLJsonValueIsNotProxy(value, label);
  let prototype: object | null;
  try {
    prototype = Reflect.getPrototypeOf(value);
  } catch {
    throw new TypeError(`${label} cannot be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const projected = Object.create(null) as Record<string, unknown>;
  for (const [key, childProjection] of Object.entries(projection)) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError(`${label}.${key} cannot be inspected`);
    }
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an own data property`);
    }
    if (descriptor.value === undefined) continue;

    const child = childProjection === true ? descriptor.value : projectConfigOwnData(
      descriptor.value,
      childProjection,
      `${label}.${key}`,
    );
    Object.defineProperty(projected, key, {
      configurable: true,
      enumerable: true,
      value: child,
      writable: true,
    });
  }
  return projected;
}

function snapshotProjectedConfig(
  config: unknown,
  projection: ConfigProjection,
  label: string,
): VeryfrontConfig {
  const projected = projectConfigOwnData(config, projection, label);
  return snapshotHTMLJsonValue(projected, label) as VeryfrontConfig;
}

/** Capture exactly the public config leaves consumed by asynchronous shell work. */
export function snapshotHTMLShellConfig(config: unknown): VeryfrontConfig {
  return snapshotProjectedConfig(
    config,
    SHELL_CONFIG_PROJECTION,
    "HTML shell config",
  );
}

/** Capture exactly the public config leaves serialized into hydration data. */
export function snapshotHTMLHydrationConfig(config: unknown): VeryfrontConfig {
  return snapshotProjectedConfig(
    config,
    HYDRATION_CONFIG_PROJECTION,
    "Hydration config",
  );
}
