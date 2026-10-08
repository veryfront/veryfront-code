# Completed tool ownership repair

Add a failing completed-output ownership regression through durable replay. Recover a missing provider marker without replacing completed output or explicit false ownership. Ensure the fallback ownership marker reaches durable replay while existing output deduplication and privacy contracts remain intact.

Use canonical targeted test tasks and frozen types, then return the isolated exact source candidate for independent review. Do not modify the active root gate, force-push, or publish this candidate.

## Durable correction contract

Use a reserved CUSTOM event named `veryfront.tool_result_ownership` with value `{schemaVersion:1, toolCallId, toolName, parentMessageId, providerExecuted:true}`. It carries no tool input, output, or private payload. Emit through the existing durable append seam only for a non-aborted completed output whose persisted ownership is missing and whose final-step ownership is true.

Both readers must bind exactly one correction to exactly one ordered start, end, and unmarked result under the same parent and tool name. Explicit ownership, multiple occurrences/results/corrections, incorrect ordering, mismatched bindings, or malformed metadata grant no ownership. Version 1 retains invalid metadata as compatibility custom; version 2 rejects it. Valid metadata is consumed and the original result projects once at its original position. Do not weaken normal version 2 sequence or duplicate checks. Reserve the name against external data event encoding.

Verify genuine finalization to durable replay for both versions, original output bytes/encoding/error and ordering, explicit false and abort preservation, malformed/duplicate/reused/mismatched correction rejection, and forgery resistance. Update contract documentation alongside source. Independent review remains required before qualification or publication.
