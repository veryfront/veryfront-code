import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getComponentId,
  isClientComponent,
  registerClientRef,
  type RSCComponent,
} from "./component-detector.ts";

function makeComponent(overrides: Partial<RSCComponent> = {}): RSCComponent {
  const fn = () => null;
  return Object.assign(fn, overrides) as unknown as RSCComponent;
}

describe("rendering/rsc/server-renderer/component-detector", () => {
  describe("isClientComponent", () => {
    it("should return false for null/undefined component", () => {
      assertEquals(isClientComponent(null as unknown as RSCComponent, new Map()), false);
    });

    it("should return true for __rsc_client flag", () => {
      const comp = makeComponent({ __rsc_client: true });
      assertEquals(isClientComponent(comp, new Map()), true);
    });

    it("should return true for react.client.reference symbol", () => {
      const comp = makeComponent({ $$typeof: Symbol.for("react.client.reference") });
      assertEquals(isClientComponent(comp, new Map()), true);
    });

    it("should return true if component id is in client manifest", () => {
      const comp = makeComponent({ __rsc_id: "MyButton" });
      const manifest = new Map([["MyButton", { id: "MyButton", path: "/btn.js", exports: [] }]]);
      assertEquals(isClientComponent(comp, manifest), true);
    });

    it("should return false for server component not in manifest", () => {
      const comp = makeComponent({ __rsc_id: "ServerOnly" });
      assertEquals(isClientComponent(comp, new Map()), false);
    });
  });

  describe("getComponentId", () => {
    it("should prefer __rsc_id", () => {
      const comp = makeComponent({ __rsc_id: "CustomId", displayName: "Display" });
      assertEquals(getComponentId(comp), "CustomId");
    });

    it("should fallback to displayName", () => {
      const comp = makeComponent({ displayName: "MyDisplay" });
      assertEquals(getComponentId(comp), "MyDisplay");
    });

    it("should fallback to function name", () => {
      function MyNamedComponent() {
        return null;
      }
      assertEquals(getComponentId(MyNamedComponent as unknown as RSCComponent), "MyNamedComponent");
    });

    it("should return Unknown for anonymous component", () => {
      const comp = Object.assign(Object.create(null), {}) as unknown as RSCComponent;
      assertEquals(getComponentId(comp), "Unknown");
    });
  });

  describe("registerClientRef", () => {
    it("should register a client ref with manifest path", () => {
      const manifest = new Map([["Btn", { id: "Btn", path: "/btn.js", exports: [] }]]);
      const refs = new Map<string, string>();
      const comp = makeComponent();
      registerClientRef("Btn", comp, manifest, refs);
      assertEquals(refs.get("Btn"), "/btn.js");
    });

    it("should use __rsc_path fallback when not in manifest", () => {
      const comp = makeComponent({ __rsc_path: "/custom/path.js" });
      const refs = new Map<string, string>();
      registerClientRef("X", comp, new Map(), refs);
      assertEquals(refs.get("X"), "/custom/path.js");
    });

    it("should use default path when no meta or __rsc_path", () => {
      const comp = makeComponent();
      const refs = new Map<string, string>();
      registerClientRef("Foo", comp, new Map(), refs);
      assertEquals(refs.get("Foo"), "/_veryfront/client/Foo.js");
    });

    it("should not overwrite existing ref", () => {
      const comp = makeComponent();
      const refs = new Map<string, string>([["Foo", "/existing.js"]]);
      registerClientRef("Foo", comp, new Map(), refs);
      assertEquals(refs.get("Foo"), "/existing.js");
    });
  });
});
