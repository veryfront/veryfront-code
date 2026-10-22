---
title: "Self-host Veryfront Code"
description: "Build and run a Veryfront project in your own environment."
order: 43
---

Self-host Veryfront Code in your own cloud, private network, or on-premises
environment. Self-hosting does not require a Veryfront account.

Self-hosted projects can use OIDC application auth with the same declarative
`security.auth.oidc` config used in Cloud. If a reverse proxy already
authenticates users, use `security.auth.trustedProxy` only when the runtime
origin is reachable solely from trusted peers and the proxy strips incoming
identity headers before setting its own. See
[Application authentication](./application-auth.md).

## Prerequisites

- A project that passes the [Local quickstart](../getting-started/quickstart.md).
- Inference available from a provider API, an OpenAI-compatible service, or a
  built-in local model. See [Providers](./providers.md).
- A host that supports the current Node.js LTS, Deno, Bun, or containers.

Set `VERYFRONT_API_URL` before startup to use your own API. HTTP works only
for that configured origin and port. Project `.env` files and later writes cannot
enable it. Use HTTPS unless the API is on a private network you control.

## Check capability support

Choose substitutes for managed capabilities before you deploy.

| Capability                                 | Self-hosted support                     | Requirement                                                               |
| ------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------- |
| Pages, API routes, AG-UI, tools, and MCP   | Supported                               | Run the project with `veryfront serve`.                                   |
| Direct provider inference                  | Supported                               | Set the selected provider key or configure an OpenAI-compatible endpoint. |
| Local agent delegation with `delegates`    | Supported                               | Delegates run in the application process.                                 |
| Workflows                                  | Supported                               | Use the in-memory backend or configure Redis for shared durable state.    |
| Source-controlled project knowledge        | Supported                               | Use the local project directory and the project knowledge tools.          |
| Integration tools                          | Supported subset                        | Use a local catalog source or a managed backing API.                      |
| Sandbox sessions                           | Requires a backing API or service layer | Configure authenticated sandbox session APIs.                             |
| Veryfront Cloud routing, storage, and runs | Requires Veryfront Cloud                | These capabilities depend on project and control-plane context.           |

## Configure local integrations

Allow local integration credentials in the host process before you materialize
any local source, including the catalog source and the Salesforce and Outlook
service-account sources below:

```dotenv title=".env"
VERYFRONT_HOST_ALLOW_LOCAL_INTEGRATION_CREDENTIALS=1
```

This is a host-owned capability. Project environment overlays cannot enable it.
Leave it unset on shared or proxy runtimes. Without it, both sources refuse to
list or execute a tool. If you already run a local source, set this variable
before you upgrade, or discovery starts failing. Veryfront does not infer the
deployment shape. Setting this exact variable authorizes the current non-proxy
process.

Local integration credentials are unavailable inside an effective isolated
worker. The `WORKER_ISOLATION_ENABLED=1` master switch enables no surface by
itself, but an enabled isolation surface runs its project worker with the Deno
`env` permission denied. That worker cannot read this grant or any host
credential. Run local integration sources outside effective isolated worker
surfaces.

For supported fixed REST tools, create a local source with the exact canonical
tool IDs the application grants:

```ts
import { createLocalIntegrationToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const source = createLocalIntegrationToolSource({
  tools: ["salesforce__find_customer"],
});
const integrationTools = await loadRemoteToolsFromSource(source);
```

Pass `integrationTools` to an agent's `tools` option. The source resolves
credentials from the project environment by default and never sends them to
Veryfront. Managed per-user OAuth and connector features outside the supported
local subset still require the configured API layer.

## Run Salesforce integration tools locally

[Set up Salesforce](./integrations/salesforce.md#use-a-service-account) covers credentials and the complete local agent example.

The Salesforce service account source runs the catalog's fixed Salesforce
REST tools without a backing API.

Use a dedicated Salesforce integration user and External Client App with the
OAuth client credentials flow. Existing Connected Apps remain supported. Set
these values in the project environment used by the self-hosted runtime:

```dotenv title=".env"
SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID=<CLIENT_ID>
SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET=<CLIENT_SECRET>
SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL=https://<MY_DOMAIN>.my.salesforce.com
```

The login URL must be the target org's My Domain HTTPS origin. Generic
`login.salesforce.com` and `test.salesforce.com` endpoints are rejected.

Create one materialized tool map for each agent boundary and enumerate the
exact tools that agent can use:

```ts title="lib/case-ingest-salesforce-tools.ts"
import { createSalesforceServiceAccountToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const salesforceSource = createSalesforceServiceAccountToolSource({
  allowedTools: [
    "salesforce__get_case",
    "salesforce__list_case_activity",
    "salesforce__list_cases",
  ],
});

export const salesforceTools = await loadRemoteToolsFromSource(salesforceSource);
```

Pass the materialized tools through the agent's public `tools` field:

```ts title="agents/case-ingest.ts"
import { agent } from "veryfront/agent";
import { salesforceTools } from "../lib/case-ingest-salesforce-tools.ts";

export default agent({
  id: "case-ingest",
  name: "Case ingest",
  model: "openai/gpt-5",
  system: "Read and normalize Salesforce cases.",
  tools: salesforceTools,
});
```

Credentials stay in the local runtime process. Tool discovery exposes only tool names,
descriptions, and input schemas. Credential resolution happens when a tool
executes, and requests go directly to the configured Salesforce org through
an origin-bound outbound transport. Credentials do not enter prompts, tool
metadata, URLs, logs, or project files.

The source does not implement interactive user OAuth. Use the managed backing
API when each tool call must use an individual user's Salesforce connection.

## Run Outlook integration tools locally

Outlook supports two access modes outside Veryfront Cloud. App-only access is
the preferred mode:

- **App-only access** uses Microsoft Entra client credentials and reads one
  configured mailbox. Use it for unattended ingestion, scheduled runs, and
  other project-owned automation.
- **Delegated access** signs in a user with your own Entra app through the
  scaffolded Outlook OAuth template. Use it when each action must run as that
  user.

For app-only access, register an Entra app in the target tenant and grant it
the Microsoft Graph **application** permissions for the tools you list. Grant
only what those tools need:

| Tools                                                                | Application permission      |
| -------------------------------------------------------------------- | --------------------------- |
| Read mail, such as `outlook__list_emails` and `outlook__get_email`   | `Mail.Read`                 |
| Change mail, such as `outlook__move_email` and `outlook__flag_email` | `Mail.ReadWrite`            |
| Send mail, such as `outlook__send_email` and `outlook__reply_email`  | `Mail.Send`                 |
| Read calendars, such as `outlook__list_events`                       | `Calendars.Read`            |
| Change calendars, such as `outlook__create_event`                    | `Calendars.ReadWrite`       |
| Read categories, such as `outlook__list_categories`                  | `MailboxSettings.Read`      |
| Change categories, such as `outlook__create_category`                | `MailboxSettings.ReadWrite` |

An administrator must grant consent for application permissions. Restrict the
app to the configured mailbox with Exchange Online RBAC for Applications or an
application access policy, because an unrestricted application permission
covers every mailbox in the tenant.

Set these values in the project environment used by the self-hosted runtime:

```dotenv title=".env"
OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID=<CLIENT_ID>
OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET=<CLIENT_SECRET>
OUTLOOK_SERVICE_ACCOUNT_TENANT_ID=<TENANT_ID>
OUTLOOK_SERVICE_ACCOUNT_MAILBOX=intake@example.com
```

The tenant must be a tenant ID or verified domain. Multi-tenant aliases such as
`common` are rejected. The mailbox must be its user principal name or Entra
user ID. Graph does not resolve an SMTP address that differs from the user
principal name. A missing or invalid value fails with an error that names the
variable, before any request is sent.

Create a source with the exact Outlook tools the agent can use:

```ts title="lib/mail-intake-outlook-tools.ts"
import { createOutlookServiceAccountToolSource } from "veryfront/integrations";
import { loadRemoteToolsFromSource } from "veryfront/tool";

const outlookSource = createOutlookServiceAccountToolSource({
  allowedTools: [
    "outlook__list_emails",
    "outlook__get_email",
    "outlook__list_attachments",
    "outlook__get_attachment",
  ],
});

export const outlookTools = await loadRemoteToolsFromSource(outlookSource);
```

Every Microsoft Graph request targets `/users/<MAILBOX>`, never `/me`. Catalog
tools whose path is `/users/{mailbox}/...`, such as
`outlook__list_shared_mailbox_emails`, are bound to the configured mailbox and
take no `mailbox` input. Other tools that let the caller choose another
mailbox, including the free/busy tools `outlook__get_schedule` and
`outlook__find_free_time`, are rejected, and so are delegated-only operations
such as `outlook__find_meeting_times`. Tools that change
mailbox or calendar state, such as `outlook__move_email`, are rejected unless
you also pass `allowWrites: true`. `allowWrites` covers every listed write
tool, including `outlook__send_email`, which sends mail as the mailbox. List
only the write tools the project needs.

Each tool request and response is limited to 4 MiB in total, which fits base64
attachment content up to the 3 MB Microsoft Graph inline limit. Larger content
fails with `local-integration-request-invalid` on upload, or
`local-integration-response-invalid` from `outlook__get_attachment`. Agent runs
on the managed hosted executor still limit each whole tool result to just under
1 MiB, so there `outlook__get_attachment` returns attachments up to about 750 KB.

To read a larger attachment in project code, call `readAttachment` on the
source. It requires `outlook__get_attachment` or
`outlook__get_shared_mailbox_attachment` in `allowedTools`, and returns the raw
bytes from Graph `/$value` instead of base64 JSON, up to 32 MiB. A larger
attachment fails with `local-integration-response-invalid`; it is never
truncated. Pass the bytes to `planFileParts`, which reports every file it
leaves out:

```ts title="lib/read-attachment.ts"
import { createOutlookServiceAccountToolSource } from "veryfront/integrations";
import { planFileParts } from "veryfront/llm";

const outlookSource = createOutlookServiceAccountToolSource({
  allowedTools: ["outlook__get_attachment"],
});

export async function attachmentParts(messageId: string, attachmentId: string, filename: string) {
  const content = await outlookSource.readAttachment({ messageId, attachmentId });
  return planFileParts({
    files: [{ bytes: content.bytes, filename, mediaType: content.contentType }],
    maxFileBytes: 10 * 1024 * 1024,
  });
}
```

The source exchanges the client secret at
`login.microsoftonline.com/<TENANT_ID>` for a Graph token and keeps that token
in process memory until shortly before it expires. It stores no refresh token
and writes nothing to disk. Changing any credential variable mints a new token,
so rotate the client secret in Entra and then update the project environment.
Concurrent tool calls share one token request. When Graph rejects a token with
HTTP 401, the source drops it and retries the call once with a new token. A
rejected token request fails with an error that names the credential
variables.
Requests go only to Microsoft origins and never to Veryfront APIs.

This source runs only in your own process. In a run on Veryfront Cloud, use
the hosted `outlook__upload_attachment` tool for a large attachment instead. It
returns an upload reference, not bytes: the API downloads the attachment with
the project's Outlook connection, saves it to project uploads, and returns
`upload_id`, `file_name`, `content_type` and `size`. Delegated connections and
app-only access to the configured mailbox both work. Attachments up to 25 MiB
fit; a larger one fails with an error that names the size and the limit. Pass
`project_reference`, `message_id`, `attachment_id`, and the destination upload
path as `file_path`. An existing upload at that path is returned as is, without
a new download. The tool needs `outlook__get_attachment` enabled for the
project, and the caller needs write access to project uploads.

## Build the project

```bash
veryfront build
```

The build writes browser assets to `dist/`. API routes, agents, workflows, and
tasks remain in the project source.

## Test the production server

```bash
veryfront serve
```

Open [http://localhost:3000](http://localhost:3000) and confirm the app works
with the production build.

## Create a container

You must ship the whole project directory, not just `dist/`. Add a
`.dockerignore` so local dependencies, credentials, and build state stay out of
the image:

```text title=".dockerignore"
.env
.env.*
!.env.example
.git
.veryfront
node_modules
```

Add this `Dockerfile`:

```dockerfile
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
```

`npm ci` installs the project-local Veryfront CLI from the lockfile before the
image builds the app. Copying the package files first also lets Docker reuse the
dependency layer when only application code changes.

Create `.env` with the runtime credentials. Do not commit this file:

```dotenv title=".env"
OPENAI_API_KEY=<API_KEY>
```

Replace `<API_KEY>` with your OpenAI API key before you run the container or
Kubernetes commands.

Build and run the image:

```bash
docker build -t veryfront-app .
docker run --rm -p 3000:3000 --env-file .env veryfront-app
```

Set provider credentials and other secrets through the host environment. The
`.dockerignore` keeps `.env` files out of the image.

## Deploy to Kubernetes

Tag and push the image to a registry that your cluster can read:

```bash
docker tag veryfront-app <REGISTRY>/veryfront-app:<TAG>
docker push <REGISTRY>/veryfront-app:<TAG>
```

Create a namespace and a Secret from the same uncommitted `.env` file:

```bash
kubectl create namespace veryfront-app --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic provider-credentials \
  --namespace veryfront-app \
  --from-env-file=.env \
  --dry-run=client -o yaml | kubectl apply -f -
```

Add `k8s.yaml`. Replace the image placeholder with the immutable tag you
pushed:

```yaml title="k8s.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: veryfront-app
  namespace: veryfront-app
spec:
  replicas: 1
  selector:
    matchLabels:
      app: veryfront-app
  template:
    metadata:
      labels:
        app: veryfront-app
    spec:
      containers:
        - name: app
          image: <REGISTRY>/veryfront-app:<TAG>
          ports:
            - name: http
              containerPort: 3000
          envFrom:
            - secretRef:
                name: provider-credentials
          startupProbe:
            tcpSocket:
              port: http
            periodSeconds: 5
            failureThreshold: 30
          readinessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 5
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: veryfront-app
  namespace: veryfront-app
spec:
  selector:
    app: veryfront-app
  ports:
    - name: http
      port: 80
      targetPort: http
```

Apply the resources and wait for the Deployment:

```bash
kubectl apply -f k8s.yaml
kubectl -n veryfront-app rollout status deployment/veryfront-app
```

When you change `.env`, rerun the Secret command above, then restart the
Deployment so new Pods read the updated values:

```bash
kubectl -n veryfront-app rollout restart deployment/veryfront-app
kubectl -n veryfront-app rollout status deployment/veryfront-app
```

Open a local tunnel to the Service:

```bash
kubectl -n veryfront-app port-forward service/veryfront-app 3000:80
```

Open [http://localhost:3000](http://localhost:3000). Add an Ingress or service
load balancer according to your cluster platform after the local tunnel works.
Keep TLS and public access policy at that boundary.

## Verify it worked

Open [http://localhost:3000](http://localhost:3000) and send a message to the
agent. Confirm the page, API route, and inference provider behave as they did
under `veryfront serve`.

Deploy the same container to any environment that can run it. The runtime does
not require Veryfront Cloud.

For production server options, see the
[Server reference](../api-reference/veryfront/server.md).

## Isolated HTTP broker composition

For a deployment that supplies isolated HTTP executors, compose `createInstalledHttpBroker` and `createRuntimeSourceAuthorizer` from `veryfront/server/http-broker`. The host-owned registry binds each project, named environment and immutable release to its independently admitted source-built image digest and project configuration snapshot. The authorizer first checks the caller’s exact-release read grant, then checks the active environment through the existing project API with a host-owned read-only project credential. Both checks use the fixed HTTPS origin before allocation. Source credentials remain on the broker. They are never copied into executor configuration. Set the broker’s `requestLifetimeMs` to cover the configured host request timeout and supported response streams, including preparation. It defaults to 75 seconds and accepts 1 millisecond through 24 hours; allocator lifetime policy can impose a stricter limit.

Pass the returned `hostedHttp` option to `startProductionServer` in proxy mode with host project execution disabled. Retire the production server and await the broker's shutdown and settlement when stopping the process. The deployment must supply the authenticated broker Pod identity, the existing scoped allocator client and authenticated executor transport. It must independently qualify image provenance and the selected runtime's isolation. Configuration or library tests alone do not establish deployed isolation.
