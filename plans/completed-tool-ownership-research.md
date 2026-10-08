# Completed tool ownership research

A completed persisted tool output can lack provider ownership even when the final step supplies authoritative providerExecuted=true. Current finalization returns completed parts unchanged. Mirrored chunk state then suppresses the final marker, so durable version 1 replay can classify the result as a local tool.

Preserve explicit ownership, completed output bytes, ordering, and existing result verdicts. Recover ownership only for matching tool call IDs with missing ownership and authoritative final-step provider evidence. Regression coverage must traverse finalization, fallback chunks, the durable encoder, and version 1 replay. The external denied-result regression is retained by merging its commit into the isolated source candidate.

The architecture review rejects duplicate marked results: version 1 requires one unambiguous result, and version 2 rejects a second completed result. A reserved metadata-only CUSTOM correction preserves append-only storage and original result ordering. Bind parentMessageId because both writer versions retain it; version 2 does not retain the derived result messageId. Finalization has the captured parent identity. Existing durable appendEvents and CUSTOM contracts provide the seam without a new event type.
