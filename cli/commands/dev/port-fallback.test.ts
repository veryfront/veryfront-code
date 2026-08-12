import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findAvailablePort,
  isAddressFamilyUnavailableError,
  isPortAvailable,
  isPortInUseError,
  MAX_PORT_FALLBACK_ATTEMPTS,
  MAX_TCP_PORT,
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

/**
 * Binds an ephemeral loopback port on one family, or returns null when the host
 * has no address in that family at all (CI containers are routinely IPv4-only).
 */
function listenOnLoopback(hostname: string): Deno.Listener | null {
  try {
    return Deno.listen({ hostname, port: 0 });
  } catch (error) {
    if (isPortInUseError(error)) throw error;
    return null;
  }
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

    it("stops at the last valid TCP port instead of probing past it", async () => {
      const start = MAX_TCP_PORT - 2;
      const { probe, probed } = probeBusyOn([start, start + 1, MAX_TCP_PORT]);

      const error = await findAvailablePort(start, MAX_PORT_FALLBACK_ATTEMPTS, probe).then(
        () => null,
        (caught: unknown) => caught,
      );

      // A runtime rejects 65536 as an invalid port, not as an address in use,
      // so probing it would let a raw error escape instead of PORT_IN_USE.
      assertEquals(probed, [start, start + 1, MAX_TCP_PORT]);
      assert(error instanceof Error, "expected the exhausted scan to reject");
      const veryfrontError = error as Error & { slug?: string };
      assertEquals(veryfrontError.slug, "port-in-use");
      assertStringIncludes(veryfrontError.message, String(MAX_TCP_PORT));
    });

    it("still probes an out-of-range requested port so the runtime can reject it", async () => {
      const probed: number[] = [];

      await findAvailablePort(MAX_TCP_PORT + 1, MAX_PORT_FALLBACK_ATTEMPTS, (port) => {
        probed.push(port);
        return Promise.resolve(true);
      });

      assertEquals(probed, [MAX_TCP_PORT + 1]);
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

    it("skips a port held on IPv6 only", async () => {
      // `veryfront dev` starts its MCP server on `localhost`, which resolves to
      // ::1 wherever IPv6 is available - so a second dev server's port scan sees
      // an IPv4-only probe succeed on a port the first instance already holds,
      // and hands out a port that is not actually free.
      const held = listenOnLoopback("::1");
      if (!held) return; // no IPv6 on this host - nothing to collide with

      const heldPort = (held.addr as Deno.NetAddr).port;
      try {
        assertEquals(await isPortAvailable(heldPort), false);
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

  describe("published npm build", () => {
    // dnt rewrites every bare `Deno.` call site in the published npm package
    // into `@deno/shim-deno`, whose Node-backed `listen()` reads
    // `server._handle.fd` - null under Deno's `node:net`. A CLI installed with
    // `deno install -gArf npm:veryfront` runs that package on a real Deno, so
    // the runtime check passed while the call reached the shim, and
    // `veryfront dev` died on "Cannot read properties of null (reading 'fd')"
    // before printing a URL. Deno and the shim are the same object in-repo, so
    // the invariant has to be asserted over the source dnt actually rewrites.
    it("probes ports through getDenoRuntime(), not the bare global dnt rewrites", async () => {
      const source = await Deno.readTextFile(new URL("./port-fallback.ts", import.meta.url));
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
        .replace(/\/\/[^\n]*/g, "");

      assertEquals(
        code.match(/(^|[^.\w$])Deno\s*\./g) ?? [],
        [],
        "reach the runtime via getDenoRuntime() - dnt rewrites bare Deno calls to @deno/shim-deno",
      );
      assertStringIncludes(code, "getDenoRuntime()");
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

  describe("isAddressFamilyUnavailableError", () => {
    // Probing both loopback families must not make a genuinely free port look
    // busy on a host that has only one of them - an IPv4-only container would
    // otherwise report every port as taken and never fall forward at all.
    it("recognises the error an address this host does not have throws", () => {
      let thrown: unknown;
      try {
        // ::2 is assigned to no interface, so binding it fails the same way
        // binding ::1 fails on a host with IPv6 switched off.
        Deno.listen({ hostname: "::2", port: 0 }).close();
      } catch (error) {
        thrown = error;
      }

      assert(thrown !== undefined, "listening on an unassigned address must throw");
      assert(
        isAddressFamilyUnavailableError(thrown),
        `the runtime's own error must be recognised, got ${String(thrown)}`,
      );
      assert(!isPortInUseError(thrown), "an absent address is not a port collision");
    });

    it("recognises the Node error shapes", () => {
      for (const code of ["EADDRNOTAVAIL", "EAFNOSUPPORT"]) {
        const error = Object.assign(new Error(`listen ${code} ::1`), { code });
        assert(isAddressFamilyUnavailableError(error), `${code} must be recognised`);
      }
    });

    it("does not treat a port collision or an unrelated failure as a missing family", () => {
      const inUse = Object.assign(new Error("listen EADDRINUSE: address already in use"), {
        code: "EADDRINUSE",
      });

      assert(!isAddressFamilyUnavailableError(inUse));
      assert(!isAddressFamilyUnavailableError(new Error("boom")));
      assert(!isAddressFamilyUnavailableError("EADDRNOTAVAIL"));
      assert(!isAddressFamilyUnavailableError(undefined));
    });
  });
});
