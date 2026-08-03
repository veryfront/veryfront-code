/**
 * Color Mode System
 *
 * Provides dark/light mode toggling with SSR flash prevention.
 *
 * @module react/components/color-mode
 */

import * as React from "react";
import { createStrictContext } from "../create-strict-context.ts";
import { jsonForInlineScript } from "#veryfront/security/client/html-sanitizer.ts";
import { useDocumentNonce } from "./csp-nonce.ts";

type ColorMode = "light" | "dark" | "system";
type ResolvedColorMode = "light" | "dark";

interface ColorModeContextValue {
  mode: ColorMode;
  resolvedMode: ResolvedColorMode;
  setMode: (mode: ColorMode) => void;
  toggleMode: () => void;
}

const [ColorModeContext, useColorMode] = createStrictContext<ColorModeContextValue>(
  "useColorMode",
  "a ColorModeProvider",
);
export { useColorMode };

function isColorMode(value: string | null): value is ColorMode {
  return value === "light" || value === "dark" || value === "system";
}

function resolveMode(
  mode: ColorMode,
  systemPreference: ResolvedColorMode,
): ResolvedColorMode {
  return mode === "system" ? systemPreference : mode;
}

function readPersistedMode(storageKey: string, fallback: ColorMode): ColorMode {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const stored = localStorage.getItem(storageKey);
    return isColorMode(stored) ? stored : fallback;
  } catch (_) {
    /* expected: localStorage may be unavailable */
    return fallback;
  }
}

const STORAGE_KEY = "vf-color-mode";

export interface ColorModeProviderProps {
  children: React.ReactNode;
  defaultMode?: ColorMode;
  storageKey?: string;
  attribute?: "class" | "data-theme";
}

export function ColorModeProvider({
  children,
  defaultMode = "system",
  storageKey = STORAGE_KEY,
  attribute = "class",
}: ColorModeProviderProps): React.ReactElement {
  // Browser-only preferences must not participate in the first client render:
  // hydration has to reproduce the server snapshot before reconciling storage
  // and the OS preference after mount.
  const initialMode = React.useRef(defaultMode);
  const [mode, setModeState] = React.useState<ColorMode>(initialMode.current);
  const [systemPreference, setSystemPreference] = React.useState<ResolvedColorMode>("light");
  const [hasReconciledClientState, setHasReconciledClientState] = React.useState(false);

  const resolvedMode = resolveMode(mode, systemPreference);

  React.useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const media = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemPreference(media.matches ? "dark" : "light");
    update();

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }

    media.addListener(update);
    return () => media.removeListener(update);
  }, []);

  React.useEffect(() => {
    setModeState(readPersistedMode(storageKey, initialMode.current));
    setHasReconciledClientState(true);
  }, [storageKey]);

  const setMode = React.useCallback((newMode: ColorMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(storageKey, newMode);
    } catch (_) {
      /* expected: localStorage may be unavailable */
    }
  }, [storageKey]);

  const toggleMode = React.useCallback(() => {
    setMode(resolvedMode === "dark" ? "light" : "dark");
  }, [resolvedMode, setMode]);

  // Apply attribute to <html>
  React.useEffect(() => {
    // ColorModeScript may already have applied the persisted theme. Avoid
    // replacing it with the hydration seed before persistence is reconciled.
    if (!hasReconciledClientState) return;
    const root = document.documentElement;
    if (attribute === "class") {
      root.classList.toggle("dark", resolvedMode === "dark");
      root.classList.toggle("light", resolvedMode === "light");
    } else {
      root.setAttribute("data-theme", resolvedMode);
    }
    root.style.colorScheme = resolvedMode;
  }, [hasReconciledClientState, resolvedMode, attribute]);

  const value = React.useMemo(
    () => ({ mode, resolvedMode, setMode, toggleMode }),
    [mode, resolvedMode, setMode, toggleMode],
  );

  return (
    <ColorModeContext.Provider value={value}>
      {children}
    </ColorModeContext.Provider>
  );
}
ColorModeProvider.displayName = "ColorModeProvider";

/**
 * Non-throwing variant — returns `null` when there is no `ColorModeProvider`.
 * Use for components that should render standalone (e.g. a `CodeBlock` dropped
 * into markdown) and fall back to light mode.
 */
export function useColorModeOptional(): ColorModeContextValue | null {
  return React.useContext(ColorModeContext);
}

/**
 * Inline script to prevent flash of wrong color mode on SSR.
 * Render this in <head> before any content.
 *
 * Usage: <ColorModeScript defaultMode="system" />
 */
export function ColorModeScript({
  defaultMode = "system",
  storageKey = STORAGE_KEY,
  attribute = "class",
}: {
  defaultMode?: ColorMode;
  storageKey?: string;
  attribute?: "class" | "data-theme";
}): React.ReactElement {
  const nonce = useDocumentNonce();
  const applyAttribute = attribute === "class"
    ? 'd.classList.add(r);d.classList.remove(r==="dark"?"light":"dark")'
    : 'd.setAttribute("data-theme",r)';
  const script = `(function(){try{var m=localStorage.getItem(${
    jsonForInlineScript(storageKey)
  });if(m!=="light"&&m!=="dark"&&m!=="system")m=${
    jsonForInlineScript(defaultMode)
  };var r=m==="system"?globalThis.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light":m;var d=document.documentElement;${applyAttribute};d.style.colorScheme=r}catch(e){}})()`;
  return <script nonce={nonce} dangerouslySetInnerHTML={{ __html: script }} />;
}
ColorModeScript.displayName = "ColorModeScript";

/**
 * Simple toggle button for color mode.
 */
export const ColorModeToggle = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(function ColorModeToggle({ className, ...props }, ref) {
  const { resolvedMode, toggleMode } = useColorMode();
  const isDark = resolvedMode === "dark";

  return (
    <button
      ref={ref}
      type="button"
      onClick={toggleMode}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={className}
      {...props}
    >
      {isDark
        ? (
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )
        : (
          <svg
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
    </button>
  );
});
ColorModeToggle.displayName = "ColorModeToggle";
