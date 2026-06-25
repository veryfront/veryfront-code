# Veryfront project guide

Follow `AGENTS.md` when it exists. If it does not exist, use this guide.

This is a Veryfront project. Veryfront is a framework for building and running AI apps and agents in TypeScript and React.

## Project conventions

Use these folders as runtime boundaries. Create folders only when the feature needs them.

- `app/`: pages, layouts, route handlers, and user-facing API routes.
- `agents/`: model reasoning and tool use.
- `tools/`: deterministic callable capabilities.
- `workflows/`: multi-step coordination.
- `skills/`: reusable agent instructions in `skills/<id>/SKILL.md`.
- `veryfront.config.ts`: project metadata and router configuration.

## Developer loop

1. Start local development with `veryfront dev`.
2. Generate new files with `veryfront generate <type> <name>`.
3. Inspect current CLI commands with `veryfront schema --json`.
4. Verify discovered routes with `veryfront routes`.
5. Run focused tests and builds before shipping.
6. Use https://veryfront.com/docs when local files and CLI schema do not answer a Veryfront API or convention question.

## Coding agent loop

Prefer Veryfront scaffold tools over hand-written boilerplate. Keep app routes, agents, tools, workflows, and skills in their expected folders.

## Inference

Agent routes need model access. Use `veryfront login` for the Veryfront Cloud gateway, set `VERYFRONT_API_TOKEN`, or set provider keys such as `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`.
