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

Allow local integration credentials in the host process before you materialize
any local source, both the catalog source and the Salesforce service-account
source below:

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
