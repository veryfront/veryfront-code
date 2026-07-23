/**
 * Google Sheets API Client
 *
 * Provides a type-safe interface to Google Sheets API operations.
 */

import { fetchOAuthJson } from "./oauth.ts";

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

export interface AppendRangeOptions extends WriteRangeOptions {
  insertDataOption?: "OVERWRITE" | "INSERT_ROWS";
}

export interface BatchUpdateOptions {
  spreadsheetId: string;
  requests: Array<Record<string, unknown>>;
  includeSpreadsheetInResponse?: boolean;
  responseRanges?: string[];
}

export function createSheetsClient(userId: string): {
  listSpreadsheets(options?: {
    maxResults?: number;
    orderBy?: "createdTime" | "modifiedTime" | "name";
  }): Promise<SpreadsheetFile[]>;
  getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet>;
  readRange(spreadsheetId: string, range: string): Promise<CellData>;
  readRanges(spreadsheetId: string, ranges: string[]): Promise<CellData[]>;
  writeRange(options: WriteRangeOptions): Promise<{
    updatedRange: string;
    updatedRows: number;
    updatedColumns: number;
    updatedCells: number;
  }>;
  appendRange(options: AppendRangeOptions): Promise<{
    updates: {
      updatedRange: string;
      updatedRows: number;
      updatedColumns: number;
      updatedCells: number;
    };
  }>;
  clearRange(
    spreadsheetId: string,
    range: string,
  ): Promise<{ clearedRange: string }>;
  batchUpdate(options: BatchUpdateOptions): Promise<unknown>;
  createSpreadsheet(options: CreateSpreadsheetOptions): Promise<Spreadsheet>;
  addSheet(
    spreadsheetId: string,
    title: string,
    options?: { rowCount?: number; columnCount?: number },
  ): Promise<Sheet>;
  deleteSheet(spreadsheetId: string, sheetId: number): Promise<void>;
  renameSheet(
    spreadsheetId: string,
    sheetId: number,
    title: string,
  ): Promise<unknown>;
  deleteSpreadsheet(
    spreadsheetId: string,
    options?: { permanentlyDelete?: boolean },
  ): Promise<
    { deleted: true; spreadsheetId: string; permanentlyDeleted: boolean }
  >;
  findReplace(options: {
    spreadsheetId: string;
    find: string;
    replacement: string;
    sheetId?: number;
    matchCase?: boolean;
    matchEntireCell?: boolean;
    searchByRegex?: boolean;
  }): Promise<unknown>;
  copySheet(options: {
    spreadsheetId: string;
    sheetId: number;
    destinationSpreadsheetId: string;
  }): Promise<unknown>;
  createChart(
    spreadsheetId: string,
    chart: Record<string, unknown>,
  ): Promise<unknown>;
  setDataValidation(options: {
    spreadsheetId: string;
    range: Record<string, unknown>;
    rule: Record<string, unknown>;
  }): Promise<unknown>;
} {
  function apiRequest<T>(
    baseUrl: string,
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return fetchOAuthJson<T>(userId, "sheets", `${baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  }

  function sheetsApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return apiRequest<T>(SHEETS_API_BASE, endpoint, options);
  }

  function driveApiRequest<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    return apiRequest<T>(DRIVE_API_BASE, endpoint, options);
  }

  return {
    async listSpreadsheets(options: {
      maxResults?: number;
      orderBy?: "createdTime" | "modifiedTime" | "name";
    } = {}): Promise<SpreadsheetFile[]> {
      const params = new URLSearchParams({
        q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
        fields: "files(id,name,mimeType,createdTime,modifiedTime,webViewLink)",
        pageSize: String(options.maxResults ?? 20),
        orderBy: `${options.orderBy ?? "modifiedTime"} desc`,
      });

      const result = await driveApiRequest<{ files?: SpreadsheetFile[] }>(
        `/files?${params.toString()}`,
      );
      return result.files ?? [];
    },

    getSpreadsheet(spreadsheetId: string): Promise<Spreadsheet> {
      return sheetsApiRequest<Spreadsheet>(`/spreadsheets/${spreadsheetId}`);
    },

    async readRange(spreadsheetId: string, range: string): Promise<CellData> {
      const result = await sheetsApiRequest<
        { values?: unknown[][]; range: string }
      >(
        `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
      );

      return { values: result.values ?? [], range: result.range };
    },

    async readRanges(
      spreadsheetId: string,
      ranges: string[],
    ): Promise<CellData[]> {
      const params = new URLSearchParams();
      ranges.forEach((range) => params.append("ranges", range));

      const result = await sheetsApiRequest<{
        valueRanges: Array<{ values?: unknown[][]; range: string }>;
      }>(`/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`);

      return result.valueRanges.map((vr) => ({
        values: vr.values ?? [],
        range: vr.range,
      }));
    },

    writeRange(options: WriteRangeOptions): Promise<{
      updatedRange: string;
      updatedRows: number;
      updatedColumns: number;
      updatedCells: number;
    }> {
      const valueInputOption = options.valueInputOption ?? "USER_ENTERED";

      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}/values/${
          encodeURIComponent(options.range)
        }?valueInputOption=${valueInputOption}`,
        {
          method: "PUT",
          body: JSON.stringify({ values: options.values }),
        },
      );
    },

    appendRange(options: AppendRangeOptions): Promise<{
      updates: {
        updatedRange: string;
        updatedRows: number;
        updatedColumns: number;
        updatedCells: number;
      };
    }> {
      const params = new URLSearchParams({
        valueInputOption: options.valueInputOption ?? "USER_ENTERED",
        insertDataOption: options.insertDataOption ?? "INSERT_ROWS",
      });

      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}/values/${
          encodeURIComponent(options.range)
        }:append?${params.toString()}`,
        {
          method: "POST",
          body: JSON.stringify({ values: options.values }),
        },
      );
    },

    clearRange(
      spreadsheetId: string,
      range: string,
    ): Promise<{ clearedRange: string }> {
      return sheetsApiRequest(
        `/spreadsheets/${spreadsheetId}/values/${
          encodeURIComponent(range)
        }:clear`,
        {
          method: "POST",
        },
      );
    },

    batchUpdate(options: BatchUpdateOptions): Promise<unknown> {
      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: options.requests,
            includeSpreadsheetInResponse: options.includeSpreadsheetInResponse,
            responseRanges: options.responseRanges,
          }),
        },
      );
    },

    createSpreadsheet(options: CreateSpreadsheetOptions): Promise<Spreadsheet> {
      const body: {
        properties: { title: string };
        sheets?: Array<{
          properties: {
            title: string;
            gridProperties?: { rowCount: number; columnCount: number };
          };
        }>;
      } = { properties: { title: options.title } };

      if (options.sheets?.length) {
        body.sheets = options.sheets.map((sheet) => ({
          properties: {
            title: sheet.title,
            gridProperties: {
              rowCount: sheet.rowCount ?? 1000,
              columnCount: sheet.columnCount ?? 26,
            },
          },
        }));
      }

      return sheetsApiRequest("/spreadsheets", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    async addSheet(
      spreadsheetId: string,
      title: string,
      options?: { rowCount?: number; columnCount?: number },
    ): Promise<Sheet> {
      const result = await sheetsApiRequest<{
        replies: Array<{ addSheet?: { properties: Sheet["properties"] } }>;
      }>(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title,
                  gridProperties: {
                    rowCount: options?.rowCount ?? 1000,
                    columnCount: options?.columnCount ?? 26,
                  },
                },
              },
            },
          ],
        }),
      });

      const properties = result.replies[0]?.addSheet?.properties;
      if (!properties) throw new Error("Failed to add sheet");

      return { properties };
    },

    async deleteSheet(spreadsheetId: string, sheetId: number): Promise<void> {
      await sheetsApiRequest(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ deleteSheet: { sheetId } }],
        }),
      });
    },

    renameSheet(
      spreadsheetId: string,
      sheetId: number,
      title: string,
    ): Promise<unknown> {
      return sheetsApiRequest(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{
            updateSheetProperties: {
              properties: { sheetId, title },
              fields: "title",
            },
          }],
        }),
      });
    },

    async deleteSpreadsheet(
      spreadsheetId: string,
      options: { permanentlyDelete?: boolean } = {},
    ): Promise<
      { deleted: true; spreadsheetId: string; permanentlyDeleted: boolean }
    > {
      if (options.permanentlyDelete) {
        await driveApiRequest(`/files/${spreadsheetId}`, { method: "DELETE" });
      } else {
        await driveApiRequest(`/files/${spreadsheetId}`, {
          method: "PATCH",
          body: JSON.stringify({ trashed: true }),
        });
      }

      return {
        deleted: true,
        spreadsheetId,
        permanentlyDeleted: Boolean(options.permanentlyDelete),
      };
    },

    findReplace(options: {
      spreadsheetId: string;
      find: string;
      replacement: string;
      sheetId?: number;
      matchCase?: boolean;
      matchEntireCell?: boolean;
      searchByRegex?: boolean;
    }): Promise<unknown> {
      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [{
              findReplace: {
                find: options.find,
                replacement: options.replacement,
                sheetId: options.sheetId,
                matchCase: options.matchCase,
                matchEntireCell: options.matchEntireCell,
                searchByRegex: options.searchByRegex,
                allSheets: options.sheetId === undefined ? true : undefined,
              },
            }],
          }),
        },
      );
    },

    copySheet(options: {
      spreadsheetId: string;
      sheetId: number;
      destinationSpreadsheetId: string;
    }): Promise<unknown> {
      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}/sheets/${options.sheetId}:copyTo`,
        {
          method: "POST",
          body: JSON.stringify({
            destinationSpreadsheetId: options.destinationSpreadsheetId,
          }),
        },
      );
    },

    createChart(
      spreadsheetId: string,
      chart: Record<string, unknown>,
    ): Promise<unknown> {
      return sheetsApiRequest(`/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          requests: [{ addChart: { chart } }],
        }),
      });
    },

    setDataValidation(options: {
      spreadsheetId: string;
      range: Record<string, unknown>;
      rule: Record<string, unknown>;
    }): Promise<unknown> {
      return sheetsApiRequest(
        `/spreadsheets/${options.spreadsheetId}:batchUpdate`,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [{
              repeatCell: {
                range: options.range,
                cell: { dataValidation: options.rule },
                fields: "dataValidation",
              },
            }],
          }),
        },
      );
    },
  };
}

export type SheetsClient = ReturnType<typeof createSheetsClient>;
