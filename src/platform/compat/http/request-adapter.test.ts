import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { convertNodeRequestToWebRequest } from "./request-adapter.ts";

describe("convertNodeRequestToWebRequest", () => {
  it("should export the function", () => {
    assertExists(convertNodeRequestToWebRequest);
    assertEquals(typeof convertNodeRequestToWebRequest, "function");
  });

  it("should convert a GET request", () => {
    const mockReq = {
      method: "GET",
      headers: {
        "content-type": "application/json",
      },
    };

    const result = convertNodeRequestToWebRequest(mockReq as any, "http://localhost/test");

    assertExists(result);
    assertEquals(result.method, "GET");
    assertEquals(result.url, "http://localhost/test");
  });

  it("should convert a POST request", () => {
    const mockReq = {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    };

    const result = convertNodeRequestToWebRequest(mockReq as any, "http://localhost/api");

    assertExists(result);
    assertEquals(result.method, "POST");
    assertEquals(result.url, "http://localhost/api");
  });

  it("should preserve headers", () => {
    const mockReq = {
      method: "GET",
      headers: {
        "x-custom-header": "custom-value",
        "authorization": "Bearer token",
      },
    };

    const result = convertNodeRequestToWebRequest(mockReq as any, "http://localhost/test");

    assertEquals(result.headers.get("x-custom-header"), "custom-value");
    assertEquals(result.headers.get("authorization"), "Bearer token");
  });
});
