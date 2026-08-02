import { assertEquals, assertThrows } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { dashboardMutationHeaders } from "./mutation-request.ts";
import {
  DASHBOARD_CSRF_HEADER_NAME,
  DASHBOARD_CSRF_META_NAME,
} from "veryfront/extensions/dev-ui/protocol";

function metaRoot(token: string | null) {
  return {
    querySelector(selector: string) {
      assertEquals(selector, `meta[name="${DASHBOARD_CSRF_META_NAME}"]`);
      return token === null ? null : { getAttribute: () => token };
    },
  };
}

describe("dashboardMutationHeaders", () => {
  it("returns exact JSON and session-token headers", () => {
    const token = "A".repeat(43);
    const headers = dashboardMutationHeaders(metaRoot(token));

    assertEquals(headers.get("content-type"), "application/json");
    assertEquals(headers.get(DASHBOARD_CSRF_HEADER_NAME), token);
  });

  it("fails closed when the shell token is missing or malformed", () => {
    assertThrows(() => dashboardMutationHeaders(metaRoot(null)), Error, "reload");
    assertThrows(() => dashboardMutationHeaders(metaRoot("predictable")), Error, "reload");
  });
});
