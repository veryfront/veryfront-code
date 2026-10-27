# Preserve Mistral root tool schema unions

## Findings

The runtime converter passes the effective schema model and authenticated wire surface to
`getProviderToolProfile`. All cloud models using the OpenAI wire currently receive native OpenAI root
restrictions. `sanitizeOpenAISchemaRoot` folds exclusive `oneOf` variants into optional properties.
Runtime validation still rejects invalid combinations, but the model no longer receives the contract.

A controlled ingestion evaluation on `veryfront-cloud/mistral/mistral-small-2503`, with the resolved
OpenAI wire, failed when the exclusive disposition/processed schema was folded. Restoring only the
authored outgoing schema produced HTTP 200 and passed the same evaluation (4.253 seconds, 3,876 tokens).
Current main produced the same weakened schema as the installed release. The regression fixture uses
the captured structural schema without customer content.

## Direction and tradeoffs

Wire protocol does not imply backend schema restrictions. Keep the existing OpenAI provider profile
and 128-tool limit, with an explicit root composition capability for the authenticated cloud Mistral
backend. Return its authored schema unchanged. Keep native OpenAI and every other backend's current
restrictions. This avoids changing application schemas, prompts, dependencies, or tool execution.

The live evidence covers Mistral Small 2503. The capability belongs to its cloud backend, not a model
version pin. Future cloud backends require their own qualification before receiving this capability.

## References

- `src/agent/runtime/provider-tool-compat.ts`
- `src/agent/runtime/model-tool-converter.ts`
- Controlled schema restoration and current-main comparison recorded during investigation.
