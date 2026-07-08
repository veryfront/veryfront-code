/**
 * ext-document-kreuzberg extension tests.
 *
 * Exercises the extension factory lifecycle without loading kreuzberg.
 *
 * @module extensions/ext-document-kreuzberg/test
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import JSZip from "jszip";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import type { DocumentExtractionProgressEvent } from "veryfront/extensions/compat";
import factory, {
  EXTRACTION_TIMEOUT_MS,
  KreuzbergDocumentExtractor,
  type KreuzbergDocumentExtractorDeps,
} from "./index.ts";
import { extractionConfigForMimeType } from "./extraction-config.ts";

function silentLogger(): ExtensionLogger {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function buildCtx(
  provides: Map<string, unknown>,
  logger: ExtensionLogger = silentLogger(),
): ExtensionContext {
  return {
    get: <T>(name: string) => provides.get(name) as T | undefined,
    require: <T>(name: string) => {
      const impl = provides.get(name);
      if (impl === undefined) throw new Error(`missing ${name}`);
      return impl as T;
    },
    provide: <T>(name: string, impl: T) => {
      provides.set(name, impl);
    },
    config: {},
    logger,
  };
}

const PPTX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPT_MIME_TYPE = "application/vnd.ms-powerpoint";

async function buildPptxWithPresentationOrder(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId2"/>
        <p:sldId id="257" r:id="rId1"/>
      </p:sldIdLst>
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Filename first</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld>
        <p:spTree>
          <p:sp><p:txBody><a:p><a:r><a:t>Presentation first</a:t></a:r></a:p></p:txBody></p:sp>
          <p:pic>
            <p:nvPicPr><p:cNvPr id="4" name="Picture 1"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
            <p:blipFill><a:blip r:embed="rIdImage1"/></p:blipFill>
            <p:spPr/>
          </p:pic>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildPptxWithMalformedSlide(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst>
        <p:sldId id="256" r:id="rId1"/>
        <p:sldId id="257" r:id="rId2"/>
      </p:sldIdLst>
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Valid slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/slide2.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Recoverable corrupt slide</a:t></a:r></a:p></p:txBody></p:sp>
    </p:sld`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildPptxWithoutSlides(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`,
  );
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildPptxWithTitleBodyAndTextbox(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Real Slide Title</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="3" name="Content Placeholder 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Body paragraph from placeholder</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="4" name="TextBox 3"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Freeform textbox content</a:t></a:r></a:p></p:txBody>
          </p:sp>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function buildPptxWithTitleAndTable(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst>
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <p:cSld>
        <p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:txBody><a:p><a:r><a:t>Quarterly Results</a:t></a:r></a:p></p:txBody>
          </p:sp>
          <p:graphicFrame>
            <p:nvGraphicFramePr><p:cNvPr id="3" name="Table 2"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
            <a:graphic>
              <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
                <a:tbl>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>Region</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>Revenue</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                  <a:tr>
                    <a:tc><a:txBody><a:p><a:r><a:t>EMEA</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:p><a:r><a:t>4.2M</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                </a:tbl>
              </a:graphicData>
            </a:graphic>
          </p:graphicFrame>
        </p:spTree>
      </p:cSld>
    </p:sld>`,
  );

  const bytes = await zip.generateAsync({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

type NativeProgressWorkerResponse =
  | { type: "done"; content: string }
  | { type: "error"; error: string }
  | { type: "progress"; event: DocumentExtractionProgressEvent };

async function extractPptxWithProgressWorker(buffer: ArrayBuffer): Promise<{
  content: string;
  events: DocumentExtractionProgressEvent[];
}> {
  const worker = new Worker(new URL("./native-progress-extraction-worker.ts", import.meta.url), {
    type: "module",
  });
  const events: DocumentExtractionProgressEvent[] = [];

  try {
    return await new Promise<{ content: string; events: DocumentExtractionProgressEvent[] }>(
      (resolve, reject) => {
        worker.onmessage = (event: MessageEvent<NativeProgressWorkerResponse>) => {
          const message = event.data;
          if (message.type === "progress") {
            events.push(message.event);
            return;
          }
          worker.terminate();
          if (message.type === "error") {
            reject(new Error(message.error));
            return;
          }
          resolve({ content: message.content, events });
        };
        worker.onerror = (event) => {
          worker.terminate();
          reject(new Error(event.message));
        };
        worker.postMessage({ buffer, mimeType: PPTX_MIME_TYPE }, [buffer]);
      },
    );
  } finally {
    worker.terminate();
  }
}

describe("ext-document-kreuzberg extension", () => {
  it("declares the expected name and contract", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-document-kreuzberg");
    assertEquals(ext.contracts?.provides, ["DocumentExtractor"]);
  });

  it("registers DocumentExtractor on setup", () => {
    const ext = factory();
    const provides = new Map<string, unknown>();
    const ctx = buildCtx(provides);

    ext.setup!(ctx as never);

    const extractor = provides.get("DocumentExtractor") as KreuzbergDocumentExtractor;
    assertExists(extractor);
    assertEquals(typeof extractor.importKreuzberg, "function");
    assertEquals(typeof extractor.extractInWorker, "function");
  });

  it("uses a ten-minute timeout for fallback worker extraction", () => {
    assertEquals(EXTRACTION_TIMEOUT_MS, 10 * 60_000);
  });

  it("requests markdown extraction for rich non-PDF document types and plain text for PDFs", () => {
    assertEquals(extractionConfigForMimeType(PPT_MIME_TYPE), { outputFormat: "markdown" });
    assertEquals(extractionConfigForMimeType(PPTX_MIME_TYPE), { outputFormat: "markdown" });
    assertEquals(extractionConfigForMimeType("application/pdf"), {
      images: { extractImages: false },
      pdfOptions: {
        extractImages: false,
        extractMetadata: false,
        extractAnnotations: false,
        hierarchy: { enabled: false, includeBbox: false },
      },
    });
  });

  it("uses native extraction for PDFs in Deno before falling back to the WASM worker", async () => {
    const calls: Array<{ bytes: string; mimeType: string; config: unknown }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      loadNativeKreuzberg: async () => ({
        extractBytes: async (data, mimeType, config) => {
          calls.push({ bytes: new TextDecoder().decode(data), mimeType, config });
          return { content: "native pdf text" };
        },
      }),
      extractInWorkerDeno: async () => {
        throw new Error("worker should not be used for PDFs when native extraction is available");
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf");

    assertEquals(content, "native pdf text");
    assertEquals(calls, [{
      bytes: "%PDF-1.4\n",
      mimeType: "application/pdf",
      config: {
        images: { extractImages: false },
        pdfOptions: {
          extractImages: false,
          extractMetadata: false,
          extractAnnotations: false,
          hierarchy: { enabled: false, includeBbox: false },
        },
      },
    }]);
  });

  it("uses progress-capable native extraction for PDFs in Deno when progress is requested", async () => {
    const progressEvents: DocumentExtractionProgressEvent[] = [];
    const calls: Array<{ bytes: string; mimeType: string }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      extractWithNativeProgressDeno: async (buffer, mimeType, options) => {
        calls.push({ bytes: new TextDecoder().decode(buffer), mimeType });
        options.onProgress?.({ unit: "page", current: 1, total: 1, characters: 15 });
        return "progress pdf text";
      },
      loadNativeKreuzberg: async () => ({
        extractBytes: async () => ({ content: "opaque pdf text" }),
      }),
      extractInWorkerDeno: async () => {
        throw new Error("worker should not be used for progress-capable PDFs");
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf", {
      onProgress: (event) => {
        progressEvents.push(event);
      },
    });

    assertEquals(content, "progress pdf text");
    assertEquals(calls, [{ bytes: "%PDF-1.4\n", mimeType: "application/pdf" }]);
    assertEquals(progressEvents, [{ unit: "page", current: 1, total: 1, characters: 15 }]);
  });

  it("uses progress-capable native extraction for PPTX in Deno when progress is requested", async () => {
    const progressEvents: DocumentExtractionProgressEvent[] = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      extractWithNativeProgressDeno: async (_buffer, _mimeType, options) => {
        options.onProgress?.({ unit: "slide", current: 1, total: 2, characters: 20 });
        options.onProgress?.({ unit: "slide", current: 2, total: 2, characters: 25 });
        return "progress pptx text";
      },
      extractInWorkerDeno: async () => "worker pptx text",
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("pptx bytes").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(
      buffer,
      PPTX_MIME_TYPE,
      {
        onProgress: (event) => {
          progressEvents.push(event);
        },
      },
    );

    assertEquals(content, "progress pptx text");
    assertEquals(progressEvents, [
      { unit: "slide", current: 1, total: 2, characters: 20 },
      { unit: "slide", current: 2, total: 2, characters: 25 },
    ]);
  });

  it("falls back to the previous PDF extraction path when progress extraction fails", async () => {
    const nativeCalls: Array<{ bytes: string; mimeType: string; config: unknown }> = [];
    const warnings: Array<{ message: string; details: unknown[] }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      logger: {
        warn: (message, ...details) => {
          warnings.push({ message, details });
        },
      },
      extractWithNativeProgressDeno: async () => {
        throw new Error("page split failed");
      },
      loadNativeKreuzberg: async () => ({
        extractBytes: async (data, mimeType, config) => {
          nativeCalls.push({ bytes: new TextDecoder().decode(data), mimeType, config });
          return { content: "native fallback pdf text" };
        },
      }),
      extractInWorkerDeno: async () => {
        throw new Error("worker should not be used when native fallback is available");
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf", {
      onProgress: () => {},
    });

    assertEquals(content, "native fallback pdf text");
    assertEquals(nativeCalls, [{
      bytes: "%PDF-1.4\n",
      mimeType: "application/pdf",
      config: {
        images: { extractImages: false },
        pdfOptions: {
          extractImages: false,
          extractMetadata: false,
          extractAnnotations: false,
          hierarchy: { enabled: false, includeBbox: false },
        },
      },
    }]);
    assertEquals(warnings, [{
      message:
        "[ext-document-kreuzberg] native progress extraction failed; falling back to opaque extraction",
      details: [{
        mimeType: "application/pdf",
        error: "page split failed",
      }],
    }]);
  });

  it("preserves PPTX presentation order when extracting slide progress", async () => {
    const buffer = await buildPptxWithPresentationOrder();

    const result = await extractPptxWithProgressWorker(buffer);

    assertStringIncludes(result.content, "# Presentation first\n\n# Filename first");
    assertEquals(result.content.includes("![image]()"), false);
    assertEquals(
      result.events.map((event) => ({
        unit: event.unit,
        current: event.current,
        total: event.total,
      })),
      [
        { unit: "slide", current: 1, total: 2 },
        { unit: "slide", current: 2, total: 2 },
      ],
    );
  });

  it("keeps PPTX slide progress when one slide cannot be parsed by Kreuzberg", async () => {
    const buffer = await buildPptxWithMalformedSlide();

    const result = await extractPptxWithProgressWorker(buffer);

    assertStringIncludes(result.content, "# Valid slide");
    assertStringIncludes(result.content, "Recoverable corrupt slide");
    assertEquals(
      result.events.map((event) => ({
        unit: event.unit,
        current: event.current,
        total: event.total,
      })),
      [
        { unit: "slide", current: 1, total: 2 },
        { unit: "slide", current: 2, total: 2 },
      ],
    );
  });

  it("uses whole-file progress for PPTX files with no slide entries", async () => {
    const buffer = await buildPptxWithoutSlides();

    const result = await extractPptxWithProgressWorker(buffer);

    assertEquals(typeof result.content, "string");
    assertEquals(result.events, [{ unit: "file", current: 1, total: 1, characters: 0 }]);
  });

  it("keeps PPTX body and textbox text out of top-level Markdown headings", async () => {
    const buffer = await buildPptxWithTitleBodyAndTextbox();

    const result = await extractPptxWithProgressWorker(buffer);

    assertStringIncludes(result.content, "# Real Slide Title");
    assertStringIncludes(result.content, "Body paragraph from placeholder");
    assertStringIncludes(result.content, "Freeform textbox content");
    assertEquals(result.content.includes("# Body paragraph from placeholder"), false);
    assertEquals(result.content.includes("# Freeform textbox content"), false);
    assertEquals(
      result.events.map((event) => ({
        unit: event.unit,
        current: event.current,
        total: event.total,
      })),
      [{ unit: "slide", current: 1, total: 1 }],
    );
  });

  it("keeps PPTX table text when normalizing slide headings", async () => {
    const buffer = await buildPptxWithTitleAndTable();

    const result = await extractPptxWithProgressWorker(buffer);

    assertStringIncludes(result.content, "# Quarterly Results");
    assertStringIncludes(result.content, "Region");
    assertStringIncludes(result.content, "Revenue");
    assertStringIncludes(result.content, "EMEA");
    assertStringIncludes(result.content, "4.2M");
    assertEquals(
      result.events.map((event) => ({
        unit: event.unit,
        current: event.current,
        total: event.total,
      })),
      [{ unit: "slide", current: 1, total: 1 }],
    );
  });

  it("falls back to the Deno worker when native PDF extraction is unavailable", async () => {
    const workerCalls: Array<{ bytes: string; mimeType: string }> = [];
    const deps: KreuzbergDocumentExtractorDeps = {
      isDenoRuntime: true,
      loadNativeKreuzberg: async () => {
        throw new Error("Cannot find native binding", {
          cause: new Error("Cannot find module '@kreuzberg/node-linux-x64'"),
        });
      },
      extractInWorkerDeno: async (buffer, mimeType) => {
        workerCalls.push({ bytes: new TextDecoder().decode(buffer), mimeType });
        return "worker pdf text";
      },
    };
    const extractor = new KreuzbergDocumentExtractor(deps);
    const buffer = new TextEncoder().encode("%PDF-1.4\n").buffer.slice(0) as ArrayBuffer;

    const content = await extractor.extractInWorker(buffer, "application/pdf");

    assertEquals(content, "worker pdf text");
    assertEquals(workerCalls, [{ bytes: "%PDF-1.4\n", mimeType: "application/pdf" }]);
  });
});
