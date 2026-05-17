# Multi-Agent System

A team of specialized agents that collaborate on tasks.

## What's included

- Orchestrator that delegates to researcher and writer agents
- Agent-as-tool composition via `getAgentsAsTools()`
- Web search tool (placeholder, configure your own API)

## Structure

```
agents/
  orchestrator.ts      Coordinates the team
  researcher.ts        Gathers information
  writer.ts            Produces polished content
tools/web-search.ts    Placeholder search tool
app/
  api/ag-ui/route.ts    AG-UI endpoint
  page.tsx             Chat interface
```

This starter is not production-ready.
