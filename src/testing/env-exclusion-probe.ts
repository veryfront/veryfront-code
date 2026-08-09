/**
 * Cross-file regression probe for BDD environment isolation.
 *
 * Each participant writes the same process environment keys from module scope
 * and `beforeAll`, then waits until its peer has done the same. Without a
 * file/suite overlay, one participant must observe the other's value because
 * parallel Deno test-file isolates share process environment state.
 *
 * @module testing/env-exclusion-probe
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertEquals } from "./assert.ts";
import { afterAll, beforeAll, describe, it } from "./bdd.ts";

const MODULE_ENV_KEY = `VF_TEST_BDD_MODULE_ENV_${Deno.pid}`;
const PRELOAD_ENV_KEY = `VF_TEST_BDD_PRELOAD_ENV_${Deno.pid}`;
const SUITE_ENV_KEY = `VF_TEST_BDD_SUITE_ENV_${Deno.pid}`;
const READY_DIR = join(tmpdir(), `veryfront-test-env-exclusion-${Deno.pid}`);
const PEER_WAIT_MS = 2_000;

async function waitForPeerMarker(label: "a" | "b", phase: "ready" | "checked"): Promise<void> {
  const peer = label === "a" ? "b" : "a";
  const deadline = Date.now() + PEER_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      await Deno.stat(join(READY_DIR, `${phase}-${peer}`));
      return;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${phase} marker from test file ${peer}`);
}

async function cleanupProbe(label: "a" | "b"): Promise<void> {
  if (label !== "a") return;
  try {
    await waitForPeerMarker(label, "checked");
  } finally {
    await Deno.remove(READY_DIR, { recursive: true }).catch((error) => {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    });
  }
}

/** Register one half of the cross-file environment-isolation probe. */
export function registerEnvIsolationProbe(label: "a" | "b"): void {
  Deno.env.set(MODULE_ENV_KEY, label);

  describe(`testing/BDD cross-file environment isolation (${label})`, () => {
    beforeAll(async () => {
      Deno.env.set(SUITE_ENV_KEY, label);
      await Deno.mkdir(READY_DIR, { recursive: true });
      await Deno.writeTextFile(join(READY_DIR, `ready-${label}`), label);
      await waitForPeerMarker(label, "ready");
    });

    afterAll(async () => {
      Deno.env.delete(MODULE_ENV_KEY);
      Deno.env.delete(PRELOAD_ENV_KEY);
      Deno.env.delete(SUITE_ENV_KEY);
      await cleanupProbe(label);
    });

    it("keeps module and suite environment values inside this test file", async () => {
      assertEquals(Deno.env.get(MODULE_ENV_KEY), label);
      assertEquals(Deno.env.get(PRELOAD_ENV_KEY), label);
      assertEquals(Deno.env.get(SUITE_ENV_KEY), label);
      await Deno.writeTextFile(join(READY_DIR, `checked-${label}`), label);
    });
  });

  describe(`testing/BDD file environment cleanup (${label})`, () => {
    it("does not expose cleaned module environment values to a later suite", () => {
      assertEquals(Deno.env.get(MODULE_ENV_KEY), undefined);
      assertEquals(Deno.env.get(PRELOAD_ENV_KEY), undefined);
      assertEquals(Deno.env.get(SUITE_ENV_KEY), undefined);
    });
  });
}
