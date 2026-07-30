import type { RenderOptions } from "./types.ts";
import {
  type CSSGenerationSession,
  isCSSGenerationSession,
} from "#veryfront/html/styles-builder/css-compiler.ts";

/** Internal request-scoped channel for one atomic CSS compiler/optimizer pair. */
export const CSS_GENERATION_SESSION = Symbol(
  "veryfront.cssGenerationSession",
);

export type RenderOptionsWithCSSGenerationSession = RenderOptions & {
  readonly [CSS_GENERATION_SESSION]?: CSSGenerationSession;
};

/** Read and authenticate an internally attached CSS generation session. */
export function getRenderCSSGenerationSession(
  options: RenderOptions | undefined,
): CSSGenerationSession | undefined {
  const value = (options as RenderOptionsWithCSSGenerationSession | undefined)?.[
    CSS_GENERATION_SESSION
  ];
  if (value !== undefined && !isCSSGenerationSession(value)) {
    throw new TypeError("Render CSS generation session was not acquired by core");
  }
  return value;
}
