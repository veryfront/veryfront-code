/**
 * Google Sheets API Client
 *
 * Provides a type-safe interface to Google Sheets API operations.
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

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";

export interface Spreadsheet {
  spreadsheetId: string;
  properties: {
    title: string;
    locale: string;
    autoRecalc: string;
    timeZone: string;
  };
  sheets: Sheet[];
  spreadsheetUrl: string;
}

export interface Sheet {
  properties: {
    sheetId: number;
    title: string;
    index: number;
    sheetType: "GRID" | "OBJECT";
    gridProperties?: {
      rowCount: number;
      columnCount: number;
    };
  };
}

export interface SpreadsheetFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  modifiedTime: string;
  webViewLink: string;
}

export interface CellData {
  values: unknown[][];
  range: string;
}

export interface CreateSpreadsheetOptions {
  title: string;
  sheets?: Array<{
    title: string;
    rowCount?: number;
    columnCount?: number;
  }>;
}

export interface WriteRangeOptions {
  spreadsheetId: string;
  range: string;
  values: unknown[][];
  valueInputOption?: "RAW" | "USER_ENTERED";
}

/**
 * Google Sheets OAuth provider configuration
 */
export const sheetsOAuthProvider = {
  name: "sheets",
  authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: getEnv("GOOGLE_CLIENT_ID") || "",
  clientSecret: getEnv("GOOGLE_CLIENT_SECRET") || "",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  callbackPath: "/api/auth/sheets/callback",
};

/**
 * Create a Sheets client for a specific user
 */
export function createSheetsClient(userId: string) {
  async function getAccessToken(): Promise<string> {
    const token = await getValidToken(sheetsOAuthProvider, userId, "sheets");
    if (!token) {
      throw new Error("Google Sheets not connected. Please connect your Google account first.");
    }
    return token;
  }

  async function sheetsApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const accessToken = await getAccessToken();

    const response = await fetch(`${SHEETS_API_BASE}${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Sheets API error: ${response.status} - ${error}`);
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
     * List spreadsheets from Google Drive
     */
    async listSpreadsheets(options: {
      maxResults?: number;
      orderBy?: "createdTime" | "modifiedTime" | "name";
    } = {}): Promise<SpreadsheetFile[]> {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: "files(id,name,mimeType,createdTime,modifiedTime,webViewLink)",
        pageSize: String(options.maxResults || 20),
        orderBy: `${options.orderBy || "modifiedTime"} desc`,
      });

      const result = await driveApiRequest<{ files: SpreadsheetFile[] }>(
        `/files?${params.toString()}`,
      );

      return result.files || [];
    },

    /**
     * Get spreadsheet metadata
     */
    async getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
      return sheetsApiRequest<Spreadsheet>(
        `/spreadsheets/${spreadsheetId}`,
      );
    },

    /**
     * Read data from a range
     */
    async readRange(
      spreadsheetId: string,
      range: string,
    ): Promise<CellData> {
      const result = await sheetsApiRequest<{
        values?: unknown[][];
        range: string;
      }>(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      );

      return {
        values: result.values || [],
        range: result.range,
      };
    },

    /**
     * Read multiple ranges at once
     */
    async readRanges(
      spreadsheetId: string,
      ranges: string[],
    ): Promise<CellData[]> {
      const params = new URLSearchParams();
      ranges.forEach((range) => params.append("ranges", range));

      const result = await sheetsApiRequest<{
        valueRanges: Array<{ values?: unknown[][]; range: string }>;
      }>(
        `/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
      );

      return result.valueRanges.map((vr) => ({
        values: vr.values || [],
        range: vr.range,
      }));
    },

    /**
     * Write data to a range
     */
    async writeRange(options: WriteRangeOptions): Promise<{
      updatedRange: string;
      updatedRows: number;
      updatedColumns: number;
      updatedCells: number;
    }> {
      const result = await sheetsApiRequest<{
        updatedRange: string;
        updatedRows: number;
        updatedColumns: number;
        updatedCells: number;
      }>(
        `/spreadsheets/${options.spreadsheetId}/values/${
          encodeURIComponent(options.range)
        }?valueInputOption=${options.valueInputOption || "USER_ENTERED"}`,
        {
          method: "PUT",
          body: JSON.stringify({
            values: options.values,
          }),
        },
      );

      return result;
    },

    /**
     * Append data to a range
     */
    async appendRange(
      spreadsheetId: string,
      range: string,
      values: unknown[][],
      valueInputOption: "RAW" | "USER_ENTERED" = "USER_ENTERED",
    ): Promise<{
      updates: {
        updatedRange: string;
        updatedRows: number;
        updatedColumns: number;
        updatedCells: number;
      };
    }> {
      const result = await sheetsApiRequest<{
        updates: {
          updatedRange: string;
          updatedRows: number;
          updatedColumns: number;
          updatedCells: number;
        };
      }>(
        `/spreadsheets/${spreadsheetId}/values/${
          encodeURIComponent(range)
        }:append?valueInputOption=${valueInputOption}`,
        {
          method: "POST",
          body: JSON.stringify({
            values,
          }),
        },
      );

      return result;
    },

    /**
     * Clear a range
     */
    async clearRange(
      spreadsheetId: string,
      range: string,
    ): Promise<{ clearedRange: string }> {
      const result = await sheetsApiRequest<{ clearedRange: string }>(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
        {
          method: "POST",
        },
      );

      return result;
    },

    /**
     * Create a new spreadsheet
     */
    async createSpreadsheet(
      options: CreateSpreadsheetOptions,
    ): Promise<Spreadsheet> {
      const body: {
        properties: { title: string };
        sheets?: Array<{
          properties: {
            title: string;
            gridProperties?: {
              rowCount: number;
              columnCount: number;
            };
          };
        }>;
      } = {
        properties: {
          title: options.title,
        },
      };

      if (options.sheets && options.sheets.length > 0) {
        body.sheets = options.sheets.map((sheet) => ({
          properties: {
            title: sheet.title,
            gridProperties: {
              rowCount: sheet.rowCount || 1000,
              columnCount: sheet.columnCount || 26,
            },
          },
        }));
      }

      return sheetsApiRequest<Spreadsheet>("/spreadsheets", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    /**
     * Add a new sheet to an existing spreadsheet
     */
    async addSheet(
      spreadsheetId: string,
      title: string,
      options?: {
        rowCount?: number;
        columnCount?: number;
      },
    ): Promise<Sheet> {
      const result = await sheetsApiRequest<{
        replies: Array<{
          addSheet?: { properties: Sheet["properties"] };
        }>;
      }>(
        `/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                addSheet: {
                  properties: {
                    title,
                    gridProperties: {
                      rowCount: options?.rowCount || 1000,
                      columnCount: options?.columnCount || 26,
                    },
                  },
                },
              },
            ],
          }),
        },
      );

      const addedSheet = result.replies[0]?.addSheet;
      if (!addedSheet) {
        throw new Error("Failed to add sheet");
      }

      return { properties: addedSheet.properties };
    },

    /**
     * Delete a sheet from a spreadsheet
     */
    async deleteSheet(
      spreadsheetId: string,
      sheetId: number,
    ): Promise<void> {
      await sheetsApiRequest(
        `/spreadsheets/${spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                deleteSheet: {
                  sheetId,
                },
              },
            ],
          }),
        },
      );
    },
  };
}

export type SheetsClient = ReturnType<typeof createSheetsClient>;
