# Veryfront project guide

Follow `AGENTS.md` when it exists. If it does not exist, use this guide.

This is a Veryfront project. Veryfront is a framework for building and running AI apps and agents in TypeScript and React.

## Project conventions

Use these folders as runtime boundaries. Create folders only when the feature needs them.

- `app/`: pages, layouts, route handlers, and user-facing API routes.
- `agents/`: model reasoning and tool use.
- `tools/`: deterministic callable capabilities.
- `workflows/`: multi-step coordination.
- `tasks/`: background work targets.
- `prompts/`: reusable prompt templates.
- `resources/`: project data exposed to MCP clients.
- `skills/`: reusable agent instructions in `skills/<id>/SKILL.md`.
- `integrations/`: service connectors and integration-local code.

## Developer loop

1. Start local development with `veryfront dev`.
2. Generate new files with `veryfront generate <type> <name>`.
3. Inspect current CLI commands with `veryfront schema --json`.
4. Use https://veryfront.com/docs when local files and CLI schema do not answer a Veryfront API or convention question.
5. Run focused tests and lint before shipping.

## Coding agent loop

When the Veryfront MCP server is connected, call `vf_bootstrap` once at session start. Use `vf_get_conventions` before adding files, `vf_scaffold` for new routes and AI primitives, `vf_get_errors` after edits, and `vf_run_tests` or `vf_run_lint` for verification.

`veryfront dev` starts the HTTP MCP endpoint on the app port plus 2. With the default app port, use `http://localhost:3002/mcp`.

If MCP is not connected, use `veryfront schema --json` and the documented CLI commands from the shell.

Prefer Veryfront scaffold tools over hand-written boilerplate. Keep app routes, agents, tools, workflows, tasks, resources, prompts, and skills in their expected folders.

## Inference

Agent routes need model access. Use `veryfront login` for the Veryfront Cloud gateway, set `VERYFRONT_API_TOKEN`, or set provider keys such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
