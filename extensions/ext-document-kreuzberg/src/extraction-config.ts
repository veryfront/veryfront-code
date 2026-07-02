const PDF_TEXT_ONLY_EXTRACTION_CONFIG = {
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

export function extractionConfigForMimeType(mimeType: string): Record<string, unknown> | undefined {
  return normalizeMimeType(mimeType) === "application/pdf"
    ? PDF_TEXT_ONLY_EXTRACTION_CONFIG
    : undefined;
}
