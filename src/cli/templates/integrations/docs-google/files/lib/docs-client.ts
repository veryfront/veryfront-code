/**
 * Google Docs API Client
 *
 * Provides a type-safe interface to Google Docs API operations.
 */

import { tokenStore as _tokenStore } from "./token-store.ts";
import { getValidToken } from "./oauth.ts";

// Helper for Cross-Platform environment access
function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") {
    // @ts-ignore - Deno global
    return Deno.env.get(key);
  } // @ts-ignore - process global
  else if (typeof process !== "undefined" && process.env) {
    // @ts-ignore - process global
    return process.env[key];
  }
  return undefined;
}

const DOCS_API_BASE = "https://docs.googleapis.com/v1";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export interface Document {
  documentId: string;
  title: string;
  body: {
    content: StructuralElement[];
  };
  revisionId: string;
  suggestionsViewMode: string;
  documentStyle: DocumentStyle;
}

export interface StructuralElement {
  startIndex: number;
  endIndex: number;
  paragraph?: Paragraph;
  table?: Table;
  sectionBreak?: SectionBreak;
}

export interface Paragraph {
  elements: ParagraphElement[];
  paragraphStyle?: ParagraphStyle;
  bullet?: Bullet;
}

export interface ParagraphElement {
  startIndex: number;
  endIndex: number;
  textRun?: TextRun;
  inlineObjectElement?: InlineObjectElement;
}

export interface TextRun {
  content: string;
  textStyle?: TextStyle;
}

export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  fontSize?: Dimension;
  foregroundColor?: Color;
  backgroundColor?: Color;
  fontFamily?: string;
  link?: Link;
}

export interface Link {
  url?: string;
  bookmarkId?: string;
  headingId?: string;
}

export interface Dimension {
  magnitude: number;
  unit: string;
}

export interface Color {
  rgbColor?: RgbColor;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface ParagraphStyle {
  headingId?: string;
  namedStyleType?: string;
  alignment?: string;
  lineSpacing?: number;
  direction?: string;
  spacingMode?: string;
  spaceAbove?: Dimension;
  spaceBelow?: Dimension;
  indentFirstLine?: Dimension;
  indentStart?: Dimension;
  indentEnd?: Dimension;
}

export interface Bullet {
  listId: string;
  nestingLevel?: number;
  textStyle?: TextStyle;
}

export interface Table {
  rows: number;
  columns: number;
  tableRows: TableRow[];
  tableStyle?: TableStyle;
}

export interface TableRow {
  startIndex: number;
  endIndex: number;
  tableCells: TableCell[];
}

export interface TableCell {
  startIndex: number;
  endIndex: number;
  content: StructuralElement[];
  tableCellStyle?: TableCellStyle;
}

export interface TableCellStyle {
  rowSpan?: number;
  columnSpan?: number;
  backgroundColor?: Color;
  borderLeft?: TableCellBorder;
  borderRight?: TableCellBorder;
  borderTop?: TableCellBorder;
  borderBottom?: TableCellBorder;
  paddingLeft?: Dimension;
  paddingRight?: Dimension;
  paddingTop?: Dimension;
  paddingBottom?: Dimension;
}

export interface TableCellBorder {
  color?: Color;
  width?: Dimension;
  dashStyle?: string;
}

export interface TableStyle {
  tableColumnProperties?: TableColumnProperties[];
}

export interface TableColumnProperties {
  width?: Dimension;
  widthType?: string;
}

export interface SectionBreak {
  sectionStyle?: SectionStyle;
}

export interface SectionStyle {
  columnSeparatorStyle?: string;
  contentDirection?: string;
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  pageNumberStart?: number;
}

export interface DocumentStyle {
  background?: Background;
  pageNumberStart?: number;
  marginTop?: Dimension;
  marginBottom?: Dimension;
  marginRight?: Dimension;
  marginLeft?: Dimension;
  pageSize?: Size;
  marginHeader?: Dimension;
  marginFooter?: Dimension;
  useFirstPageHeaderFooter?: boolean;
}

export interface Background {
  color?: Color;
}

export interface Size {
  height?: Dimension;
  width?: Dimension;
}

export interface InlineObjectElement {
  inlineObjectId: string;
  textStyle?: TextStyle;
}

export interface DocumentFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
  iconLink?: string;
  thumbnailLink?: string;
}

export interface CreateDocumentOptions {
  title: string;
}

export interface BatchUpdateRequest {
  requests: Request[];
}

export interface Request {
  insertText?: InsertTextRequest;
  deleteContentRange?: DeleteContentRangeRequest;
  replaceAllText?: ReplaceAllTextRequest;
  updateTextStyle?: UpdateTextStyleRequest;
  updateParagraphStyle?: UpdateParagraphStyleRequest;
  insertPageBreak?: InsertPageBreakRequest;
  insertTable?: InsertTableRequest;
  deleteTableRow?: DeleteTableRowRequest;
  deleteTableColumn?: DeleteTableColumnRequest;
  createParagraphBullets?: CreateParagraphBulletsRequest;
  deleteParagraphBullets?: DeleteParagraphBulletsRequest;
}

export interface InsertTextRequest {
  text: string;
  location: Location;
}

export interface DeleteContentRangeRequest {
  range: Range;
}

export interface ReplaceAllTextRequest {
  containsText: ContainsText;
  replaceText: string;
}

export interface UpdateTextStyleRequest {
  range: Range;
  textStyle: TextStyle;
  fields: string;
}

export interface UpdateParagraphStyleRequest {
  range: Range;
  paragraphStyle: ParagraphStyle;
  fields: string;
}

export interface InsertPageBreakRequest {
  location: Location;
}

export interface InsertTableRequest {
  rows: number;
  columns: number;
  location: Location;
}

export interface DeleteTableRowRequest {
  tableCellLocation: TableCellLocation;
}

export interface DeleteTableColumnRequest {
  tableCellLocation: TableCellLocation;
}

export interface CreateParagraphBulletsRequest {
  range: Range;
  bulletPreset: string;
}

export interface DeleteParagraphBulletsRequest {
  range: Range;
}

export interface Location {
  index: number;
  segmentId?: string;
}

export interface Range {
  startIndex: number;
  endIndex: number;
  segmentId?: string;
}

export interface ContainsText {
  text: string;
  matchCase: boolean;
}

export interface TableCellLocation {
  tableStartLocation: Location;
  rowIndex: number;
  columnIndex: number;
}

export interface BatchUpdateResponse {
  documentId: string;
  replies: Reply[];
  writeControl?: WriteControl;
}

export interface Reply {
  [key: string]: unknown;
}

export interface WriteControl {
  requiredRevisionId: string;
  targetRevisionId: string;
}

/**
 * Google Docs OAuth provider configuration
 */
export const docsOAuthProvider = {
  name: "docs-google",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") || "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") || "",
  scopes: [
    "https://www.googleapis.com/auth/documents.readonly",
    "https://www.googleapis.com/auth/documents",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  callbackPath: "/api/auth/docs-google/callback",
};

/**
 * Create a Docs client for a specific user
 */
export function createDocsClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(docsOAuthProvider, userId, "docs-google");
    if (!token) {
      throw new Error("Google Docs not connected. Please connect your Google account first.");
    }
    return token;
  }

  async function docsApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${DOCS_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Docs API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async function driveApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${DRIVE_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Drive API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  return {
    /**
     * List documents from Google Drive
     */
    async listDocuments(options: {
      maxResults?: number;
      orderBy?: "createdTime" | "modifiedTime" | "name";
    } = {}): Promise<DocumentFile[]> {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.document' and trashed=false",
        fields: "files(id,name,mimeType,createdTime,modifiedTime,webViewLink,iconLink,thumbnailLink)",
        pageSize: String(options.maxResults || 20),
        orderBy: `${options.orderBy || "modifiedTime"} desc`,
      });

      const result = await driveApiRequest<{ files: DocumentFile[] }>(
        `/files?${params.toString()}`,
      );

      return result.files || [];
    },

    /**
     * Get document content and metadata
     */
    getDocument(documentId: string): Promise<Document> {
      return docsApiRequest<Document>(`/documents/${documentId}`);
    },

    /**
     * Create a new document
     */
    createDocument(options: CreateDocumentOptions): Promise<Document> {
      return docsApiRequest<Document>("/documents", {
        method: "POST",
        body: JSON.stringify({
          title: options.title,
        }),
      });
    },

    /**
     * Update document using batch requests
     */
    async updateDocument(
      documentId: string,
      requests: Request[],
    ): Promise<BatchUpdateResponse> {
      return docsApiRequest<BatchUpdateResponse>(
        `/documents/${documentId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({ requests }),
        },
      );
    },

    /**
     * Insert text at a specific location
     */
    async insertText(
      documentId: string,
      text: string,
      index: number,
    ): Promise<BatchUpdateResponse> {
      return this.updateDocument(documentId, [
        {
          insertText: {
            text,
            location: { index },
          },
        },
      ]);
    },

    /**
     * Delete content in a range
     */
    async deleteContent(
      documentId: string,
      startIndex: number,
      endIndex: number,
    ): Promise<BatchUpdateResponse> {
      return this.updateDocument(documentId, [
        {
          deleteContentRange: {
            range: { startIndex, endIndex },
          },
        },
      ]);
    },

    /**
     * Replace all occurrences of text
     */
    async replaceAllText(
      documentId: string,
      searchText: string,
      replaceText: string,
      matchCase = false,
    ): Promise<BatchUpdateResponse> {
      return this.updateDocument(documentId, [
        {
          replaceAllText: {
            containsText: {
              text: searchText,
              matchCase,
            },
            replaceText,
          },
        },
      ]);
    },

    /**
     * Search documents by query
     */
    async searchDocuments(query: string, maxResults = 20): Promise<DocumentFile[]> {
      const params = new URLSearchParams({
        q: `mimeType='application/vnd.google-apps.document' and trashed=false and fullText contains '${query}'`,
        fields: "files(id,name,mimeType,createdTime,modifiedTime,webViewLink,iconLink,thumbnailLink)",
        pageSize: String(maxResults),
        orderBy: "modifiedTime desc",
      });

      const result = await driveApiRequest<{ files: DocumentFile[] }>(
        `/files?${params.toString()}`,
      );

      return result.files || [];
    },

    /**
     * Extract plain text from document body
     */
    extractText(document: Document): string {
      const textParts: string[] = [];

      function processElement(element: StructuralElement) {
        if (element.paragraph) {
          element.paragraph.elements.forEach((el) => {
            if (el.textRun) {
              textParts.push(el.textRun.content);
            }
          });
        } else if (element.table) {
          element.table.tableRows.forEach((row) => {
            row.tableCells.forEach((cell) => {
              cell.content.forEach(processElement);
            });
          });
        }
      }

      document.body.content.forEach(processElement);
      return textParts.join("");
    },

    /**
     * Create a document with initial content
     */
    async createDocumentWithContent(
      title: string,
      content: string,
    ): Promise<Document> {
      // Create the document
      const doc = await this.createDocument({ title });

      // Insert content at index 1 (after the title)
      await this.insertText(doc.documentId, content, 1);

      // Fetch and return the updated document
      return this.getDocument(doc.documentId);
    },
  };
}

export type DocsClient = ReturnType<typeof createDocsClient>;
