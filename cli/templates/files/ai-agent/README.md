# AI Agent

A small, customizable agent with a streaming chat UI and tool support.

## What's included

- Single assistant agent with streaming chat UI
- Example calculator tool
- Smoke eval for the agent and calculator
- App-mode `Chat` component for real-time responses

## Structure

```
agents/assistant.ts    Agent definition
tools/calculator.ts    Example tool
evals/assistant.eval.ts Agent smoke eval
app/
  api/ag-ui/route.ts    AG-UI endpoint
  page.tsx             Chat interface
```

## Customize

- Edit `agents/assistant.ts` to change the agent's identity, instructions, and suggestions.
- Add or replace files in `tools/` to give the agent new capabilities.
- Update `evals/assistant.eval.ts`, then run `npm run eval -- assistant`.
- Edit `app/page.tsx` when you need to customize the chat UI.
