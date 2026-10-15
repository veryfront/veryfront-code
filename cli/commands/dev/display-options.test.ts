import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import {
  markConfigFileSource,
  markEnvFileSource,
  markProcessEnvSource,
} from "veryfront/utils/env-loader";
import { captureDevDisplayOptions } from "./display-options.ts";

it("accepts process display overrides and ignores project file values", () => {
  const keys = ["STUDIO_URL", "VERYFRONT_DEFAULT_MODEL"];
  const saved = keys.map(getEnv);
  try {
    setEnv("STUDIO_URL", "http://localhost:3440");
    setEnv("VERYFRONT_DEFAULT_MODEL", "mistral/ministral-3-8b-local");
    keys.forEach(markProcessEnvSource);
    const captured = captureDevDisplayOptions();
    assertEquals(captured, {
      studioUrl: "http://localhost:3440",
      defaultModel: "mistral/ministral-3-8b-local",
    });
    keys.forEach((key) => markEnvFileSource(key, "/project/.env"));
    assertEquals(captureDevDisplayOptions(), {});
    keys.forEach((key) => markConfigFileSource(key, "/project/veryfront.json"));
    assertEquals(captureDevDisplayOptions(), {});
    assertEquals(captured.studioUrl, "http://localhost:3440");
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) deleteEnv(key);
      else setEnv(key, saved[i]!);
      markProcessEnvSource(key);
    });
  }
});
