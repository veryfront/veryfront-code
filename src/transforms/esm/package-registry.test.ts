import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  clearReactVersionCache,
  DEFAULT_REACT_VERSION,
  isValidReactVersion,
  normalizeReactVersion,
  resolveProjectReactVersion,
  stripSemverRange,
} from "./package-registry.ts";

describe("package-registry", () => {
  describe("stripSemverRange", () => {
    it("should strip ^ prefix", () => {
      assertEquals(stripSemverRange("^19.0.0"), "19.0.0");
    });

    it("should strip ~ prefix", () => {
      assertEquals(stripSemverRange("~19.0.0"), "19.0.0");
    });

    it("should strip >= prefix", () => {
      assertEquals(stripSemverRange(">=19.0.0"), "19.0.0");
    });

    it("should strip > prefix", () => {
      assertEquals(stripSemverRange(">19.0.0"), "19.0.0");
    });

    it("should not modify exact versions", () => {
      assertEquals(stripSemverRange("19.1.1"), "19.1.1");
    });
  });

  describe("isValidReactVersion", () => {
    it("should accept X.Y.Z format", () => {
      assertEquals(isValidReactVersion("19.1.1"), true);
    });

    it("should reject range prefixes", () => {
      assertEquals(isValidReactVersion("^19.0.0"), false);
    });

    it("should reject incomplete versions", () => {
      assertEquals(isValidReactVersion("19.0"), false);
    });
  });

  describe("normalizeReactVersion", () => {
    it("should return valid version unchanged", () => {
      assertEquals(normalizeReactVersion("19.0.0"), "19.0.0");
    });

    it("should fallback to default for undefined", () => {
      assertEquals(normalizeReactVersion(undefined), DEFAULT_REACT_VERSION);
    });

    it("should fallback to default for invalid format", () => {
      assertEquals(normalizeReactVersion("not-a-version"), DEFAULT_REACT_VERSION);
    });
  });

  describe("resolveProjectReactVersion", () => {
    afterEach(() => {
      clearReactVersionCache();
    });

    it("should return DEFAULT_REACT_VERSION when no options", async () => {
      const version = await resolveProjectReactVersion({});
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should return DEFAULT_REACT_VERSION for null projectDir", async () => {
      const version = await resolveProjectReactVersion({ projectDir: null });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should return DEFAULT_REACT_VERSION for nonexistent projectDir", async () => {
      const version = await resolveProjectReactVersion({
        projectDir: "/nonexistent/path",
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should prefer config override over everything", async () => {
      const version = await resolveProjectReactVersion({
        projectDir: "/nonexistent/path",
        config: {
          client: {
            cdn: {
              versions: {
                react: "18.3.1",
              },
            },
          },
        },
      });
      assertEquals(version, "18.3.1");
    });

    it("should strip range prefix from config override", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: {
                react: "^18.3.1",
              },
            },
          },
        },
      });
      assertEquals(version, "18.3.1");
    });

    it("should skip config when versions is 'auto'", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: "auto",
            },
          },
        },
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });

    it("should skip config when versions.react is not set", async () => {
      const version = await resolveProjectReactVersion({
        config: {
          client: {
            cdn: {
              versions: {
                veryfront: "0.1.10",
              },
            },
          },
        },
      });
      assertEquals(version, DEFAULT_REACT_VERSION);
    });
  });
});
