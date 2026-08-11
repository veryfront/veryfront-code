import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findAvailablePort,
  isPortAvailable,
  isPortInUseError,
  MAX_PORT_FALLBACK_ATTEMPTS,
} from "./port-fallback.ts";

/** A probe reporting the given ports as taken, recording what was asked about. */
function probeBusyOn(busy: number[]): {
  probe: (port: number) => Promise<boolean>;
  probed: number[];
} {
  const probed: number[] = [];
  return {
    probed,
    probe: (port: number) => {
      probed.push(port);
      return Promise.resolve(!busy.includes(port));
    },
  };
}

describe("cli/commands/dev/port-fallback", () => {
  describe("findAvailablePort", () => {
    it("keeps the requested port when it is free", async () => {
      const { probe, probed } = probeBusyOn([]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3000);
      assertEquals(probed, [3000]);
    });

    it("falls forward to the next free port when the default dev port is taken", async () => {
      const { probe, probed } = probeBusyOn([3000]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3001);
      assertEquals(probed, [3000, 3001]);
    });

    it("keeps scanning past a run of busy ports", async () => {
      const { probe, probed } = probeBusyOn([3000, 3001, 3002]);

      assertEquals(await findAvailablePort(3000, MAX_PORT_FALLBACK_ATTEMPTS, probe), 3003);
      assertEquals(probed, [3000, 3001, 3002, 3003]);
    });

    it("falls forward from an explicitly requested port too", async () => {
      const { probe } = probeBusyOn([8080]);

      assertEquals(await findAvailablePort(8080, MAX_PORT_FALLBACK_ATTEMPTS, probe), 8081);
    });

    it("reports the --port flag once the whole scan range is busy", async () => {
      const busy = [3000, 3001, 3002];
      const { probe } = probeBusyOn(busy);

      const error = await findAvailablePort(3000, busy.length, probe).then(
        () => null,
        (caught: unknown) => caught,
      );

      assert(error instanceof Error, "expected the exhausted scan to reject");
      const veryfrontError = error as Error & { slug?: string; suggestion?: string };
      assertEquals(veryfrontError.slug, "port-in-use");
      assertStringIncludes(veryfrontError.message, "3000");
      assertStringIncludes(veryfrontError.message, "3002");
      assertStringIncludes(veryfrontError.suggestion ?? "", "--port");
    });
  });

  describe("isPortAvailable", () => {
    it("skips a port another process is really holding", async () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;

      try {
        assertEquals(await isPortAvailable(heldPort), false);

        // Which port it lands on depends on what else the machine is running,
        // but it must never be the held one, and must never throw.
        const chosen = await findAvailablePort(heldPort, MAX_PORT_FALLBACK_ATTEMPTS);
        assert(chosen > heldPort, `expected a port after ${heldPort}, got ${chosen}`);
        assert(chosen < heldPort + MAX_PORT_FALLBACK_ATTEMPTS);
      } finally {
        held.close();
      }
    });

    it("accepts a port nothing is holding", async () => {
      const probeListener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const freePort = (probeListener.addr as Deno.NetAddr).port;
      probeListener.close();

      assertEquals(await isPortAvailable(freePort), true);
    });
  });

  describe("isPortInUseError", () => {
    it("recognises the address-in-use error the runtime actually throws", () => {
      const held = Deno.listen({ hostname: "127.0.0.1", port: 0 });
      const heldPort = (held.addr as Deno.NetAddr).port;

      try {
        let thrown: unknown;
        try {
          Deno.listen({ hostname: "127.0.0.1", port: heldPort }).close();
        } catch (error) {
          thrown = error;
        }

        assert(thrown !== undefined, "second listen on a held port must throw");
        assert(isPortInUseError(thrown), "the runtime's own error must be recognised");
      } finally {
        held.close();
      }
    });

    it("recognises the Node error shape", () => {
      const error = Object.assign(new Error("listen EADDRINUSE: address already in use :::3000"), {
        code: "EADDRINUSE",
      });

      assert(isPortInUseError(error));
    });

    it("does not treat unrelated failures as port collisions", () => {
      assert(!isPortInUseError(new Error("boom")));
      assert(!isPortInUseError("EADDRINUSE"));
      assert(!isPortInUseError(undefined));
    });
  });
});
