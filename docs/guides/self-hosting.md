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

Build and run it:

```bash
docker build -t veryfront-app .
docker run --rm -p 3000:3000 --env-file .env veryfront-app
```

Set provider credentials and other secrets through the host environment. The
`.dockerignore` keeps `.env` files out of the image.

## Verify it worked

Open [http://localhost:3000](http://localhost:3000) and send a message to the
agent. Confirm the page, API route, and inference provider behave as they did
under `veryfront serve`.

Deploy the same container to any environment that can run it. The runtime does
not require Veryfront Cloud.

For production server options, see the
[Server reference](../api-reference/veryfront/server.md).
