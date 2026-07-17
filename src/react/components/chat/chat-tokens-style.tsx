/**
 * ChatTokens — the `[data-vf-ui]`-scoped design-token stylesheet (also matching
 * the `[data-vf-chat]` compat alias).
 *
 * The token layer now lives in the base `veryfront/ui` package
 * (`DesignTokenStyle`); this is a back-compat re-export so existing chat
 * callers (`ChatStyleProvider`, `ChatRoot`, `ChatThemeScope`) keep importing
 * `ChatTokens` from here.
 *
 * @module react/components/chat/chat-tokens-style
 */
export { DesignTokenStyle as ChatTokens } from "../ui/tokens.tsx";
