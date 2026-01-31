import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";

function createMockReq(method: string, headers: Record<string, string>) {
  return { method, headers };
}

describe("convertNodeRequestToWebRequest", () => {
  it("should export the function", () => {
    assertExists(convertNodeRequestToWebRequest);
    assertEquals(typeof convertNodeRequestToWebRequest, "function");
  });

  it("should convert a GET request", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("GET", { "content-type": "application/json" }) as any,
      "http://localhost/test",
    );

    assertExists(result);
    assertEquals(result.method, "GET");
    assertEquals(result.url, "http://localhost/test");
  });

  it("should convert a POST request", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("POST", { "content-type": "application/json" }) as any,
      "http://localhost/api",
    );

    assertExists(result);
    assertEquals(result.method, "POST");
    assertEquals(result.url, "http://localhost/api");
  });

  it("should preserve headers", () => {
    const result = convertNodeRequestToWebRequest(
      createMockReq("GET", {
        "x-custom-header": "custom-value",
        authorization: "Bearer token",
      }) as any,
      "http://localhost/test",
    );

    assertEquals(result.headers.get("x-custom-header"), "custom-value");
    assertEquals(result.headers.get("authorization"), "Bearer token");
  });
});
