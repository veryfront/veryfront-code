/**
 * Rejects attachment URLs that a model provider can never fetch.
 *
 * An attachment reaches the provider as a URL, not as bytes: the OpenAI-
 * compatible converter emits `{ type: "image_url", image_url: { url } }`
 * (`src/provider/runtime-loader.ts:213`) and the provider's own servers
 * dereference it. So the URL has to be reachable from the public internet,
 * and some URLs provably never are.
 *
 * The chat upload handler mints exactly such a URL by default. When the
 * configured storage backend returns no external URL of its own, `POST` falls
 * back to this app's own origin (`src/chat/upload-handler.ts:426`):
 *
 *     {"id":"blob_1","url":"http://localhost:3000/api/chat/upload?id=blob_1", ...}
 *
 * The upload succeeds, the composer sends that URL back as a `file` part, and
 * the provider resolves `localhost` to *itself*. What comes back is a bare 400
 * with no indication that an attachment was the problem — the turn dies and
 * nothing in the log names the file.
 *
 * Deciding this here, at the last point before the wire, is the only place with
 * the whole picture: the upload handler cannot know whether its origin is
 * publicly reachable, and the provider client sees a URL with no attachment
 * context left to name.
 *
 * Only hosts that are unreachable *by construction* are rejected — loopback,
 * link-local, and the RFC 1918 private ranges — plus schemes a provider cannot
 * dereference at all. A public hostname that merely happens to be firewalled is
 * not something this can detect, and guessing would break working setups.
 * `data:` URLs carry their own bytes and are always allowed.
 *
 * @module
 */

/** An attachment whose URL the provider could never have fetched. */
export class UnreachableAttachmentError extends Error {
  readonly filename: string;
  readonly attachmentUrl: string;
  readonly reason: string;

  constructor(options: {
    filename: string;
    attachmentUrl: string;
    reason: string;
  }) {
    super(
      `Attachment "${options.filename}" cannot be sent to the model: ${options.reason}. ` +
        `The provider fetches attachments from its own network, so the URL must be reachable ` +
        `from the public internet. Configure chat upload storage that serves a public URL, ` +
        `or run behind a publicly reachable origin.`,
    );
    this.name = "UnreachableAttachmentError";
    this.filename = options.filename;
    this.attachmentUrl = options.attachmentUrl;
    this.reason = options.reason;
  }
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]", "0.0.0.0"]);
const LOCAL_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

/** Dotted-quad host, or undefined when `hostname` is not an IPv4 literal. */
function readIPv4Octets(hostname: string): number[] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4) return undefined;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    octets.push(octet);
  }
  return octets;
}

/** Reason this hostname is unreachable from a provider's network, if it is. */
function describeUnreachableHostname(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(host)) {
    return `"${hostname}" is a loopback address that resolves to the provider's own machine`;
  }
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return `"${hostname}" is a local-network name that does not resolve on the public internet`;
  }

  const octets = readIPv4Octets(host);
  if (!octets) return undefined;
  const [first, second] = octets as [number, number, number, number];
  if (first === 127) {
    return `"${hostname}" is a loopback address that resolves to the provider's own machine`;
  }
  if (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  ) {
    return `"${hostname}" is a private-network address that is not routable from the public internet`;
  }
  return undefined;
}

/**
 * Why a provider could never fetch `url`, or `undefined` when it might.
 *
 * Errs towards allowing: an unparseable or unknown-shaped URL is left alone so
 * the provider stays the authority on what it accepts.
 */
export function describeUnreachableAttachmentUrl(
  url: string,
): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `"${url}" is not an absolute URL`;
  }

  // `data:` carries the bytes inline; nothing is fetched.
  if (parsed.protocol === "data:") return undefined;

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `"${parsed.protocol}" URLs exist only inside this process and cannot be fetched by the provider`;
  }

  return describeUnreachableHostname(parsed.hostname);
}

/**
 * Throw if `url` is one no provider can fetch, naming the attachment.
 *
 * Replaces the provider's opaque 400 with a message that says which file and
 * why, at the point where both are still known.
 */
export function assertProviderReachableAttachment(options: {
  url: string;
  filename: string | undefined;
  mediaType: string;
}): void {
  const reason = describeUnreachableAttachmentUrl(options.url);
  if (reason === undefined) return;

  throw new UnreachableAttachmentError({
    filename: options.filename ?? options.mediaType,
    attachmentUrl: options.url,
    reason,
  });
}
