/**
 * Google Cloud Storage implementation of Veryfront's first-party
 * `BlobStorage` contract.
 *
 * @module extensions/ext-blob-gcs
 */

import type { Extension } from "veryfront/extensions";
import { type BlobStorage, BlobStorageContractName } from "veryfront/workflow/blob";
import { GCSBlobStorage, type GCSBlobStorageConfig } from "./gcs-storage.ts";

/** Create an explicitly configured GCS blob-storage extension. */
export const extBlobGCS = (config: GCSBlobStorageConfig): Extension => {
  const selectedConfig = { ...config };
  interface SetupGeneration {
    readonly controller: AbortController;
    readonly storage: GCSBlobStorage;
  }
  let activeGeneration: SetupGeneration | undefined;

  return {
    name: "ext-blob-gcs",
    version: "0.1.0",
    contracts: {
      provides: ["BlobStorage"],
    },
    capabilities: [
      {
        type: "net:outbound",
        hosts: ["oauth2.googleapis.com", "storage.googleapis.com"],
      },
    ],
    setup(ctx) {
      if (activeGeneration) throw new Error("ext-blob-gcs is already set up");
      selectedConfig.signal?.throwIfAborted();
      ctx.signal?.throwIfAborted();
      const controller = new AbortController();
      const signal = AbortSignal.any([
        controller.signal,
        ...(selectedConfig.signal ? [selectedConfig.signal] : []),
        ...(ctx.signal ? [ctx.signal] : []),
      ]);
      const generation: SetupGeneration = {
        controller,
        storage: new GCSBlobStorage({ ...selectedConfig, signal }),
      };
      try {
        signal.throwIfAborted();
        ctx.provide<BlobStorage>(BlobStorageContractName, generation.storage);
        signal.throwIfAborted();
        activeGeneration = generation;
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException("GCS blob extension setup failed.", "AbortError"));
        }
        generation.storage.close();
        throw error;
      }
      try {
        ctx.logger.debug("[ext-blob-gcs] BlobStorage registered");
      } catch {
        // Diagnostics must not invalidate a successfully registered provider.
      }
    },
    teardown() {
      const generation = activeGeneration;
      if (!generation) return;
      activeGeneration = undefined;
      if (!generation.controller.signal.aborted) {
        generation.controller.abort(
          new DOMException("GCS blob extension is shutting down.", "AbortError"),
        );
      }
      generation.storage.close();
    },
  };
};

export default extBlobGCS;
export { GCSBlobStorage } from "./gcs-storage.ts";
export type { GCSBlobStorageConfig, GCSBlobStorageDependencies, GCSFetch } from "./gcs-storage.ts";
