# @veryfront/ext-blob-gcs

> **Category:** Storage | **Contract:** `BlobStorage` | **Explicit**

Use this extension to select Google Cloud Storage as Veryfront's blob store.

## Install and compose

Add the package to the application, then compose it explicitly in
`veryfront.config.ts`:

```ts
import extBlobGCS from "@veryfront/ext-blob-gcs";

function requiredEnvironmentVariable(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export default {
  extensions: [
    extBlobGCS({
      bucket: requiredEnvironmentVariable("VERYFRONT_BLOB_BUCKET"),
      serviceAccountKey: requiredEnvironmentVariable("GOOGLE_SERVICE_ACCOUNT_JSON"),
    }),
  ],
};
```

Supply the complete service-account JSON as `serviceAccountKey`. The extension
uses its `client_email` and PKCS8 `private_key`; it does not probe ambient Google
credentials.

Do not register another extension that provides `BlobStorage` at the same
priority. Veryfront rejects that ambiguous selection.

## Configure the provider

The factory requires these values:

| Option              | Purpose                                                          |
| ------------------- | ---------------------------------------------------------------- |
| `bucket`            | Destination Cloud Storage bucket                                 |
| `serviceAccountKey` | Service-account JSON containing `client_email` and `private_key` |

Optional settings are:

| Option               | Default                    | Purpose                                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `prefix`             | empty                      | Prefix prepended to each blob ID                                               |
| `baseUrl`            | unset                      | Public HTTP(S) URL used in returned blob references                            |
| `defaultTtl`         | unset                      | Default expiry in seconds; `0` disables expiry                                 |
| `resumableChunkSize` | 8 MiB                      | Unknown-length stream chunk size; 256 KiB multiple from 256 KiB through 64 MiB |
| `signal`             | extension lifecycle signal | Cancel token and storage operations                                            |

Metadata is normalized to lowercase and limited to 100 entries and 8 KiB,
including Veryfront's internal expiry value. Unknown-length streams use bounded,
aligned resumable chunks and validate every provider acknowledgement before
sending the next chunk.

TTL metadata reserves one of the 100 entries, so callers may supply at most 99
entries when expiry is enabled. Blob IDs use the framework-wide portable
alphabet: ASCII letters, digits, hyphens, and underscores. Put any provider path
hierarchy in `prefix`; IDs with slashes, whitespace, query syntax, or Unicode
are rejected before transport.

`BlobRef.url` is omitted unless `baseUrl` is explicitly configured. The JSON
API's `mediaLink` normally requires authorization and is therefore not exposed
as a public URL. `baseUrl` requires HTTPS except for `localhost` or a loopback
IP used during local development.

## Grant capabilities

Allow outbound HTTPS access to:

- `oauth2.googleapis.com`
- `storage.googleapis.com`

The extension requests the `devstorage.read_write` OAuth scope and does not read
environment variables. If the application reads the service-account JSON from
an environment variable as in the example, grant that application-level read
separately.

Grant the service account object access plus `storage.buckets.get`. When an
object request returns `404`, Veryfront verifies that the bucket still exists
before returning `null` or `false`; a missing or inaccessible bucket remains a
provider error.

## Verify the extension

From the Veryfront repository, run:

```sh
deno task --cwd extensions/ext-blob-gcs test
```

The test task needs no runtime permissions. It verifies JWT signing, token
coalescing, trusted resumable sessions, aligned range acknowledgements, bounded
responses, cancellation, and contract registration.

## Migrate from core imports

Replace imports from `veryfront/workflow/blob`:

```ts
// Before
import { GCSBlobStorage } from "veryfront/workflow/blob";

// After
import { GCSBlobStorage } from "@veryfront/ext-blob-gcs";
```

Remove the former `projectId` option; it was not used to identify requests and
could imply quota or billing behavior that this storage contract does not own.
Prefer `extBlobGCS(config)` in application configuration. Direct class
construction remains available for low-level composition and tests.
