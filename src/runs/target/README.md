# Runs target SDK transport

The typed target SDK uses the host's canonical Veryfront API transport. Configure
the API origin, credentials, retry policy and outbound authorization once, on the
transport, rather than supplying a second fetch implementation to the SDK.

```ts
import { createRunsApiTransport, createRunsSdk } from "veryfront/runs/target";

const token = Deno.env.get("VERYFRONT_API_TOKEN");
if (!token) throw new Error("Set VERYFRONT_API_TOKEN");
const apiUrl = Deno.env.get("VERYFRONT_API_URL");
if (!apiUrl) throw new Error("Set VERYFRONT_API_URL to your API origin");
const transport = createRunsApiTransport({ baseUrl: apiUrl, getToken: () => token });
const sdk = createRunsSdk({ transport });
const runs = await sdk.listProjectRuns({
  path: { project_reference: "<PROJECT_ID>" },
});
```

Replace the former `baseUrl`, `transport: fetch` and `credential` SDK options with
one canonical transport object. For execution-token requests, use a transport
whose `getToken` supplies that execution token. For project API keys, set
`authMode: "api-key"` and return the API key from `getToken`. The host then sends only `X-API-Key`, not
a bearer header. Use `"none"` for public anonymous operations. Direct transport
configuration accepts the same `authMode` values. Credential selection stays in
the host transport rather than the SDK.

`onHeaders` receives captured success headers after the transport attempt ends,
so a caller callback failure cannot retry an already successful mutation.
JSON success bodies and Problem error bodies use the bounded decoder and
attempt deadline. `maxResponseBytes` can set a per-call success-body limit. SSE
uses the same request path and response hook, then yields bounded frames rather
than buffering the entire event stream. The host's transport owns tracing,
metrics, retry decisions, redirect protection and outbound origin authorization.

The target routes remain gated by the consumer integration work in issue #2239;
fixture replay does not establish deployed five-surface parity.

Contract fixtures exercise the real host HTTP stack in
`tests/integration/integrations/runs-target-sdk/client.test.ts`, included in the
existing client-coverage job. Transport boundary regressions and the real
redirect test live under `tests/integration/semantic-unit-boundary/src/runs/target/`.
