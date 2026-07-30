/**
 * Bridge Coordinator
 *
 * Explicit composition entry point for the Studio bridge ESM modules.
 */

import { initConfig } from "./bridge-config.ts";
import { dispose, init } from "./bridge-init.ts";
import {
  installStudioCaptureProvider,
  type StudioCaptureProvider,
  type StudioCaptureProviderInstallation,
} from "./bridge-screenshot.ts";

export interface StudioBridgeOptions {
  /** Optional browser capture capability supplied by an explicit extension. */
  readonly captureProvider?: StudioCaptureProvider;
}

export interface StudioBridgeInstallation {
  /** Dispose the bridge and its capture-provider registration. */
  dispose(): void;
}

let activeInstallation: StudioBridgeInstallation | null = null;
let startInProgress = false;

interface StartupRetirement {
  retry(): void;
}

let retiringStartup: StartupRetirement | null = null;

function createStartupRetirement(
  startupError: unknown,
  captureInstallation: StudioCaptureProviderInstallation | undefined,
): StartupRetirement {
  let bridgeDisposed = false;
  let providerDisposed = captureInstallation === undefined;
  const retirement: StartupRetirement = Object.freeze({
    retry(): void {
      const cleanupErrors: unknown[] = [];
      if (!bridgeDisposed) {
        try {
          dispose();
          bridgeDisposed = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (!providerDisposed) {
        try {
          captureInstallation?.dispose();
          providerDisposed = true;
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [startupError, ...cleanupErrors],
          "Studio bridge startup failed and cleanup is incomplete",
        );
      }
      if (retiringStartup === retirement) retiringStartup = null;
    },
  });
  return retirement;
}

/** Detach and validate the capability composition before touching browser state. */
export function normalizeStudioBridgeOptions(
  value: unknown,
): Readonly<StudioBridgeOptions> {
  if (!value || typeof value !== "object") {
    throw new TypeError("Studio bridge options must be a plain object");
  }

  let prototype: object | null;
  let descriptors: Record<PropertyKey, PropertyDescriptor>;
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value) as Record<
      PropertyKey,
      PropertyDescriptor
    >;
  } catch (cause) {
    throw new TypeError("Studio bridge options could not be inspected", { cause });
  }
  if (isArray) throw new TypeError("Studio bridge options must be a plain object");
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Studio bridge options must be a plain object");
  }

  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length > 1 ||
    keys.some((key) => key !== "captureProvider")
  ) {
    throw new TypeError('Studio bridge options may contain only "captureProvider"');
  }

  const captureDescriptor = descriptors.captureProvider;
  if (!captureDescriptor) return Object.freeze({});
  if (
    !captureDescriptor.enumerable || captureDescriptor.get || captureDescriptor.set
  ) {
    throw new TypeError("Studio bridge captureProvider must be an enumerable data property");
  }
  const captureProvider = captureDescriptor.value;
  if (captureProvider === undefined) return Object.freeze({});
  if (typeof captureProvider !== "function") {
    throw new TypeError("Studio bridge captureProvider must be a function");
  }
  return Object.freeze({ captureProvider });
}

/** Initialize one Studio bridge generation with explicitly supplied capabilities. */
export function startStudioBridge(
  options: Readonly<StudioBridgeOptions> = Object.freeze({}),
): StudioBridgeInstallation {
  if (activeInstallation || startInProgress) {
    throw new Error("Studio bridge is already started");
  }
  startInProgress = true;
  try {
    // A failed generation retains ownership until all of its global cleanup
    // succeeds. A later start is also the explicit retry point.
    retiringStartup?.retry();
    const normalized = normalizeStudioBridgeOptions(options);
    const captureProvider = normalized.captureProvider;
    let captureInstallation: StudioCaptureProviderInstallation | undefined;
    try {
      if (captureProvider !== undefined) {
        captureInstallation = installStudioCaptureProvider(captureProvider);
      }

      // Read config only after capability registration succeeds, then install
      // message listeners. A screenshot cannot race a partially composed bridge.
      initConfig();
      init();

      let bridgeDisposed = false;
      let providerDisposed = false;
      let disposed = false;
      let disposeInProgress = false;
      const installation: StudioBridgeInstallation = Object.freeze({
        dispose(): void {
          if (disposed) return;
          if (disposeInProgress) {
            throw new Error("Studio bridge disposal is already in progress");
          }
          disposeInProgress = true;
          const errors: unknown[] = [];
          try {
            if (!bridgeDisposed) {
              try {
                dispose();
                bridgeDisposed = true;
              } catch (error) {
                errors.push(error);
              }
            }
            if (!providerDisposed) {
              try {
                captureInstallation?.dispose();
                providerDisposed = true;
              } catch (error) {
                errors.push(error);
              }
            }
          } finally {
            disposeInProgress = false;
          }
          if (errors.length > 0) {
            throw errors.length === 1
              ? errors[0]
              : new AggregateError(errors, "Studio bridge disposal failed");
          }
          disposed = true;
          if (activeInstallation === installation) {
            activeInstallation = null;
          }
        },
      });
      activeInstallation = installation;
      return installation;
    } catch (error) {
      const retirement = createStartupRetirement(error, captureInstallation);
      retiringStartup = retirement;
      retirement.retry();
      throw error;
    }
  } finally {
    startInProgress = false;
  }
}
