# @veryfront/ext-blob-s3

> **Category:** Storage | **Contract:** `BlobStorage` | **Explicit**

Use this extension to select AWS S3 or an S3-compatible service as Veryfront's
blob store.

The extension requires Node.js 20 or newer when used from npm. This matches the
minimum runtime supported by the pinned AWS SDK; Deno uses the same explicit
extension package and dependency versions.

## Install and compose

Add the package to the application, then compose it explicitly in
`veryfront.config.ts`:

```ts
import extBlobS3 from "@veryfront/ext-blob-s3";

function requiredEnvironmentVariable(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export default {
  extensions: [
    extBlobS3({
      region: requiredEnvironmentVariable("AWS_REGION"),
      bucket: requiredEnvironmentVariable("VERYFRONT_BLOB_BUCKET"),
      accessKeyId: requiredEnvironmentVariable("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnvironmentVariable("AWS_SECRET_ACCESS_KEY"),
    }),
  ],
};
```

Pass temporary credentials with `sessionToken`. The extension deliberately does
not use the AWS ambient credential chain.

Do not register another extension that provides `BlobStorage` at the same
priority. Veryfront rejects that ambiguous selection.

## Configure the provider

The factory requires these values:

| Option            | Purpose                       |
| ----------------- | ----------------------------- |
| `region`          | AWS signing and bucket region |
| `bucket`          | Destination bucket            |
| `accessKeyId`     | Explicit access-key ID        |
| `secretAccessKey` | Explicit secret access key    |

Use optional settings only when the deployment requires them:

| Option                        | Default                    | Purpose                                              |
| ----------------------------- | -------------------------- | ---------------------------------------------------- |
| `sessionToken`                | unset                      | Temporary-credential token                           |
| `endpoint`                    | AWS S3                     | HTTP(S) endpoint for an S3-compatible service        |
| `forcePathStyle`              | SDK default                | Path-style bucket addressing                         |
| `prefix`                      | empty                      | Prefix prepended to each blob ID                     |
| `baseUrl`                     | unset                      | Public HTTP(S) URL used in returned blob references  |
| `defaultTtl`                  | unset                      | Default expiry in seconds; `0` disables expiry       |
| `autoCreateBucket`            | `false`                    | Check once and create a missing bucket before upload |
| `maxAttempts`                 | `3`                        | SDK attempts, including the initial request          |
| `retryMode`                   | `standard`                 | `standard` or `adaptive` SDK retry mode              |
| `multipartPartSize`           | 8 MiB                      | Part size for unknown-length streams; minimum 5 MiB  |
| `multipartQueueSize`          | `2`                        | Concurrent multipart requests, from 1 through 16     |
| `useDualstackEndpoint`        | `false`                    | Use AWS dual-stack endpoints                         |
| `useFipsEndpoint`             | `false`                    | Use AWS FIPS endpoints                               |
| `useArnRegion`                | `false`                    | Resolve an ARN's region                              |
| `requestChecksumCalculation`  | `WHEN_SUPPORTED`           | Request-checksum policy                              |
| `responseChecksumValidation`  | `WHEN_SUPPORTED`           | Response-checksum policy                             |
| `disableS3ExpressSessionAuth` | `false`                    | Disable S3 Express session authentication            |
| `signal`                      | extension lifecycle signal | Cancel provider operations                           |

Metadata is normalized to lowercase and limited to 100 entries and 2 KiB.
Unknown-length `ReadableStream` uploads use the pinned AWS multipart uploader;
failed or aborted uploads cancel their source stream and configure the uploader
to attempt removal of multipart parts (`leavePartsOnError: false`).

Blob IDs use the framework-wide portable alphabet: ASCII letters, digits,
hyphens, and underscores. Put any provider path hierarchy in `prefix`; IDs with
slashes, whitespace, query syntax, or Unicode are rejected before transport.
`BlobRef.url` is populated only when `baseUrl` is configured.

`endpoint` and `baseUrl` require HTTPS. Plain HTTP is accepted only for
`localhost` and loopback IPs so local emulators remain usable without exposing
payloads or access-key identifiers over an unencrypted remote connection.

## Grant capabilities

Allow outbound network access to the configured S3 endpoint. The AWS SDK also
reads these runtime keys for Lambda recursion detection and internal feature
selection:

- `AWS_LAMBDA_BENCHMARK_MODE`
- `AWS_LAMBDA_FUNCTION_NAME`
- `AWS_LAMBDA_MAX_CONCURRENCY`
- `AWS_LAMBDA_NODEJS_NO_GLOBAL_AWSLAMBDA`
- `AWS_NEW_RETRIES_2026`
- `AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED`
- `SMITHY_NEW_RETRIES_2026`
- `_X_AMZN_TRACE_ID`

If the application reads credentials from environment variables as in the
example, grant those application-level reads separately.

Grant permission to inspect the bucket as well as its objects. An ambiguous S3
`404` from an object metadata request is verified with `HeadBucket`; Veryfront
returns `null`/`false` only after proving the bucket still exists. A missing or
inaccessible bucket remains a provider error.

## Verify the extension

From the Veryfront repository, run:

```sh
deno task --cwd extensions/ext-blob-s3 test
```

The test task grants only the SDK runtime keys listed above. It exercises both
single-request and multipart streaming paths through the real SDK middleware.

## Migrate from core imports

Replace imports from `veryfront/workflow/blob`:

```ts
// Before
import { S3BlobStorage } from "veryfront/workflow/blob";

// After
import { S3BlobStorage } from "@veryfront/ext-blob-s3";
```

Prefer `extBlobS3(config)` in application configuration. Direct class
construction remains available for low-level composition and tests.
