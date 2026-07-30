import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { notFound, redirect } from "#veryfront/data/helpers.ts";
import { findSSRControlOutcome, isSSRControlOutcome } from "./ssr-outcome.ts";

describe("ssr-outcome.ts", () => {
  describe("findSSRControlOutcome", () => {
    it("finds a branded redirect through cause and AggregateError nodes", () => {
      const wrapped = new AggregateError([
        new Error("other"),
        new Error("wrapped", { cause: redirect("/login", true) }),
      ]);

      assertEquals(findSSRControlOutcome(wrapped), {
        kind: "redirect",
        location: "/login",
        permanent: true,
      });
    });

    it("rejects an unbranded redirect-shaped value", () => {
      assertEquals(
        findSSRControlOutcome({
          redirect: { destination: "/login", permanent: false },
        }),
        null,
      );
    });

    it("terminates on cyclic error graphs", () => {
      const cyclic: { cause?: unknown } = {};
      cyclic.cause = cyclic;

      assertEquals(findSSRControlOutcome(cyclic), null);
    });

    it("normalizes a branded notFound result", () => {
      assertEquals(findSSRControlOutcome(notFound()), { kind: "not-found" });
    });
  });

  describe("isSSRControlOutcome", () => {
    it("returns true only when the graph contains a branded control result", () => {
      assertEquals(isSSRControlOutcome(new Error("wrapped", { cause: notFound() })), true);
      assertEquals(isSSRControlOutcome({ notFound: true }), false);
    });
  });
});
