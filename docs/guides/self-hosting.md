---
title: "Self-host Veryfront Code"
description: "Build and run a Veryfront project in your own environment."
order: 43
---

Self-host Veryfront Code in your own cloud, private network, or on-premises
environment. Self-hosting does not require a Veryfront account.

## Prerequisites

- A project that passes the [Local quickstart](../getting-started/quickstart.md).
- Inference available from a provider API, an OpenAI-compatible service, or a
  built-in local model. See [Providers](./providers.md).
- A host that supports the current Node.js LTS, Deno, Bun, or containers.

## Check capability support

Choose substitutes for managed capabilities before you deploy.

| Capability                                 | Self-hosted support                     | Requirement                                                                   |
| ------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------- |
| Pages, API routes, AG-UI, tools, and MCP   | Supported                               | Run the project with `veryfront serve`.                                       |
| Direct provider inference                  | Supported                               | Set the selected provider key or configure an OpenAI-compatible endpoint.     |
| Local agent delegation with `delegates`    | Supported                               | Delegates run in the application process.                                     |
| Workflows                                  | Supported                               | Use the in-memory backend or configure Redis for shared durable state.        |
| Source-controlled project knowledge        | Supported                               | Use the local project directory and the project knowledge tools.              |
| Remote integration tools | Supported subset | Use a local source or managed backing API. |
| Sandbox sessions                           | Requires a backing API or service layer | Configure authenticated sandbox session APIs.                                 |
| Veryfront Cloud routing, storage, and runs | Requires Veryfront Cloud                | These capabilities depend on project and control-plane context.               |

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
