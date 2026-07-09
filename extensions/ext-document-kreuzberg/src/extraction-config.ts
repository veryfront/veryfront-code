const MARKDOWN_EXTRACTION_CONFIG = {
  outputFormat: "markdown",
} as const;

const PDF_TEXT_EXTRACTION_CONFIG = {
  images: { extractImages: false },
  pdfOptions: {
    extractImages: false,
    extractMetadata: false,
    extractAnnotations: false,
    hierarchy: { enabled: false, includeBbox: false },
  },
} as const;

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

export function extractionConfigForMimeType(mimeType: string): Record<string, unknown> {
  return normalizeMimeType(mimeType) === "application/pdf"
    ? PDF_TEXT_EXTRACTION_CONFIG
    : MARKDOWN_EXTRACTION_CONFIG;
}
