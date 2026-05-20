---
title: "Production path"
description: "Build one Veryfront route from local project to production verification."
order: 10
---

Take one Veryfront route from local dev to a deployed production check. Each step adds one piece: a project, a primitive, a user-visible surface, then the production verification loop.

## Prerequisites

- The current Node.js LTS.
- A terminal that can run the Veryfront CLI.
- Production credentials for any provider, integration, or deployment target
  your project uses.

## Path overview

| Step | Goal                                            | Guide                                                                                        |
| ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1    | Create and run a local app.                     | [Create a project](./create-a-project.md)                                                                |
| 2    | Pick the smallest primitive for the work.       | [Choose a primitive](./choose-a-primitive.md)                                                |
| 3    | Add the user-visible route or API boundary.     | [Pages and routing](./pages-and-routing.md), [API routes](./api-routes.md)                   |
| 4    | Add the primitive only when the route needs it. | [Agents](./agents.md), [Tools](./tools.md), [Workflows](./workflows.md), [Tasks](./tasks.md) |
| 5    | Build, run, and deploy the production app.      | [Building and deploying](./deploying.md)                                                     |

## Create the project

Start from a template that matches the product shape you want to test.

```bash
veryfront init production-path --template minimal
cd production-path
veryfront dev
```

Open `http://localhost:3000` and keep the dev server running while you add the
first route.

## Choose the primitive

Before adding an agent, workflow, job, or integration, check the smallest
matching primitive:

| Need                             | Start with             |
| -------------------------------- | ---------------------- |
| Render UI or content             | Page                   |
| Return HTTP data                 | API route              |
| Let a model use typed capability | Tool                   |
| Run a conversational model       | Agent                  |
| Coordinate multiple steps        | Workflow               |
| Run background or scheduled work | Task, job, or cron job |

Use [Choose a primitive](./choose-a-primitive.md) when more than one option
looks valid. Add only the primitive that the route needs now.

## Add one route boundary

Pick one boundary and make it observable in both dev and production.

| Boundary                 | Add                                          | Verify locally                                |
| ------------------------ | -------------------------------------------- | --------------------------------------------- |
| Page                     | `app/page.tsx` or another route under `app/` | Open the route in the browser.                |
| API route                | `app/api/<name>/route.ts`                    | Run `curl http://localhost:3000/api/<name>`.  |
| Agent chat               | Page plus `app/api/ag-ui/route.ts`           | Send one message and confirm streamed output. |
| Workflow or task trigger | API route or CLI command                     | Trigger one run and inspect the result.       |

Keep the first production path narrow. Once it works end to end, add more pages, agents, integrations, or jobs behind the same verification loop.

## Build and run production locally

Stop the dev server, then run the production build locally:

```bash
veryfront build
veryfront start
```

Open `http://localhost:3000` again and test the same route or API endpoint you
tested in dev.

## Deploy

Deploy after the local production server matches the dev behavior:

```bash
veryfront deploy
```

For a non-Cloud target, use the build output from `veryfront build` and follow
the target host's runtime requirements.

## Verify it worked

Use the same checks at each stage:

| Stage               | Check                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Dev                 | `veryfront dev` prints a local URL and the route responds.                        |
| Local production    | `veryfront build` exits successfully and `veryfront start` serves the same route. |
| Deployed production | `veryfront deploy` completes, then `veryfront open` opens the deployed route.     |

For API routes, compare the dev and production responses with `curl`. For pages, open the same path in both environments. For agents, workflows, tasks, jobs, or integrations, trigger one minimal run and confirm the expected output or status.

Use `veryfront open --json` when you need the deployed URL in a script or a terminal-only check.

## Next

- [Building and deploying](./deploying.md): configure production builds and deployment targets
- [Configuration](./configuration.md): set runtime and build options
- [Head and SEO](./head-and-seo.md): prepare public pages for search and previews

## Related

- [`veryfront` root reference](../reference/veryfront/index.md): config and runtime exports
- [Project structure](./project-structure.md): file conventions and auto-discovery
- [Pages and routing](./pages-and-routing.md): route files, layouts, and navigation
- [API routes](./api-routes.md): HTTP handlers and streaming responses
