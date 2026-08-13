import { assertEquals, assertStringIncludes, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertProviderReachableAttachment,
  describeUnreachableAttachmentUrl,
  UnreachableAttachmentError,
} from "./attachment-reachability.ts";

describe("attachment reachability", () => {
  describe("describeUnreachableAttachmentUrl", () => {
    it("rejects the loopback URL the chat upload handler mints by default", () => {
      const reason = describeUnreachableAttachmentUrl(
        "http://localhost:3000/api/chat/upload?id=blob_1",
      );
      assertStringIncludes(reason ?? "", "loopback");
    });

    it("rejects loopback literals", () => {
      for (const host of ["127.0.0.1", "127.1.2.3", "[::1]", "0.0.0.0"]) {
        const reason = describeUnreachableAttachmentUrl(`http://${host}/upload?id=1`);
        assertStringIncludes(reason ?? "", "loopback", host);
      }
    });

    it("rejects private and link-local addresses", () => {
      for (const host of ["10.0.0.5", "172.16.0.9", "172.31.255.1", "192.168.1.4", "169.254.1.1"]) {
        const reason = describeUnreachableAttachmentUrl(`http://${host}/upload?id=1`);
        assertStringIncludes(reason ?? "", "private-network", host);
      }
    });

    it("rejects local-network names that do not resolve publicly", () => {
      for (const host of ["app.localhost", "nas.local", "svc.internal", "router.home.arpa"]) {
        const reason = describeUnreachableAttachmentUrl(`http://${host}/upload?id=1`);
        assertStringIncludes(reason ?? "", "local-network", host);
      }
    });

    it("rejects schemes the provider cannot dereference at all", () => {
      const reason = describeUnreachableAttachmentUrl("blob:https://app.example.com/9f2c");
      assertStringIncludes(reason ?? "", "cannot be fetched");
    });

    it("allows data URLs, which carry their own bytes", () => {
      assertEquals(
        describeUnreachableAttachmentUrl("data:image/png;base64,iVBORw0KGgo="),
        undefined,
      );
    });

    it("allows public URLs, including ones that only look private", () => {
      for (
        const url of [
          "https://signed.example.com/invoice.pdf",
          "https://cdn.example.com/a.png?sig=1",
          "http://172.32.0.1/a.png",
          "http://11.0.0.1/a.png",
          "http://192.169.1.1/a.png",
          "https://localhost.example.com/a.png",
        ]
      ) {
        assertEquals(describeUnreachableAttachmentUrl(url), undefined, url);
      }
    });

    it("rejects a relative URL, which the provider cannot resolve", () => {
      assertStringIncludes(
        describeUnreachableAttachmentUrl("/api/chat/upload?id=blob_1") ?? "",
        "not an absolute URL",
      );
    });
  });

  describe("assertProviderReachableAttachment", () => {
    it("names the file and the reason", () => {
      const error = assertThrows(
        () =>
          assertProviderReachableAttachment({
            url: "http://localhost:3000/api/chat/upload?id=blob_1",
            filename: "screenshot.png",
            mediaType: "image/png",
          }),
        UnreachableAttachmentError,
      );

      assertEquals(error.filename, "screenshot.png");
      assertEquals(error.attachmentUrl, "http://localhost:3000/api/chat/upload?id=blob_1");
      assertStringIncludes(error.message, "screenshot.png");
      assertStringIncludes(error.message, "localhost");
    });

    it("falls back to the media type when the attachment has no filename", () => {
      const error = assertThrows(
        () =>
          assertProviderReachableAttachment({
            url: "http://127.0.0.1:3000/api/chat/upload?id=blob_1",
            filename: undefined,
            mediaType: "image/png",
          }),
        UnreachableAttachmentError,
      );
      assertStringIncludes(error.message, "image/png");
    });

    it("keeps its class name, which the log prints as err=", () => {
      const error = new UnreachableAttachmentError({
        filename: "a.png",
        attachmentUrl: "http://localhost/a.png",
        reason: "loopback",
      });
      assertEquals(error.name, "UnreachableAttachmentError");
    });

    it("passes a reachable attachment through", () => {
      assertProviderReachableAttachment({
        url: "https://signed.example.com/invoice.pdf",
        filename: "invoice.pdf",
        mediaType: "application/pdf",
      });
    });
  });
});
