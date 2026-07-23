/**
 * createStrictContext — factory for React context + strict-use hook pairs.
 *
 * Eliminates the repeated "read context, throw if missing" pattern across
 * `chat/` and `ui/` components. Every compound component that wraps a
 * `React.Context<T | null>` and exposes a throwing hook can use this factory
 * instead of hand-writing the same 9-line block.
 *
 * @module react/components/create-strict-context
 */
import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

/**
 * Create a `React.Context<T | null>` together with a hook that throws a
 * `COMPONENT_ERROR` when the context is absent.
 *
 * @param hookName   Subject phrase used in the error detail, e.g. `"useFoo"` or
 *                   `"Foo parts"`. Combined as: `"${hookName} must be used within ${parentHint}"`.
 * @param parentHint Completion of "…must be used within …", e.g. `"a <FooProvider>"`.
 * @returns Readonly tuple `[Context, useStrictHook]`.
 *   - `Context` — the raw `React.Context`. Expose its `.Provider` via a named
 *     alias (e.g. `export const FooProvider = FooContext.Provider`). Pass the
 *     context value through a memoised variable to satisfy the inline-context
 *     lint ratchet.
 *   - `useStrictHook` — throws `COMPONENT_ERROR` when called outside a provider.
 *     Export it under the canonical hook name (e.g. `export { useStrictHook as useFoo }`
 *     or rename directly in the destructuring).
 *
 * Optional read path: where a `null`-returning variant is needed, write a
 * three-line wrapper — `return React.useContext(FooContext)` — using the
 * returned `Context` directly. This keeps the factory focused on the one
 * repeated pattern without bloating its API.
 *
 * @example
 * ```ts
 * const [FooContext, useFoo] = createStrictContext<FooContextValue>(
 *   "useFoo",
 *   "a <FooProvider>",
 * );
 * export const FooContextProvider = FooContext.Provider;
 * export { useFoo };
 * ```
 */
export function createStrictContext<T>(
  hookName: string,
  parentHint: string,
): readonly [React.Context<T | null>, () => T] {
  const Context = React.createContext<T | null>(null);
  function useStrictContext(): T {
    const value = React.useContext(Context);
    if (!value) {
      throw COMPONENT_ERROR.create({
        detail: `${hookName} must be used within ${parentHint}`,
      });
    }
    return value;
  }
  return [Context, useStrictContext] as const;
}
