import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { controlPlaneRunIdFromPath } from "./control-plane-routes.ts";

describe("controlPlaneRunIdFromPath", () => {
  it("reads the run id from every signed run operation route", () => {
    for (const operation of ["execute", "stream", "resume"]) {
      assertEquals(
        controlPlaneRunIdFromPath("POST", `/api/control-plane/runs/run_1/${operation}`),
        "run_1",
      );
    }
    assertEquals(controlPlaneRunIdFromPath("delete", "/api/control-plane/runs/run_1"), "run_1");
  });

  it("returns undefined for a method and path pair no run handler serves", () => {
    assertEquals(
      controlPlaneRunIdFromPath("GET", "/api/control-plane/runs/run_1/stream"),
      undefined,
    );
    assertEquals(controlPlaneRunIdFromPath("POST", "/api/control-plane/runs/run_1"), undefined);
    assertEquals(
      controlPlaneRunIdFromPath("POST", "/api/control-plane/runs/run_1/logs"),
      undefined,
    );
    assertEquals(controlPlaneRunIdFromPath("POST", "/api/control-plane/agents/list"), undefined);
  });
});
