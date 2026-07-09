import { assertEquals } from "#std/assert";
import {
  type AntipatternCounts,
  countAntipatterns,
  FEATURE_TOGGLE_BASELINE,
  FORWARDREF_BASELINE,
  PASSTHROUGH_BASELINE,
} from "./ban-chat-antipatterns.ts";

Deno.test("countAntipatterns detects forwardRef call sites", () => {
  const src = `
    const A = forwardRef<HTMLDivElement, Props>((props, ref) => null);
    const B = React.forwardRef(function B() { return null; });
  `;
  assertEquals(countAntipatterns(src).forwardRef, 2);
});

Deno.test("countAntipatterns detects show*/enable*/hide* boolean toggles", () => {
  const src = `
    interface Props {
      showSources?: boolean;
      enableVoice: boolean;
      hideTabSwitcher?: boolean;
      title?: string; // not a toggle
      onShow?: () => void; // not a toggle
    }
  `;
  assertEquals(countAntipatterns(src).featureToggle, 3);
});

Deno.test("countAntipatterns detects passthrough bags", () => {
  const src = `
    interface Props {
      contentClassName?: string;
      cardClassName?: string;
      icons?: { close: React.ReactNode };
      dragProps?: Record<string, unknown>;
      className?: string; // the ONE allowed root className — not a passthrough bag
    }
  `;
  assertEquals(countAntipatterns(src).passthrough, 4);
});

Deno.test("countAntipatterns ignores comments and string literals", () => {
  const src = `
    // showSources?: boolean and forwardRef( in a comment must not count
    const label = "enableVoice: boolean";
    const doc = \`icons?: bag\`;
  `;
  const c: AntipatternCounts = countAntipatterns(src);
  assertEquals(c, {
    forwardRef: 0,
    featureToggle: 0,
    passthrough: 0,
    inlineContext: 0,
  });
});

Deno.test("countAntipatterns detects inline context Provider values", () => {
  const src = `
    return (
      <FooContext.Provider value={{ a, b }}>
        <BarContext.Provider value={memoized}>{children}</BarContext.Provider>
      </FooContext.Provider>
    );
  `;
  assertEquals(countAntipatterns(src).inlineContext, 1);
});

Deno.test("baselines are non-negative ratchet targets", () => {
  for (
    const b of [
      FORWARDREF_BASELINE,
      FEATURE_TOGGLE_BASELINE,
      PASSTHROUGH_BASELINE,
    ]
  ) {
    assertEquals(b >= 0, true);
  }
});
