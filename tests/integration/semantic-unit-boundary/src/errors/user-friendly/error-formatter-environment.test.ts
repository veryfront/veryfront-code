import { assert, assertEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { withEnv } from "#veryfront/testing/deno-compat";
import { cyan, dim } from "#veryfront/compat/console";
import {
  formatErrorBox,
  formatUserError,
} from "#veryfront/errors/user-friendly/error-formatter.ts";

// formatUserError gates stack output on isProduction(), which resolves the
// ambient environment with no injectable seam, so these cases drive the gate
// by mutating process env through withEnv.
describe("formatUserError environment gating", () => {
  const unknownError = (): Error => {
    const error = new Error("unknown error xyz_unique_test");
    error.stack = [
      "Error: unknown error xyz_unique_test",
      "    at async file:///app/a.ts:1:1",
      "    at beta (file:///app/b.ts:2:2)",
      "    at gamma (file:///app/c.ts:3:3)",
      "    at delta (file:///app/d.ts:4:4)",
    ].join("\n");
    return error;
  };

  it("renders solution examples with the formatter-specific label style", () => {
    const error = new Error("Client boundary violation in component");
    const boxed = formatErrorBox(error);
    const plain = formatUserError(error);

    assert(boxed.includes(dim("Example:")));
    assert(plain.includes(cyan("Example:")));
    for (const output of [boxed, plain]) {
      assert(output.includes("import { db } from './database'"));
    }
  });

  it("renders a capped stack trace for unknown errors in development", async () => {
    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(unknownError());

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assertEquals(result.includes("at beta"), false, "an ambiguous single-label name is withheld");
      assertEquals(
        result.includes("at gamma"),
        false,
        "an ambiguous single-label name is withheld",
      );
      assert(
        result.includes("at <anonymous>"),
        "an async location-only frame keeps no local source location",
      );
      assertEquals(
        result.includes("file:///app/"),
        false,
        "user-facing development output must not expose local source paths",
      );
      assertEquals(
        result.includes("at delta"),
        false,
        "formatUserError caps the stack at 3 frames",
      );
      return Promise.resolve();
    });
  });

  it("redacts UNC and custom-formatted stack locations in development", async () => {
    const error = new Error("unknown error xyz_unique_test");
    error.stack = [
      "Error: unknown error xyz_unique_test",
      "    at \\\\build-server\\share\\app.ts:1:1",
      "    handler@file:///home/user/app.ts:2:2",
      "    @\\\\build-server\\share\\lib.ts:3:3",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assert(
        result.includes("at <anonymous>"),
        "a bare UNC frame keeps no local source location",
      );
      assertEquals(
        result.includes("at handler"),
        false,
        "an ambiguous single-label callable is withheld with its location",
      );
      assertEquals(
        result.includes("build-server"),
        false,
        "UNC hosts and shares must not reach user-facing output",
      );
      assertEquals(
        result.includes("file:///home/user"),
        false,
        "custom-frame locations must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts multi-delimiter custom stack frames in development", async () => {
    const error = new Error("unknown error multi_at_frames");
    error.stack = [
      "Error: unknown error multi_at_frames",
      "    handler@alias@app.ts:2:2",
      "    outer@inner@https://internal.example/lib.ts:3:3",
      "    stray@formatter emitted no location",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assert(
        result.includes("at handler@alias"),
        "a multi-delimiter frame keeps its full callable label",
      );
      assertEquals(
        result.includes("at outer"),
        false,
        "an ambiguous single-label prefix is withheld after splitting the location",
      );
      assert(
        result.includes("at <anonymous>"),
        "a custom frame with no recognizable location fails closed",
      );
      assertEquals(
        result.includes("app.ts"),
        false,
        "repo-relative filenames must not reach user-facing output",
      );
      assertEquals(
        result.includes("internal.example"),
        false,
        "internal hostnames must not reach user-facing output",
      );
      assertEquals(
        result.includes("formatter emitted no location"),
        false,
        "unrecognized custom-frame text must not pass through verbatim",
      );
      return Promise.resolve();
    });
  });

  it("redacts stack locations whose URI scheme is uppercase in development", async () => {
    const error = new Error("unknown error uppercase_scheme_dev");
    error.stack = [
      "Error: unknown error uppercase_scheme_dev",
      "    at FILE:///home/alice/app.ts:1:1",
      "    handler@FILE:///home/alice/lib.ts:2:2",
      "    at HTTPS://cdn.example.com/bundle.js:3:3",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assertEquals(result.includes("at handler"), false);
      assertEquals(
        result.includes("/home/alice"),
        false,
        "an uppercase file: scheme must not leak an absolute source path",
      );
      assertEquals(
        result.includes("cdn.example.com"),
        false,
        "an uppercase https: scheme must not leak a remote source location",
      );
      return Promise.resolve();
    });
  });

  it("redacts source filenames containing spaces in development", async () => {
    // A source map or custom formatter can emit a bare relative location whose
    // filename carries spaces; whitespace must not disqualify it as a location.
    const error = new Error("unknown error spaced_filename_dev");
    error.stack = [
      "Error: unknown error spaced_filename_dev",
      "    at private source.ts:1:1",
      "    at handler (file:///app/a.ts:2:2)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assertEquals(result.includes("at handler"), false);
      assert(
        result.includes("at <anonymous>"),
        "a spaced bare location is withheld rather than echoed",
      );
      assertEquals(
        result.includes("private source.ts"),
        false,
        "a filename containing spaces must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts a bare source filename containing parentheses in development", async () => {
    // Custom formatters can emit a single-segment relative location without a
    // separator, and parentheses remain legal filename characters.
    const error = new Error("unknown error parenthesized_filename_dev");
    error.stack = [
      "Error: unknown error parenthesized_filename_dev",
      "    at private(source).ts:1:1",
      "    at handler (file:///app/a.ts:2:2)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(
        result.includes("at <anonymous>"),
        "a parenthesized bare location is withheld rather than echoed",
      );
      assertEquals(
        result.includes("private(source).ts"),
        false,
        "a filename containing parentheses must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("withholds hostname-shaped labels in location-less and async stack frames", async () => {
    const error = new Error("unknown error hostname_callable_label_dev");
    error.stack = [
      "Error: unknown error hostname_callable_label_dev",
      "    at private-control-plane.example",
      "    at async private-control-plane.example",
      "    private-control-plane.example",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "a hostname-shaped label is withheld");
      assertEquals(
        result.includes("private-control-plane.example"),
        false,
        "a location-less project-controlled hostname must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("withholds internationalized hostnames and alternate DNS separators", async () => {
    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      for (
        const label of [
          "秘密.内部",
          "秘密。内部",
          "private．internal",
          "private｡internal",
        ]
      ) {
        const error = new Error("unknown error internationalized_hostname_label_dev");
        error.stack = [
          "Error: unknown error internationalized_hostname_label_dev",
          `    at ${label} (file:///app/a.ts:1:1)`,
        ].join("\n");
        const result = formatUserError(error);

        assert(result.includes("at <anonymous>"), "an IDN-shaped label is withheld");
        assertEquals(
          result.includes(label),
          false,
          "a Unicode or alternate-dot private hostname must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds percent-encoded ASCII hostnames", async () => {
    const error = new Error("unknown error encoded_hostname_label_dev");
    error.stack = [
      "Error: unknown error encoded_hostname_label_dev",
      "    at private%2Econtrol.example (node:internal/process/task_queues:1:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"));
      assertEquals(result.includes("private%2Econtrol.example"), false);
      return Promise.resolve();
    });
  });

  it("fails closed on unrecognized prepareStackTrace frames", async () => {
    const error = new Error("unknown error custom_stack_payload_dev");
    error.stack = [
      "Error: unknown error custom_stack_payload_dev",
      "customer_payload=acme-order-42",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"));
      assertEquals(result.includes("customer_payload"), false);
      assertEquals(result.includes("acme-order-42"), false);
      return Promise.resolve();
    });
  });

  it("withholds single-label IPv4 callable labels", async () => {
    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      for (const label of ["2130706433", "0x7f000001", "017700000001"]) {
        const error = new Error("unknown error single_label_ipv4_callable_dev");
        error.stack = [
          "Error: unknown error single_label_ipv4_callable_dev",
          `    at ${label} (file:///app/a.ts:1:1)`,
        ].join("\n");
        const result = formatUserError(error);

        assert(result.includes("at <anonymous>"), "an IPv4-shaped label is withheld");
        assertEquals(
          result.includes(label),
          false,
          "an integer, hexadecimal, or octal IPv4 label must not reach user-facing output",
        );
      }

      const outOfRange = new Error("unknown error out_of_range_numeric_callable_dev");
      outOfRange.stack = [
        "Error: unknown error out_of_range_numeric_callable_dev",
        "    at 4294967296 (file:///app/a.ts:1:1)",
      ].join("\n");
      assertEquals(
        formatUserError(outOfRange).includes("4294967296"),
        false,
        "a numeric single label remains indistinguishable from a private host",
      );
      return Promise.resolve();
    });
  });

  it("does not call a live URL hostname hook while classifying IDN labels", async () => {
    const error = new Error("unknown error mutated_url_hostname_hook");
    error.stack = [
      "Error: unknown error mutated_url_hostname_hook",
      "    at 秘密.内部 (file:///app/a.ts:1:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const descriptor = Object.getOwnPropertyDescriptor(URL.prototype, "hostname")!;
      let result: string;
      try {
        Object.defineProperty(URL.prototype, "hostname", {
          configurable: descriptor.configurable,
          get() {
            throw new Error("live URL.hostname must not run");
          },
        });
        result = formatUserError(error);
      } finally {
        Object.defineProperty(URL.prototype, "hostname", descriptor);
      }

      assert(result.includes("at <anonymous>"));
      assertEquals(result.includes("秘密.内部"), false);
      assertEquals(result.includes("live URL.hostname"), false);
      return Promise.resolve();
    });
  });

  it("withholds hostname-shaped constructor labels from parenthesized frames", async () => {
    const error = new Error("unknown error hostname_constructor_label_dev");
    error.stack = [
      "Error: unknown error hostname_constructor_label_dev",
      "    at new private-control-plane.example (file:///app/a.ts:1:1)",
      "    at new private-control-plane.example. (file:///app/b.ts:2:2)",
      "    at new 10.0.0.1 (file:///app/c.ts:3:3)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "hostname-shaped constructors are withheld");
      for (
        const label of [
          "private-control-plane.example",
          "private-control-plane.example.",
          "10.0.0.1",
        ]
      ) {
        assertEquals(
          result.includes(label),
          false,
          "a hostname-shaped constructor label must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds mixed-case DNS and bracketed IPv6 callable labels", async () => {
    const error = new Error("unknown error case_variant_host_labels_dev");
    error.stack = [
      "Error: unknown error case_variant_host_labels_dev",
      "    at PRIVATE.Control.Example (file:///app/a.ts:1:1)",
      "    at private-control-plane.EXAMPLE. (file:///app/b.ts:2:2)",
      "    at [FD00::1] (file:///app/c.ts:3:3)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "network-shaped labels are withheld");
      for (
        const label of [
          "PRIVATE.Control.Example",
          "private-control-plane.EXAMPLE.",
          "[FD00::1]",
        ]
      ) {
        assertEquals(
          result.includes(label),
          false,
          "a case-variant hostname or IPv6 label must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds unbracketed IPv6 callable labels", async () => {
    const error = new Error("unknown error unbracketed_ipv6_label_dev");
    error.stack = [
      "Error: unknown error unbracketed_ipv6_label_dev",
      "    at 2001:db8::dead (file:///app/a.ts:1:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "an unbracketed IPv6 label is withheld");
      assertEquals(
        result.includes("2001:db8::dead"),
        false,
        "an unbracketed IPv6 callable label must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("withholds ambiguous hostnames and scoped bracketed IPv6 callable labels", async () => {
    const error = new Error("unknown error scoped_host_labels_dev");
    error.stack = [
      "Error: unknown error scoped_host_labels_dev",
      "    at Internal.example (file:///app/a.ts:1:1)",
      "    at [fe80::1%eth0] (file:///app/b.ts:2:2)",
      "    at [fe80::1%25eth0] (file:///app/c.ts:3:3)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "network-shaped labels are withheld");
      for (const label of ["Internal.example", "[fe80::1%eth0]", "[fe80::1%25eth0]"]) {
        assertEquals(
          result.includes(label),
          false,
          "an ambiguous hostname or scoped IPv6 label must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("preserves safe receiver-qualified callable labels", async () => {
    const error = new Error("unknown error receiver_callable_label_dev");
    error.stack = [
      "Error: unknown error receiver_callable_label_dev",
      "    at Object.handler (file:///app/a.ts:1:1)",
      "    at async JSON.parse (file:///app/b.ts:2:2)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at Object.handler"), "a standard V8 method label is preserved");
      assert(
        result.includes("at async JSON.parse"),
        "an async built-in receiver-qualified callable label is preserved",
      );
      return Promise.resolve();
    });
  });

  it("withholds CamelCase hostname-shaped receiver labels", async () => {
    const error = new Error("unknown error camelcase_hostname_label_dev");
    error.stack = [
      "Error: unknown error camelcase_hostname_label_dev",
      "    at PrivateControl.example (file:///app/a.ts:1:1)",
      "    at async UserService.load (file:///app/b.ts:2:2)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(
        result.includes("at <anonymous>"),
        "a CamelCase hostname-shaped label is withheld",
      );
      for (const label of ["PrivateControl.example", "UserService.load"]) {
        assertEquals(
          result.includes(label),
          false,
          "DNS names are case-insensitive, so a capitalized hostname-shaped label must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds bare source filenames from fallback stack frames", async () => {
    const error = new Error("unknown error bare_filename_fallback_dev");
    error.stack = [
      "Error: unknown error bare_filename_fallback_dev",
      "    at private.ts",
      "    at async private_control.ts",
      "    private(source).ts",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "a bare filename fallback is withheld");
      for (const fileName of ["private.ts", "private_control.ts", "private(source).ts"]) {
        assertEquals(
          result.includes(fileName),
          false,
          "a coordinate-less custom stack filename must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds coordinate-less source specifiers with query or fragment suffixes", async () => {
    const error = new Error("unknown error suffixed_filename_fallback_dev");
    error.stack = [
      "Error: unknown error suffixed_filename_fallback_dev",
      "    at private.ts?build=one",
      "    at async private-worker.mjs#source",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"), "suffixed source specifiers are withheld");
      for (const source of ["private.ts?build=one", "private-worker.mjs#source"]) {
        assertEquals(
          result.includes(source),
          false,
          "a coordinate-less source specifier must not reach user-facing output",
        );
      }
      return Promise.resolve();
    });
  });

  it("withholds async on an ambiguous location-less callable label", async () => {
    const error = new Error("unknown error async_callable_label_dev");
    error.stack = [
      "Error: unknown error async_callable_label_dev",
      "    at async handler",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("at <anonymous>"));
      assertEquals(result.includes("at async handler"), false);
      return Promise.resolve();
    });
  });

  it("redacts opaque URI stack locations in development", async () => {
    // Node emits the whole `data:` module as the frame location for an imported
    // data URL, and builtin frames read `at node:internal/...`; neither carries
    // `//`, so scheme-plus-colon is what marks them as locations.
    const error = new Error("unknown error opaque_scheme_dev");
    error.stack = [
      "Error: unknown error opaque_scheme_dev",
      "    at data:text/javascript,(()=>{const PRIVATE_SOURCE_MARKER=1;})():1:43",
      "    at node:internal/modules/run_main:123:12",
      "    handler@data:text/javascript,PRIVATE_SOURCE_MARKER:2:2",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assertEquals(result.includes("at handler"), false);
      assertEquals(
        result.includes("PRIVATE_SOURCE_MARKER"),
        false,
        "a data: module used as a stack location must not leak its embedded source",
      );
      assertEquals(
        result.includes("node:internal"),
        false,
        "a builtin module location must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts a callable label that is itself an absolute path in development", async () => {
    // V8 folds a path-shaped method key into the callable label: Node 24 emits
    // `at /home/alice/private ([eval]:1:1)` and Deno emits the `Object.`-prefixed
    // form for the same method, so the retained label must be checked too.
    const error = new Error("unknown error path_shaped_label_dev");
    error.stack = [
      "Error: unknown error path_shaped_label_dev",
      "    at /home/alice/private ([eval]:1:44)",
      "    at Object./home/alice/secret (file:///app/a.ts:2:2)",
      "    at C:\\Users\\alice\\keys (file:///app/b.ts:3:3)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assert(
        result.includes("at <anonymous>"),
        "a path-shaped callable label is replaced rather than retained",
      );
      assertEquals(
        result.includes("/home/alice"),
        false,
        "a POSIX path used as a callable label must not reach user-facing output",
      );
      assertEquals(
        result.includes("secret"),
        false,
        "a path folded behind an Object. prefix must not reach user-facing output",
      );
      assertEquals(
        result.includes("C:\\Users"),
        false,
        "a drive path used as a callable label must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("withholds a filename-shaped callable label in development", async () => {
    // Node 24 emits `at 123-app.ts:3:3 ([stdin]:1:35)` for a method literally
    // named like a location; the retained label gets the same source-location
    // validation as location text while genuine labels survive.
    const error = new Error("unknown error filename_shaped_label_dev");
    error.stack = [
      "Error: unknown error filename_shaped_label_dev",
      "    at 123-app.ts:3:3 ([stdin]:1:35)",
      "    at handler (file:///app/a.ts:2:2)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assertEquals(result.includes("at handler"), false);
      assertEquals(
        result.includes("123-app.ts"),
        false,
        "a filename-shaped callable label must not reach user-facing output",
      );
      assertEquals(
        result.includes("[stdin]"),
        false,
        "the parenthesized location must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts relative source-file stack locations in development", async () => {
    // A source map or a custom formatter can emit a project-relative location
    // that carries neither a URI scheme nor a leading separator; the path is
    // still internal implementation detail and must not reach the user.
    const error = new Error("unknown error relative_location_dev");
    error.stack = [
      "Error: unknown error relative_location_dev",
      "    at src/private/app.ts:1:1",
      "    at async src/private/worker.ts:2:2",
      "    handler@src/private/lib.ts:3:3",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assert(
        result.includes("at <anonymous>"),
        "a bare relative-path frame keeps no source location",
      );
      assertEquals(result.includes("at handler"), false);
      assertEquals(
        result.includes("src/private"),
        false,
        "relative source paths must not reach user-facing output",
      );
      assertEquals(
        result.includes("app.ts"),
        false,
        "relative source file names must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts single-segment relative source locations in development", async () => {
    const error = new Error("unknown error single_segment_location_dev");
    error.stack = [
      "Error: unknown error single_segment_location_dev",
      "    at app.ts:1:1",
      "    handler@app.ts:2:2",
      "    at 123-app.ts:3:3",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assertEquals(result.includes("at handler"), false);
      assertEquals(
        result.includes("app.ts"),
        false,
        "single-segment source file names must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("redacts coordinate-less source filenames in development", async () => {
    // A custom `Error.prepareStackTrace` can drop line and column data, leaving
    // a frame that is nothing but a source filename. It carries no separator,
    // scheme, `@`, or `:line` suffix, so the filename itself has to be read as
    // a location rather than as a callable label.
    const error = new Error("unknown error bare_filename_location_dev");
    error.stack = [
      "Error: unknown error bare_filename_location_dev",
      "    at private.ts",
      "    at handler (private-worker.mjs)",
      "    at renderPage",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const result = formatUserError(error);

      assert(result.includes("Stack trace:"), "unknown errors render a stack trace section");
      assert(
        result.includes("at <anonymous>"),
        "a coordinate-less filename frame keeps no source location",
      );
      assertEquals(result.includes("at handler"), false);
      assertEquals(result.includes("at renderPage"), false);
      assertEquals(
        result.includes("private.ts"),
        false,
        "a coordinate-less source filename must not reach user-facing output",
      );
      assertEquals(
        result.includes("private-worker.mjs"),
        false,
        "a parenthesized coordinate-less filename must not reach user-facing output",
      );
      return Promise.resolve();
    });
  });

  it("validates V8 property aliases independently of callable labels", async () => {
    const error = new Error("unknown error callable_alias_frames");
    error.stack = [
      "Error: unknown error callable_alias_frames",
      "    at Object.publicAlias [as private-control.example] (/srv/app.ts:1:1)",
      "    at Object.publicAlias [as async prefixed-private.example] (/srv/app.ts:2:1)",
      "    at Object.publicAlias [as visibleAlias] (/srv/app.ts:3:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const output = formatUserError(error);

      assertEquals(output.includes("private-control.example"), false);
      assertEquals(output.includes("prefixed-private.example"), false);
      assertEquals(output.includes("Object.publicAlias [as visibleAlias]"), false);
      assert(output.includes("at <anonymous>"));
      return Promise.resolve();
    });
  });

  it("rejects hostname-shaped V8 aliases with accessor-like prefixes", async () => {
    const error = new Error("unknown error accessor_alias_frame");
    error.stack = [
      "Error: unknown error accessor_alias_frame",
      "    at Object.publicAlias [as get private-control.example] (/srv/app.ts:1:1)",
      "    at Object.publicAlias [as get private-control.example visibleAlias] (/srv/app.ts:2:1)",
      "    at Object.publicAlias [as visibleAlias] (/srv/app.ts:3:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const output = formatUserError(error);

      assertEquals(output.includes("private-control.example"), false);
      assertEquals(output.includes("Object.publicAlias [as visibleAlias]"), false);
      assertEquals(output.includes("get private-control.example visibleAlias"), false);
      return Promise.resolve();
    });
  });

  it("rejects hostname-shaped tokens in direct callable labels", async () => {
    const error = new Error("unknown error direct_callable_token_frames");
    error.stack = [
      "Error: unknown error direct_callable_token_frames",
      "    at get private-control.example (/srv/app.ts:1:1)",
      "    at get private-control.example visibleValue (/srv/app.ts:2:1)",
      "    at get Object.publicValue (/srv/app.ts:3:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const output = formatUserError(error);

      assertEquals(output.includes("private-control.example"), false);
      assertEquals(output.includes("get Object.publicValue"), false);
      return Promise.resolve();
    });
  });

  it("does not call live RegExp prototype hooks while sanitizing stacks", async () => {
    const error = new Error("unknown error mutated_regexp_test");
    error.stack = [
      "Error: unknown error mutated_regexp_test",
      "    at publicHandler (/srv/app.ts:1:1)",
    ].join("\n");

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      const originalTest = RegExp.prototype.test;
      let output: string;
      try {
        RegExp.prototype.test = () => {
          throw new Error("live RegExp.test must not run");
        };
        output = formatUserError(error);
      } finally {
        RegExp.prototype.test = originalTest;
      }

      assert(output.includes("at <anonymous>"));
      assertEquals(output.includes("publicHandler"), false);
      assertEquals(output.includes("live RegExp.test"), false);
      return Promise.resolve();
    });
  });

  it("does not call live String prototype hooks across the public formatting path", async () => {
    const unknown = new Error("unknown error mutated_string_hooks");
    unknown.stack = [
      "Error: unknown error mutated_string_hooks",
      "    at publicHandler (/srv/app.ts:1:1)",
      "    at 2001:db8::dead (file:///app/a.ts:2:2)",
    ].join("\n");
    const known = new Error("veryfront.config.ts not found");

    await withEnv({ VERYFRONT_ENV: " development " }, () => {
      const poisonedMethods = [
        "endsWith",
        "includes",
        "indexOf",
        "lastIndexOf",
        "slice",
        "split",
        "startsWith",
        "toLowerCase",
        "trim",
      ] as const;
      const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
      let unknownOutput: string;
      let knownOutput: string;

      try {
        for (const method of poisonedMethods) {
          originalDescriptors.set(
            method,
            Object.getOwnPropertyDescriptor(String.prototype, method),
          );
          Object.defineProperty(String.prototype, method, {
            configurable: true,
            value() {
              throw new Error(`live String.${method} must not run`);
            },
            writable: true,
          });
        }

        unknownOutput = formatUserError(unknown);
        knownOutput = formatUserError(known);
      } finally {
        for (const method of poisonedMethods) {
          const descriptor = originalDescriptors.get(method);
          if (descriptor) {
            Object.defineProperty(String.prototype, method, descriptor);
          } else {
            delete String.prototype[method];
          }
        }
      }

      assert(unknownOutput.includes("at <anonymous>"));
      assertEquals(unknownOutput.includes("publicHandler"), false);
      assertEquals(unknownOutput.includes("2001:db8::dead"), false);
      assert(knownOutput.includes("How to fix:"));
      assert(knownOutput.includes("veryfront.config.ts"));
      assertEquals(unknownOutput.includes("live String."), false);
      assertEquals(knownOutput.includes("live String."), false);
      return Promise.resolve();
    });
  });

  it("leaks no stack frames in production output", async () => {
    const error = unknownError();

    await withEnv({ VERYFRONT_ENV: "production" }, () => {
      const production = formatUserError(error);

      assertEquals(
        production.includes("Stack trace:"),
        false,
        "production output must not leak stack frames",
      );
      for (
        const [name, file] of [
          ["alpha", "a"],
          ["beta", "b"],
          ["gamma", "c"],
          ["delta", "d"],
        ] as const
      ) {
        assertEquals(
          production.includes(`file:///app/${file}.ts`),
          false,
          `production output leaks no ${name} frame path`,
        );
        assertEquals(
          production.includes(`at ${name} `),
          false,
          `production output leaks no ${name} frame name`,
        );
      }
      return Promise.resolve();
    });

    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      assertEquals(
        formatUserError(error).includes("Stack trace:"),
        true,
        "the same error still renders its stack outside production",
      );
      return Promise.resolve();
    });
  });
});
