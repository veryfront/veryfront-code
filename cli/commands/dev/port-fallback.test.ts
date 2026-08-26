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
 * How many freshly reserved ports to try before calling a free-port rejection
 * real rather than contention from a parallel job.
 */
const FREE_PORT_ATTEMPTS = 25;

/**
 * Binds an ephemeral port on one address, or returns null when the host has no
 * address in that family at all (CI containers are routinely IPv4-only).
 *
 * Only a missing address family is worth skipping for. Every other bind failure
 * - a permission error, a resource limit - is rethrown, so it fails the test
 * that called this rather than quietly turning it into a no-op.
 */
function listenOn(hostname: string): Deno.Listener | null {
  try {
    return Deno.listen({ hostname, port: 0 });
  } catch (error) {
    if (isAddressFamilyUnavailableError(error)) return null;
    throw error;
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
      const held = listenOn("::1");
      if (!held) return; // no IPv6 on this host - nothing to collide with

      const heldPort = (held.addr as Deno.NetAddr).port;
      try {
        assertEquals(await isPortAvailable(heldPort), false);
      } finally {
        held.close();
      }
    });

    it("skips a port held on a wildcard address", async () => {
      // BSD and macOS let a more specific address bind over a wildcard holder,
      // so loopback-only probes call a bare `listen(port)` port free and the
      // dev server lands beside that listener instead of falling forward.
      for (const wildcard of ["::", "0.0.0.0"]) {
        const held = listenOn(wildcard);
        if (!held) continue; // no address in that family on this host

        const heldPort = (held.addr as Deno.NetAddr).port;
        try {
          assertEquals(
            await isPortAvailable(heldPort),
            false,
            `a listener on ${wildcard}:${heldPort} must count as holding that port`,
          );
        } finally {
          held.close();
        }
      }
    });

    it("accepts a port nothing is holding", async () => {
      // Nothing can hold a port open and leave it free to bind at the same
      // time, so a port this test releases is only free until some other
      // process claims it - and CI runs ~30 jobs against one host, which is how
      // asserting a single arbitrary port stays free ejected an unrelated PR
      // from the merge queue.
      //
      // Retrying on a freshly reserved port drops that assumption without
      // softening the assertion: a probe that rejects free ports rejects every
      // one of these too, and still fails the test.
      const rejected: number[] = [];
      let accepted = false;

      for (let attempt = 0; attempt < FREE_PORT_ATTEMPTS && !accepted; attempt++) {
        const reserved = Deno.listen({ hostname: "127.0.0.1", port: 0 });
        const freePort = (reserved.addr as Deno.NetAddr).port;
        reserved.close();

        if (await isPortAvailable(freePort)) accepted = true;
        else rejected.push(freePort); // lost the port to a parallel job - retry
      }

      assert(
        accepted,
        `isPortAvailable() rejected all ${FREE_PORT_ATTEMPTS} just-released ports: ` +
          rejected.join(", "),
      );
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
    // The shapes are constructed rather than provoked from a real bind. There
    // is no address a test can rely on being unbindable: `::2` is unassigned on
    // most hosts but bindable on some, and on Linux with
    // `net.ipv6.ip_nonlocal_bind=1` the bind simply succeeds. Depending on that
    // would be the same ambient-state assumption this file just removed from
    // "accepts a port nothing is holding". Constructing the shapes also reaches
    // the Node branch, which a live bind on a Deno host cannot exercise at all.
    it("recognises the error class Deno itself raises", () => {
      // Deno's own constructor, not a hand-rolled Error with a spoofed name: if
      // the runtime ever renames this class the test fails loudly here rather
      // than drifting silently away from what the probe actually catches.
      const error = new Deno.errors.AddrNotAvailable(
        "Can't assign requested address (os error 49)",
      );

      assert(isAddressFamilyUnavailableError(error), "Deno's AddrNotAvailable must be recognised");
      assert(!isPortInUseError(error), "an absent address is not a port collision");
    });

    it("recognises the Node error shapes", () => {
      for (const code of ["EADDRNOTAVAIL", "EAFNOSUPPORT"]) {
        const error = Object.assign(new Error(`listen ${code} ::1`), { code });
        assert(isAddressFamilyUnavailableError(error), `${code} must be recognised`);
      }
    });

    it("recognises a missing family reported only in the message", () => {
      // Some runtimes surface the failure with neither a `code` nor a
      // distinguishing `name` - EAFNOSUPPORT reaches Deno this way.
      const messages = [
        "Cannot assign requested address (os error 99)",
        "Can't assign requested address (os error 49)",
        "listen EADDRNOTAVAIL: address not available",
        "Address family not supported by protocol (os error 97)",
        "listen EAFNOSUPPORT ::1",
      ];

      for (const message of messages) {
        assert(
          isAddressFamilyUnavailableError(new Error(message)),
          `must be recognised from the message alone: ${message}`,
        );
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

describe("cli/commands/dev/port-fallback: port 0", () => {
  it("resolves --port 0 to a concrete ephemeral port before the server starts", async () => {
    // Everything downstream of the dev server - the MCP port, VERYFRONT_DEV_PORT,
    // the module server URL, the printed http://localhost:<port> - is derived
    // from the number the server was handed. Handing it 0 would let the OS pick
    // a port nothing else is told about.
    const probed: number[] = [];
    const port = await findAvailablePort(
      0,
      MAX_PORT_FALLBACK_ATTEMPTS,
      (candidate) => {
        probed.push(candidate);
        return Promise.resolve(true);
      },
    );

    assert(port > 0, `expected a real port, got ${port}`);
    assert(port <= MAX_TCP_PORT, `expected a TCP port, got ${port}`);
    assertEquals(probed, [port]);
  });
});
