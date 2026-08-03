/**
 * AWS S3 implementation of Veryfront's first-party `BlobStorage` contract.
 *
 * @module extensions/ext-blob-s3
 */

import { composeAbortSignals, type Extension } from "veryfront/extensions";
import { type BlobStorage, BlobStorageContractName } from "veryfront/workflow/blob";
import { S3BlobStorage, type S3BlobStorageConfig } from "./s3-storage.ts";

/** Create an explicitly configured S3 blob-storage extension. */
export const extBlobS3 = (config: S3BlobStorageConfig): Extension => {
  const selectedConfig = { ...config };
  interface SetupGeneration {
    readonly controller: AbortController;
    readonly storage: S3BlobStorage;
  }
  let activeGeneration: SetupGeneration | undefined;
  let retiringGeneration: SetupGeneration | undefined;

  return {
    name: "ext-blob-s3",
    version: "0.1.0",
    contracts: {
      provides: ["BlobStorage"],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      {
        type: "env:read",
        keys: [
          "AWS_LAMBDA_BENCHMARK_MODE",
          "AWS_LAMBDA_FUNCTION_NAME",
          "AWS_LAMBDA_MAX_CONCURRENCY",
          "AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA",
          "AWS_NEW_RETRIES_2026",
          "AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED",
          "SMITHY_NEW_RETRIES_2026",
          "_X_AMZN_TRACE_ID",
        ],
      },
    ],
    setup(ctx) {
      if (activeGeneration) throw new Error("ext-blob-s3 is already set up");
      if (retiringGeneration) {
        throw new Error("ext-blob-s3 teardown has not completed");
      }
      selectedConfig.signal?.throwIfAborted();
      ctx.signal?.throwIfAborted();
      const controller = new AbortController();
      const signal = composeAbortSignals([
        controller.signal,
        ...(selectedConfig.signal ? [selectedConfig.signal] : []),
        ...(ctx.signal ? [ctx.signal] : []),
      ]);
      const generation: SetupGeneration = {
        controller,
        storage: new S3BlobStorage({ ...selectedConfig, signal }),
      };
      try {
        signal.throwIfAborted();
        ctx.provide<BlobStorage>(BlobStorageContractName, generation.storage);
        signal.throwIfAborted();
        activeGeneration = generation;
      } catch (error) {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException("S3 blob extension setup failed.", "AbortError"));
        }
        try {
          generation.storage.close();
        } catch (rollbackError) {
          retiringGeneration = generation;
          throw new AggregateError(
            [error, rollbackError],
            "ext-blob-s3 setup failed and resource rollback was incomplete",
          );
        }
        throw error;
      }
      try {
        ctx.logger.debug("[ext-blob-s3] BlobStorage registered");
      } catch {
        // Diagnostics must not invalidate a successfully registered provider.
      }
    },
    teardown() {
      const generation = retiringGeneration ?? activeGeneration;
      if (!generation) return;
      if (activeGeneration === generation) {
        activeGeneration = undefined;
        retiringGeneration = generation;
        if (!generation.controller.signal.aborted) {
          generation.controller.abort(
            new DOMException("S3 blob extension is shutting down.", "AbortError"),
          );
        }
      }
      generation.storage.close();
      if (retiringGeneration === generation) retiringGeneration = undefined;
    },
  };
};

export default extBlobS3;
export { S3BlobStorage } from "./s3-storage.ts";
export type {
  S3BlobStorageClient,
  S3BlobStorageCommand,
  S3BlobStorageConfig,
  S3BlobStorageDependencies,
  S3BlobStorageSendOptions,
} from "./s3-storage.ts";
export type {
  S3BlobStorageStreamUploader,
  S3BlobStorageStreamUploadInput,
} from "./multipart-upload.ts";
