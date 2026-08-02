/**
 * Extension boundary for a renderer loaded inside an isolated project worker.
 *
 * Core transports only a validated local module URL and its required local
 * read roots. The extension-owned module is responsible for importing and
 * adapting its rendering library inside the worker realm.
 */

import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

export const IsolatedSsrRendererProviderName = "IsolatedSsrRendererProvider";
export const MAX_ISOLATED_SSR_RENDERER_READ_ROOTS = 16;
export const MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS = 4_096;

export interface IsolatedSsrRendererProvider {
  /** Absolute local module URL exporting `createIsolatedSsrRenderer`. */
  readonly moduleUrl: string;
  /** Absolute local directory URLs needed to load that module and its imports. */
  readonly readRootUrls: readonly string[];
}

export interface IsolatedSsrRenderer {
  createElement(
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown;
  renderToReadableStream(element: unknown): Promise<ReadableStream<Uint8Array>>;
}

export interface IsolatedSsrRendererModule {
  createIsolatedSsrRenderer(): IsolatedSsrRenderer;
}

function validateAbsoluteLocalFileUrl(
  value: unknown,
  label: string,
  directory: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ISOLATED_SSR_RENDERER_URL_CHARACTERS ||
    !value.startsWith("file:///")
  ) {
    throw new TypeError(`${label} must be an absolute local file URL`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new TypeError(`${label} must be an absolute local file URL`, { cause });
  }
  if (
    url.protocol !== "file:" ||
    url.hostname !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname.length === 0 ||
    /%00/i.test(url.pathname) ||
    (directory ? !url.pathname.endsWith("/") : url.pathname.endsWith("/"))
  ) {
    throw new TypeError(`${label} must be an absolute local file URL`);
  }
  return url.href;
}

/** Validate one worker renderer module URL without resolving or importing it. */
export function validateIsolatedSsrRendererModuleUrl(value: unknown): string {
  return validateAbsoluteLocalFileUrl(
    value,
    "Isolated SSR renderer moduleUrl",
    false,
  );
}

/**
 * Snapshot an extension-owned provider without invoking accessors or retaining
 * mutable provider metadata.
 */
export function snapshotIsolatedSsrRendererProvider(
  value: unknown,
): Readonly<IsolatedSsrRendererProvider> {
  if (!value || typeof value !== "object") {
    throw new TypeError("Isolated SSR renderer provider must be an object");
  }

  let descriptors: Record<string, PropertyDescriptor>;
  let isArray: boolean;
  try {
    if (isProxyWithoutHooks(value)) {
      throw new TypeError("Isolated SSR renderer provider must not be a proxy");
    }
    isArray = Array.isArray(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError("Isolated SSR renderer provider could not be inspected", { cause });
  }
  if (isArray) {
    throw new TypeError("Isolated SSR renderer provider must be an object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Isolated SSR renderer provider must be a plain object");
  }

  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== 2 ||
    !Object.hasOwn(descriptors, "moduleUrl") ||
    !Object.hasOwn(descriptors, "readRootUrls") ||
    keys.some((key) => key !== "moduleUrl" && key !== "readRootUrls")
  ) {
    throw new TypeError(
      'Isolated SSR renderer provider must contain only "moduleUrl" and "readRootUrls"',
    );
  }

  const moduleDescriptor = descriptors.moduleUrl;
  const rootsDescriptor = descriptors.readRootUrls;
  if (
    !moduleDescriptor?.enumerable ||
    moduleDescriptor.get ||
    moduleDescriptor.set
  ) {
    throw new TypeError("Isolated SSR renderer provider moduleUrl must be a data property");
  }
  if (
    !rootsDescriptor?.enumerable ||
    rootsDescriptor.get ||
    rootsDescriptor.set ||
    !Array.isArray(rootsDescriptor.value)
  ) {
    throw new TypeError(
      "Isolated SSR renderer provider readRootUrls must be an array data property",
    );
  }

  const roots = rootsDescriptor.value as unknown[];
  let rootDescriptors: Record<string, PropertyDescriptor>;
  try {
    if (isProxyWithoutHooks(roots)) {
      throw new TypeError("Isolated SSR renderer provider readRootUrls must not be a proxy");
    }
    rootDescriptors = Object.getOwnPropertyDescriptors(roots);
  } catch (cause) {
    throw new TypeError("Isolated SSR renderer provider readRootUrls could not be inspected", {
      cause,
    });
  }
  const rootKeys = Reflect.ownKeys(rootDescriptors);
  if (
    roots.length === 0 ||
    roots.length > MAX_ISOLATED_SSR_RENDERER_READ_ROOTS ||
    rootKeys.length !== roots.length + 1
  ) {
    throw new TypeError(
      "Isolated SSR renderer provider readRootUrls must be a dense bounded array",
    );
  }

  const readRootUrls: string[] = [];
  for (let index = 0; index < roots.length; index++) {
    const descriptor = rootDescriptors[String(index)];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      throw new TypeError(
        "Isolated SSR renderer provider readRootUrls must contain data properties",
      );
    }
    readRootUrls.push(
      validateAbsoluteLocalFileUrl(
        descriptor.value,
        `Isolated SSR renderer readRootUrls[${index}]`,
        true,
      ),
    );
  }

  return Object.freeze({
    moduleUrl: validateIsolatedSsrRendererModuleUrl(moduleDescriptor.value),
    readRootUrls: Object.freeze(readRootUrls),
  });
}

/** Create immutable registration metadata for an extension factory. */
export function createIsolatedSsrRendererProvider(
  moduleUrl: string,
  readRootUrls: readonly string[],
): Readonly<IsolatedSsrRendererProvider> {
  return snapshotIsolatedSsrRendererProvider({
    moduleUrl,
    readRootUrls: [...readRootUrls],
  });
}
