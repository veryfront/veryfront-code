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
workflows/content-pipeline.ts  Workflow definition
app/
  page.tsx                     Workflow dashboard
  workflows/[id]/page.tsx      Run detail and approval UI
```

This is a starter template to give you a good starting point — not a production-ready setup.
