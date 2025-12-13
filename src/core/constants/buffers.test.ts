import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  BUFFER_SIZE_256_BYTES,
  BUFFER_SIZE_512_BYTES,
  BUFFER_SIZE_1_KB,
  BUFFER_SIZE_2_KB,
  BUFFER_SIZE_4_KB,
  BUFFER_SIZE_8_KB,
  BUFFER_SIZE_16_KB,
  BUFFER_SIZE_32_KB,
  BUFFER_SIZE_64_KB,
  RSC_FILE_READ_BUFFER_SIZE_BYTES,
  DEFAULT_MAX_BODY_SIZE_BYTES,
  DEFAULT_MAX_URL_LENGTH_BYTES,
  DEFAULT_MAX_HEADER_SIZE_BYTES,
  DEFAULT_MAX_FILE_SIZE_BYTES,
  PREFETCH_QUEUE_MAX_SIZE_BYTES,
  MAX_BUNDLE_CHUNK_SIZE_BYTES,
} from "./buffers.ts";

describe("constants/buffers", () => {
  describe("buffer size constants", () => {
    it("should export correct byte values", () => {
      assertEquals(BUFFER_SIZE_256_BYTES, 256);
      assertEquals(BUFFER_SIZE_512_BYTES, 512);
      assertEquals(BUFFER_SIZE_1_KB, 1024);
      assertEquals(BUFFER_SIZE_2_KB, 2048);
      assertEquals(BUFFER_SIZE_4_KB, 4096);
      assertEquals(BUFFER_SIZE_8_KB, 8192);
      assertEquals(BUFFER_SIZE_16_KB, 16384);
      assertEquals(BUFFER_SIZE_32_KB, 32768);
      assertEquals(BUFFER_SIZE_64_KB, 65536);
    });

    it("should have correct power-of-2 relationships", () => {
      assertEquals(BUFFER_SIZE_512_BYTES, BUFFER_SIZE_256_BYTES * 2);
      assertEquals(BUFFER_SIZE_1_KB, BUFFER_SIZE_512_BYTES * 2);
      assertEquals(BUFFER_SIZE_2_KB, BUFFER_SIZE_1_KB * 2);
      assertEquals(BUFFER_SIZE_4_KB, BUFFER_SIZE_2_KB * 2);
      assertEquals(BUFFER_SIZE_8_KB, BUFFER_SIZE_4_KB * 2);
      assertEquals(BUFFER_SIZE_16_KB, BUFFER_SIZE_8_KB * 2);
      assertEquals(BUFFER_SIZE_32_KB, BUFFER_SIZE_16_KB * 2);
      assertEquals(BUFFER_SIZE_64_KB, BUFFER_SIZE_32_KB * 2);
    });

    it("should be in ascending order", () => {
      assert(BUFFER_SIZE_512_BYTES > BUFFER_SIZE_256_BYTES);
      assert(BUFFER_SIZE_1_KB > BUFFER_SIZE_512_BYTES);
      assert(BUFFER_SIZE_2_KB > BUFFER_SIZE_1_KB);
      assert(BUFFER_SIZE_4_KB > BUFFER_SIZE_2_KB);
      assert(BUFFER_SIZE_8_KB > BUFFER_SIZE_4_KB);
      assert(BUFFER_SIZE_16_KB > BUFFER_SIZE_8_KB);
      assert(BUFFER_SIZE_32_KB > BUFFER_SIZE_16_KB);
      assert(BUFFER_SIZE_64_KB > BUFFER_SIZE_32_KB);
    });
  });

  describe("RSC file read buffer", () => {
    it("should use 2KB buffer size", () => {
      assertEquals(RSC_FILE_READ_BUFFER_SIZE_BYTES, BUFFER_SIZE_2_KB);
      assertEquals(RSC_FILE_READ_BUFFER_SIZE_BYTES, 2048);
    });
  });

  describe("max size constants", () => {
    it("should have correct default max body size (1MB)", () => {
      assertEquals(DEFAULT_MAX_BODY_SIZE_BYTES, 1024 * 1024);
      assertEquals(DEFAULT_MAX_BODY_SIZE_BYTES, 1048576);
    });

    it("should have correct default max URL length", () => {
      assertEquals(DEFAULT_MAX_URL_LENGTH_BYTES, BUFFER_SIZE_2_KB);
      assertEquals(DEFAULT_MAX_URL_LENGTH_BYTES, 2048);
    });

    it("should have correct default max header size", () => {
      assertEquals(DEFAULT_MAX_HEADER_SIZE_BYTES, BUFFER_SIZE_8_KB);
      assertEquals(DEFAULT_MAX_HEADER_SIZE_BYTES, 8192);
    });

    it("should have correct default max file size (5MB)", () => {
      assertEquals(DEFAULT_MAX_FILE_SIZE_BYTES, 5 * 1024 * 1024);
      assertEquals(DEFAULT_MAX_FILE_SIZE_BYTES, 5242880);
    });

    it("should have max file size greater than max body size", () => {
      assert(DEFAULT_MAX_FILE_SIZE_BYTES > DEFAULT_MAX_BODY_SIZE_BYTES);
    });
  });

  describe("prefetch and bundle constants", () => {
    it("should have correct prefetch queue max size (1MB)", () => {
      assertEquals(PREFETCH_QUEUE_MAX_SIZE_BYTES, 1024 * 1024);
      assertEquals(PREFETCH_QUEUE_MAX_SIZE_BYTES, 1048576);
    });

    it("should have correct max bundle chunk size (4MB)", () => {
      assertEquals(MAX_BUNDLE_CHUNK_SIZE_BYTES, 4096 * 1024);
      assertEquals(MAX_BUNDLE_CHUNK_SIZE_BYTES, 4194304);
    });

    it("should have bundle chunk size greater than prefetch queue", () => {
      assert(MAX_BUNDLE_CHUNK_SIZE_BYTES > PREFETCH_QUEUE_MAX_SIZE_BYTES);
    });
  });

  describe("size relationships", () => {
    it("should have appropriate header size limits", () => {
      assert(DEFAULT_MAX_HEADER_SIZE_BYTES < DEFAULT_MAX_BODY_SIZE_BYTES);
      assert(DEFAULT_MAX_URL_LENGTH_BYTES < DEFAULT_MAX_HEADER_SIZE_BYTES);
    });
  });
});
