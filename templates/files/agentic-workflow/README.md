# Agentic Workflow

Orchestrated multi-step processes with human approval gates.

## What's included

- Content pipeline workflow (research, write, review, publish)
- Parallel step execution
- Human-in-the-loop approval gates
- Dashboard to start, monitor, and approve workflow runs

## Structure

```
agents/
  researcher.ts                Research agent
  writer.ts                    Writing agent
tools/publish.ts               Publish tool
workflows/content-pipeline.ts  Workflow definition
lib/workflows.ts               Workflow client that runs the pipeline
app/
  api/workflows/[...path]/     Workflow API routes (start, list, approve)
  page.tsx                     Workflow dashboard
  workflows/[id]/page.tsx      Run detail and approval UI
```

Runs execute in the dev server and pause at the approval gate until you approve
or reject them. The agents need a model: set `OPENAI_API_KEY`, or connect the
project to Veryfront Cloud. Runs are kept in memory and reset when the server
restarts.

This starter is not production-ready. Every request acts as one local user, so
anyone who can reach the app can start and approve runs. Add authentication in
`app/api/workflows/[...path]/route.ts` before deploying.
