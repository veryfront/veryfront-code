/**
 * Design tokens for the `veryfront/ui` primitives.
 *
 * CSS custom properties aligned with the Veryfront Studio design system. When
 * embedded in a host that defines `--background`, `--foreground`, etc., the
 * primitives inherit those tokens; standalone, sensible defaults are injected
 * via `<style>` (see `./tokens.tsx`) on the scope element.
 *
 * This is the base layer both `veryfront/ui` and `veryfront/chat` render
 * against — `chat` re-exports `generateTokenCSS` from here (via its `theme.ts`)
 * so there is a single source of truth for the token vocabulary.
 *
 * NOTE (scope contract): the canonical scope selector is `[data-vf-ui]` — a
 * neutral name for the shared `veryfront/ui` token layer. The historical
 * `[data-vf-chat]` (inherited from when these primitives lived in `chat/ui`) is
 * retained as a **compatibility alias**: every rule below matches BOTH scopes,
 * and every surface that establishes a scope sets both attributes, so existing
 * consumers that target `[data-vf-chat]` in their own CSS / DOM queries keep
 * working. New code should target `[data-vf-ui]`; `[data-vf-chat]` stays
 * supported until a future major removes it.
 *
 * @module react/components/ui/design-tokens
 */

/**
 * The token scope attributes, canonical first. `[data-vf-ui]` is the neutral
 * name new code should use; `[data-vf-chat]` is the retained compat alias.
 */
export const UI_SCOPE_ATTRIBUTE = "data-vf-ui";
export const UI_SCOPE_ALIAS_ATTRIBUTE = "data-vf-chat";
const SCOPE_SELECTORS = [`[${UI_SCOPE_ATTRIBUTE}]`, `[${UI_SCOPE_ALIAS_ATTRIBUTE}]`] as const;
/** Selector matching either token scope — e.g. for portal `closest()` lookups. */
export const UI_SCOPE_SELECTOR = SCOPE_SELECTORS.join(",");
/**
 * Attributes to spread onto a token-scope root element — the canonical
 * `data-vf-ui` plus the `data-vf-chat` compat alias — so every scope establisher
 * shares one source of truth: `<div {...UI_SCOPE_ATTRS} />`.
 */
export const UI_SCOPE_ATTRS = {
  [UI_SCOPE_ATTRIBUTE]: "",
  [UI_SCOPE_ALIAS_ATTRIBUTE]: "",
};

/**
 * Light-mode defaults copied from Veryfront Studio `styles/styles.css`.
 * Keep these values aligned with Studio so standalone surfaces render with the
 * same surface, edge, and text hierarchy before a host app provides tokens.
 */
const TOKENS_LIGHT = {
  "--background": "#F0EFE9",
  "--foreground": "#010101",
  "--primary": "#282828",
  "--secondary": "#FFFFFF",
  "--tertiary": "#F0EFE9",
  "--accent": "#E8E6DB",
  "--muted": "#F7F6F4",
  "--destructive": "#D40C1A",
  "--outline-border": "#DCDAD0",
  "--status-neutral": "#9F9F9F",
  "--status-info": "#0071DF",
  "--status-success": "#098926",
  "--status-warning": "#F99100",
  "--status-error": "#D40924",
  "--alert-warning-bg": "#F1E3CD",
  "--alert-error-bg": "#ECD3D1",
  "--alert-success-bg": "#D4E2D2",
  "--alert-info-bg": "#E6E6E0",
  "--faint": "oklch(from var(--foreground) l c h / 0.25)",
  "--soft": "oklch(from var(--foreground) l c h / 0.7)",
  "--tint": "oklch(from var(--foreground) l c h / 0.04)",
  "--edge": "oklch(from var(--foreground) l c h / 0.06)",
  "--edge-medium": "oklch(from var(--foreground) l c h / 0.1)",
  "--separator": "#EEEEED",
  "--shadow-sm": "0 1.5px 3px rgba(0, 0, 0, 0.08)",
  "--code-bg": "var(--secondary)",
  "--input-bg": "var(--secondary)",
  "--popover": "var(--secondary)",
  "--dialog": "var(--background)",
  "--drawer": "var(--background)",
  "--overlay": "rgba(0, 0, 0, 0.5)",
  "--card": "var(--secondary)",
  "--card-foreground": "var(--foreground)",
  "--popover-foreground": "var(--foreground)",
  "--primary-foreground": "var(--secondary)",
  "--muted-foreground": "var(--faint)",
  "--accent-foreground": "var(--foreground)",
  "--destructive-foreground": "#FFFFFF",
  "--border": "var(--outline-border)",
  "--input": "var(--input-bg)",
  "--input-border": "var(--edge-medium)",
  "--input-placeholder": "var(--faint)",
  "--ring": "var(--edge-medium)",
  "--success": "var(--status-success)",
  "--chat-bubble": "var(--primary)",
  "--chat-bubble-foreground": "var(--secondary)",
  "--tab-background": "var(--secondary)",
  "--tab-foreground": "var(--faint)",
  "--tab-active-background": "var(--accent)",
  "--tab-active-foreground": "var(--foreground)",
  "--sidebar-background": "var(--background)",
  "--sidebar-foreground": "var(--foreground)",
  "--sidebar-border": "var(--edge-medium)",
  "--radius-xs": "4px",
  "--radius-sm": "8px",
  "--radius-md": "12px",
  "--radius-lg": "20px",
  "--radius-xl": "35px",
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
} as const;

/**
 * Dark-mode defaults copied from Studio `[data-theme="dark"]`.
 */
const TOKENS_DARK = {
  ...TOKENS_LIGHT,
  "--background": "#282828",
  "--foreground": "#F0EFE9",
  "--primary": "#F1F0EA",
  "--secondary": "#333333",
  "--tertiary": "#262626",
  "--accent": "#303030",
  "--muted": "#0D1315",
  "--outline-border": "#3A3A3A",
  "--separator": "oklch(from var(--foreground) l c h / 0.06)",
  "--code-bg": "oklch(0.08 0.005 280)",
  "--input-bg": "#40403F",
  "--primary-foreground": "var(--secondary)",
  "--chat-bubble": "var(--primary)",
  "--chat-bubble-foreground": "var(--secondary)",
} as const;

function tokensToCSS(tokens: Record<string, string>): string {
  return Object.entries(tokens).map(([k, v]) => `${k}:${v}`).join(";");
}

/**
 * Animation CSS for the UI primitives (Spinner, Shimmer, ProgressBar,
 * LoadingButton). Copied from Studio `styles/animations.css`. Since the package
 * ships self-contained, it carries both the `@keyframes` AND the named
 * `animate-*` utility classes itself — components use Studio's clean class names
 * (`animate-bounce-spin`) without requiring the consumer's Tailwind to register
 * them. `shimmer-sweep` stays an arbitrary `animate-[…]` utility (its duration
 * is set inline), so only its keyframes are needed here. Keep in sync with
 * `storybook/.storybook/preview.css`.
 */
const ANIMATION_CSS =
  "@keyframes bounce-spin{0%,100%{transform:translateY(0) rotate(0deg);animation-timing-function:ease-in-out}25%{transform:translateY(-30%) rotate(90deg);animation-timing-function:ease-in}50%{transform:translateY(0) rotate(180deg);animation-timing-function:ease-out}75%{transform:translateY(-15%) rotate(270deg);animation-timing-function:ease-in}}" +
  "@keyframes button-loading{0%,100%{opacity:1}50%{opacity:.55}}" +
  "@keyframes shimmer-sweep{0%{background-position:100% center}100%{background-position:0% center}}" +
  "@keyframes progress-indeterminate{0%{transform:translateX(-120%)}100%{transform:translateX(320%)}}" +
  ".animate-bounce-spin{animation:bounce-spin 2.5s cubic-bezier(0.25,1,0.5,1) infinite}" +
  ".animate-button-loading{animation:button-loading 1.4s cubic-bezier(0.4,0,0.2,1) infinite}" +
  ".animate-progress-indeterminate{animation:progress-indeterminate 1.2s ease-in-out infinite}";

/** Join a selector template across every scope (canonical + alias). */
function forEachScope(template: (scope: string) => string): string {
  return SCOPE_SELECTORS.map(template).join(",");
}

/** The four dark-mode selectors for one scope (`.dark`/`[data-theme]`, desc + self). */
function darkScopeSelectors(scope: string): string {
  return [
    `.dark ${scope}:not([data-vf-theme])`,
    `[data-theme="dark"] ${scope}:not([data-vf-theme])`,
    `.dark${scope}:not([data-vf-theme])`,
    `[data-theme="dark"]${scope}:not([data-vf-theme])`,
  ].join(",");
}

/**
 * Generates the scoped CSS for the design tokens. Every rule matches BOTH the
 * canonical `[data-vf-ui]` scope and the `[data-vf-chat]` compat alias, so
 * tokens don't leak to the page and existing consumers keep working.
 *
 * If a host application (e.g. Studio) already defines these CSS custom
 * properties on `:root`, the host values cascade through and our fallbacks are
 * never reached — because we set them on the scope element, which has lower
 * specificity for inherited vars. We intentionally only set them on the scope
 * root so parent-defined tokens take precedence.
 *
 * Dark mode: supports `prefers-color-scheme`, `.dark`, and `[data-theme="dark"]`.
 */
export function generateTokenCSS(): string {
  const light = tokensToCSS(TOKENS_LIGHT);
  const dark = tokensToCSS(TOKENS_DARK);

  // The design tokens stay scoped to `[data-vf-ui]` / `[data-vf-chat]`, never
  // `:root`: the names (`--primary`, `--background`, `--accent`, …) are the same
  // generic convention host apps use for their own themes, and these style tags
  // render in the body — after a host's <head> stylesheets — so a `:root` rule
  // here would override the host's tokens page-wide (and the dark media query
  // would repaint light-only host pages for OS-dark users). Surfaces that render
  // their own scope establish both attributes and inject the token `<style>`;
  // portalled content re-anchors via `closest(UI_SCOPE_SELECTOR)`.
  return [
    `${
      forEachScope((s) => s)
    }{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-weight:var(--font-weight-normal);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;${light}}`,
    `${forEachScope((s) => `${s} button`)}{cursor:pointer;}`,
    `@media(prefers-color-scheme:dark){${
      forEachScope((s) => `${s}:not([data-vf-theme])`)
    }{${dark}}}`,
    `${forEachScope(darkScopeSelectors)}{${dark}}`,
    ANIMATION_CSS,
  ].join("");
}
