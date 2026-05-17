# Hosted agent runs

This page describes hosted agent run state, child runs, durable conversation
mirrors, and hosted runtime preparation. It does not cover local agent runtime
message normalization.

## Responsibility

Hosted agent run code adapts agent runtime execution to Veryfront-hosted
conversation flows, project steering, child-run tools, durable mirrors, terminal
state, and cloud runtime services.

Primary source areas:

- `src/agent/hosted/`
- `src/agent/conversation/`
- `src/agent/child-run/`
- `src/agent/project/`
- `src/agent/artifacts/`

## Runtime flow

1. Hosted request parsing validates incoming chat, AG-UI, or runtime invocation
   input.
2. Runtime preparation resolves project steering, remote tool sources, MCP
   server configs, and cloud runtime instructions.
3. Hosted stream execution mirrors chunks into durable conversation state.
4. Child-run helpers create fork tools, invoke child agents, summarize results,
   and persist execution snapshots.
5. Lifecycle helpers finalize messages, terminal state, and trace attributes.

## Boundaries

- Hosted state is separate from provider-neutral agent runtime streaming.
- Child-run tools are a hosted runtime feature, not a workflow DAG primitive.
- Control-plane transport routing belongs in [control-plane channels](./09-control-plane-channels.md).

## Change checks

- Add tests for durable mirror behavior when changing run event normalization.
- Keep child-run result snapshots stable when changing child fork execution.
- Redact project and user data in hosted logs and thrown errors.
