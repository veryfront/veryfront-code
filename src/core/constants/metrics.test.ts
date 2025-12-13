import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  SSR_RENDER_TIME_BOUNDARIES_MS,
  HTTP_REQUEST_DURATION_BOUNDARIES_MS,
  RSC_STREAM_DURATION_BOUNDARIES_MS,
  DEFAULT_METRICS_COLLECTION_INTERVAL_MS,
  DEFAULT_RATE_LIMIT_REQUESTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  CACHE_METRICS_SAMPLE_SIZE,
} from "./metrics.ts";

describe("constants/metrics", () => {
  describe("SSR_RENDER_TIME_BOUNDARIES_MS", () => {
    it("should export array of time boundaries", () => {
      assert(Array.isArray(SSR_RENDER_TIME_BOUNDARIES_MS));
      assertEquals(SSR_RENDER_TIME_BOUNDARIES_MS.length, 14);
    });

    it("should have ascending values", () => {
      for (let i = 1; i < SSR_RENDER_TIME_BOUNDARIES_MS.length; i++) {
        const current = SSR_RENDER_TIME_BOUNDARIES_MS[i];
        const previous = SSR_RENDER_TIME_BOUNDARIES_MS[i - 1];
        assert(
          current !== undefined && previous !== undefined && current > previous,
          "Boundaries should be in ascending order"
        );
      }
    });

    it("should start with 5ms and end with 10000ms", () => {
      assertEquals(SSR_RENDER_TIME_BOUNDARIES_MS[0], 5);
      const lastIdx = SSR_RENDER_TIME_BOUNDARIES_MS.length - 1;
      assertEquals(SSR_RENDER_TIME_BOUNDARIES_MS[lastIdx], 10000);
    });
  });

  describe("HTTP_REQUEST_DURATION_BOUNDARIES_MS", () => {
    it("should be same as SSR render time boundaries", () => {
      assertEquals(HTTP_REQUEST_DURATION_BOUNDARIES_MS, SSR_RENDER_TIME_BOUNDARIES_MS);
    });

    it("should have same length", () => {
      assertEquals(
        HTTP_REQUEST_DURATION_BOUNDARIES_MS.length,
        SSR_RENDER_TIME_BOUNDARIES_MS.length
      );
    });
  });

  describe("RSC_STREAM_DURATION_BOUNDARIES_MS", () => {
    it("should export array of time boundaries", () => {
      assert(Array.isArray(RSC_STREAM_DURATION_BOUNDARIES_MS));
      assertEquals(RSC_STREAM_DURATION_BOUNDARIES_MS.length, 9);
    });

    it("should have ascending values", () => {
      for (let i = 1; i < RSC_STREAM_DURATION_BOUNDARIES_MS.length; i++) {
        const current = RSC_STREAM_DURATION_BOUNDARIES_MS[i];
        const previous = RSC_STREAM_DURATION_BOUNDARIES_MS[i - 1];
        assert(
          current !== undefined && previous !== undefined && current > previous,
          "Boundaries should be in ascending order"
        );
      }
    });

    it("should start with 10ms and end with 5000ms", () => {
      assertEquals(RSC_STREAM_DURATION_BOUNDARIES_MS[0], 10);
      const lastIdx = RSC_STREAM_DURATION_BOUNDARIES_MS.length - 1;
      assertEquals(RSC_STREAM_DURATION_BOUNDARIES_MS[lastIdx], 5000);
    });
  });

  describe("metrics collection", () => {
    it("should have correct default collection interval (60s)", () => {
      assertEquals(DEFAULT_METRICS_COLLECTION_INTERVAL_MS, 60000);
      assertEquals(DEFAULT_METRICS_COLLECTION_INTERVAL_MS, 60 * 1000);
    });

    it("should have correct cache metrics sample size", () => {
      assertEquals(CACHE_METRICS_SAMPLE_SIZE, 100);
    });
  });

  describe("rate limiting", () => {
    it("should have correct default rate limit requests", () => {
      assertEquals(DEFAULT_RATE_LIMIT_REQUESTS, 100);
    });

    it("should have correct default rate limit window (60s)", () => {
      assertEquals(DEFAULT_RATE_LIMIT_WINDOW_MS, 60000);
      assertEquals(DEFAULT_RATE_LIMIT_WINDOW_MS, 60 * 1000);
    });

    it("should have rate limit window equal to metrics collection interval", () => {
      assertEquals(DEFAULT_RATE_LIMIT_WINDOW_MS, DEFAULT_METRICS_COLLECTION_INTERVAL_MS);
    });
  });

  describe("boundary value ranges", () => {
    it("should have SSR boundaries covering a wide range", () => {
      const min = SSR_RENDER_TIME_BOUNDARIES_MS[0];
      const max = SSR_RENDER_TIME_BOUNDARIES_MS[SSR_RENDER_TIME_BOUNDARIES_MS.length - 1];
      assert(min !== undefined && max !== undefined);
      assertEquals(max / min, 2000); // 10000 / 5 = 2000x range
    });

    it("should have RSC boundaries covering a narrower range", () => {
      const min = RSC_STREAM_DURATION_BOUNDARIES_MS[0];
      const max = RSC_STREAM_DURATION_BOUNDARIES_MS[RSC_STREAM_DURATION_BOUNDARIES_MS.length - 1];
      assert(min !== undefined && max !== undefined);
      assertEquals(max / min, 500); // 5000 / 10 = 500x range
    });
  });
});
