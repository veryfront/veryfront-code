# Tool result replay envelope

Observed Calendar follow-up context nests a provider JSON output envelope inside another envelope. The exact cursor remains present; this formatting gap does not establish why the model invented a placeholder.

`message-adapter.ts:convertStructuredPart` owns conversion from typed `ProviderModelMessage` to raw agent messages. It currently copies the owned `ChatToolResultOutput` into raw `result`; runtime conversion then adds its own output envelope. The existing hosted child-fork adapter consumes exactly one owned envelope before this boundary.

Use that existing behavior at the provider-to-agent boundary. Do not recursively unwrap user data, parse arbitrary strings, or alter provider request builders. Preserve user objects whose own keys happen to be type/value. Prove the adapter round trip through actual Anthropic and Google builders using a synthetic opaque cursor.

The sibling sweep found Anthropic checkpoint validation recognizes the old prepared `error-text` envelope. After shared conversion, the equivalent `{error: string}` form needs normalization at that provider replay boundary. Admit only the canonical AnthropicServerToolResultError record; invalid JSON, arbitrary records and mismatched call IDs remain rejected. Do not parse strings in the shared adapter.
