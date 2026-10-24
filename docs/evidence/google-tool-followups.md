# Google tool follow-up verification

## Prerequisites

Run a compatible local Studio and API, connect a disposable Calendar account,
and load the slim catalog Calendar agent without project helper tools. Run the
QA renderer with this message-preparation change and the shared Google tool API
change from veryfront-api PR7066.

## Critical flow

1. Start a fresh Calendar chat and ask for today's events in Europe/Berlin.
2. Ask to open the test event from the preceding answer.
3. Ask for tomorrow in the same timezone.
4. Inspect all run events, including provider results and model-call context.

## Pass criteria

Both date requests use local-day inputs. The detail call uses the real ID from
the preceding result. All calls succeed and each run has zero tool errors. The
model context retains the preceding bounded collection. Larger and older results
remain compacted. No prompt or tool-name workaround is required.

## Checks

```sh
deno task test:file src/chat/message-prep.test.ts src/chat/tool-replay-reconciliation.test.ts src/chat/conversation.test.ts
deno check src/chat/message-prep.ts src/chat/message-prep.test.ts
deno lint src/chat/message-prep.ts src/chat/message-prep.test.ts
```

Local live verification passed on 2026-10-24 using the original slim Calendar
agent and Mistral model, with this unreleased change applied to both local API
message preparation and the QA renderer. Conversation
`95442eb6-3ff4-5073-beff-b4f206ba84c8` completed three chats: today, event
details, and tomorrow in Europe/Berlin. All 114 run events were retrieved, with
zero error events or tool errors. The detail request used the real prior event
ID; both list requests used local-date inputs.

Demo: <http://localhost:3000/projects/google-qa-calendar-agent-20261024/chat/95442eb6-3ff4-5073-beff-b4f206ba84c8>.
This requires the dedicated local QA services and is not a production link.

The checkout pins Deno 2.9.7, but the
available local runtime is 2.9.4 and npm has no 2.9.7 package. The 73 focused tests
(58 steps), typecheck and lint pass on 2.9.4. No generated files were regenerated.
Pinned-version CI remains required before readiness.
