/**
 * Color Mode System
 *
 * Provides dark/light mode toggling with SSR flash prevention.
 *
 * @module ai/react/components/color-mode
 */

import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors";

type ColorMode = "light" | "dark" | "system";
type ResolvedColorMode = "light" | "dark";

interface ColorModeContextValue {
  mode: ColorMode;
  resolvedMode: ResolvedColorMode;
  setMode: (mode: ColorMode) => void;
  toggleMode: () => void;
}

const ColorModeContext = React.createContext<ColorModeContextValue | null>(null);

function getSystemPreference(): ResolvedColorMode {
  if (typeof window === "undefined") return "light";
  return globalThis.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveMode(mode: ColorMode): ResolvedColorMode {
  return mode === "system" ? getSystemPreference() : mode;
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
  const [mode, setModeState] = React.useState<ColorMode>(() => {
    if (typeof window === "undefined") return defaultMode;
    try {
      return (localStorage.getItem(storageKey) as ColorMode) || defaultMode;
    } catch (_) {
      /* expected: localStorage may be unavailable */
      return defaultMode;
    }
  });

  const resolvedMode = resolveMode(mode);

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
    const root = document.documentElement;
    if (attribute === "class") {
      root.classList.toggle("dark", resolvedMode === "dark");
      root.classList.toggle("light", resolvedMode === "light");
    } else {
      root.setAttribute("data-theme", resolvedMode);
    }
  }, [resolvedMode, attribute]);

  // Listen for system preference changes when mode is "system"
  React.useEffect(() => {
    if (mode !== "system") return;
    const mq = globalThis.matchMedia("(prefers-color-scheme: dark)");
    const forceUpdate = () => setModeState("system");
    mq.addEventListener("change", forceUpdate);
    return () => mq.removeEventListener("change", forceUpdate);
  }, [mode]);

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

export function useColorMode(): ColorModeContextValue {
  const context = React.useContext(ColorModeContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "useColorMode must be used within a ColorModeProvider",
    });
  }
  return context;
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
  const script =
    `(function(){try{var m=localStorage.getItem("${storageKey}")||"${defaultMode}";var r=m==="system"?globalThis.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light":m;var d=document.documentElement;${
      attribute === "class"
        ? 'd.classList.add(r);d.classList.remove(r==="dark"?"light":"dark")'
        : 'd.setAttribute("data-theme",r)'
    }}catch(e){}})()`;
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
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
