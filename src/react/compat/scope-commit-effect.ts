/**
 * Select the earliest commit-phase effect available to a React runtime.
 *
 * React 18+ exposes `useInsertionEffect`, which runs before descendant layout
 * effects and before concurrent work can publish commands. React 17 has no
 * insertion phase and commits synchronously; callers therefore publish their
 * ownership ref during render as well as in the layout effect selected here.
 *
 * @module react/compat/scope-commit-effect
 */
import * as React from "react";

type EffectHook = typeof React.useEffect;

interface CommitEffectSource {
  useEffect: EffectHook;
  useLayoutEffect: EffectHook;
  useInsertionEffect?: EffectHook;
}

export interface ScopeCommitStrategy {
  readonly effect: EffectHook;
  readonly publishDuringRender: boolean;
}

/** @internal Select commit ownership behavior for one React runtime. */
export function selectScopeCommitStrategy(
  source: CommitEffectSource,
  isBrowser: boolean,
): ScopeCommitStrategy {
  if (typeof source.useInsertionEffect === "function") {
    return {
      effect: source.useInsertionEffect,
      publishDuringRender: false,
    };
  }
  return {
    effect: isBrowser ? source.useLayoutEffect : source.useEffect,
    publishDuringRender: true,
  };
}

const strategy = selectScopeCommitStrategy(
  React as CommitEffectSource,
  typeof document !== "undefined",
);

/** Earliest supported effect for publishing committed lifecycle ownership. */
export const useScopeCommitEffect = strategy.effect;

/** Whether this synchronous React runtime needs render-phase publication. */
export const scopeCommitRequiresRenderPublication = strategy.publishDuringRender;
