# Google Sheets Integration for Veryfront

A complete Google Sheets integration following the Notion integration pattern. Provides AI tools for reading, writing, and managing Google Sheets spreadsheets.

## Features

- **OAuth 2.0 Authentication** - Secure Google OAuth flow with token refresh
- **Read Operations** - List spreadsheets, read metadata, and fetch cell data
- **Write Operations** - Create spreadsheets, write data, and update ranges
- **Type-Safe Client** - Fully typed TypeScript API client
- **AI Tools** - Five AI tools for spreadsheet operations

## Directory Structure

```
sheets/
├── connector.json                           # Integration metadata and configuration
└── files/
    ├── _env.example                        # Environment variables template
    ├── lib/
    │   ├── oauth.ts                        # OAuth 2.0 helpers
    │   ├── token-store.ts                  # Token storage (in-memory for dev)
    │   └── sheets-client.ts                # Google Sheets API client
    ├── app/api/auth/sheets/
    │   ├── route.ts                        # OAuth initiation endpoint
    │   └── callback/route.ts               # OAuth callback handler
    └── ai/tools/
        ├── list-spreadsheets.ts            # List recent spreadsheets
        ├── get-spreadsheet.ts              # Get spreadsheet metadata
        ├── read-range.ts                   # Read cell data from range
        ├── write-range.ts                  # Write data to range
        └── create-spreadsheet.ts           # Create new spreadsheet
```

## Setup Instructions

### 1. Create Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new OAuth 2.0 Client ID (or use existing)
3. Add authorized redirect URI: `http://localhost:3000/api/auth/sheets/callback`
4. Copy Client ID and Client Secret

### 2. Enable Required APIs

Enable these APIs in your Google Cloud project:
- [Google Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)

### 3. Configure Environment Variables

```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
```

### 4. OAuth Scopes

The integration requests these scopes:
- `https://www.googleapis.com/auth/spreadsheets` - Full access to spreadsheets
- `https://www.googleapis.com/auth/drive.readonly` - Read-only access to Drive (for listing)

## API Client Usage

### Create Client

```typescript
import { createSheetsClient } from "./lib/sheets-client.ts";

const client = createSheetsClient("user-id");
```

### List Spreadsheets

```typescript
const spreadsheets = await client.listSpreadsheets({
  maxResults: 20,
  orderBy: "modifiedTime",
});
```

### Get Spreadsheet Metadata

```typescript
const spreadsheet = await client.getSpreadsheet("spreadsheet-id");
console.log(spreadsheet.properties.title);
console.log(spreadsheet.sheets); // All sheet tabs
```

### Read Data

```typescript
// Read specific range
const data = await client.readRange("spreadsheet-id", "Sheet1!A1:D10");
console.log(data.values); // 2D array of cell values

// Read entire sheet
const allData = await client.readRange("spreadsheet-id", "Sheet1");
```

### Write Data

```typescript
await client.writeRange({
  spreadsheetId: "spreadsheet-id",
  range: "Sheet1!A1",
  values: [
    ["Name", "Age", "City"],
    ["John", 30, "New York"],
    ["Jane", 25, "Boston"],
  ],
  valueInputOption: "USER_ENTERED", // Parses formulas, numbers, dates
});
```

### Create Spreadsheet

```typescript
const newSpreadsheet = await client.createSpreadsheet({
  title: "My New Spreadsheet",
  sheets: [
    { title: "Data", rowCount: 1000, columnCount: 26 },
    { title: "Summary", rowCount: 100, columnCount: 10 },
  ],
});
```

## AI Tools

### 1. list-spreadsheets

List recent Google Sheets from Drive.

```typescript
{
  maxResults: 20,
  orderBy: "modifiedTime" // or "createdTime", "name"
}
```

### 2. get-spreadsheet

Get spreadsheet metadata including all sheets and properties.

```typescript
{
  spreadsheetId: "abc123..."
}
```

### 3. read-range

Read cell data from a range using A1 notation.

```typescript
{
  spreadsheetId: "abc123...",
  range: "Sheet1!A1:D10" // or "A1:B", or just "Sheet1"
}
```

### 4. write-range

Write data to a spreadsheet range.

```typescript
{
  spreadsheetId: "abc123...",
  range: "Sheet1!A1",
  values: [["Header1", "Header2"], ["Value1", "Value2"]],
  valueInputOption: "USER_ENTERED" // or "RAW"
}
```

### 5. create-spreadsheet

Create a new spreadsheet with optional initial data.

```typescript
{
  title: "My Spreadsheet",
  sheets: [{ title: "Sheet1", rowCount: 1000, columnCount: 26 }],
  initialData: {
    sheetTitle: "Sheet1",
    range: "A1",
    values: [["Name", "Value"], ["Item1", 100]]
  }
}
```

## Suggested Prompts

The integration includes three AI prompts:

1. **Analyze spreadsheet data** - Read and analyze data with insights and statistics
2. **Create a report spreadsheet** - Generate formatted spreadsheets with calculations
3. **Update a tracker** - Update tracking spreadsheets with new data

## Integration with Other Services

This integration works well with:
- **Gmail** - Export email data to sheets
- **Calendar** - Create event trackers
- **Notion** - Sync data between Notion and Sheets

## Advanced Features

### Token Management

The integration includes automatic token refresh:
- Tokens expire after 1 hour
- Refresh tokens are used automatically
- Failed refreshes trigger re-authentication

### Batch Operations

```typescript
// Read multiple ranges at once
const ranges = await client.readRanges("spreadsheet-id", [
  "Sheet1!A1:B10",
  "Sheet2!C1:D10",
]);

// Append data to a sheet
await client.appendRange("spreadsheet-id", "Sheet1!A1", [
  ["New Row 1", "Value 1"],
  ["New Row 2", "Value 2"],
]);

// Clear a range
await client.clearRange("spreadsheet-id", "Sheet1!A1:Z100");
```

### Sheet Management

```typescript
// Add a new sheet
await client.addSheet("spreadsheet-id", "New Sheet", {
  rowCount: 500,
  columnCount: 20,
});

// Delete a sheet
await client.deleteSheet("spreadsheet-id", sheetId);
```

## Production Considerations

### Token Storage

The default implementation uses in-memory storage. For production:

```typescript
import { createTokenStore } from "./lib/token-store.ts";

const tokenStore = createTokenStore({
  get: async (key) => await db.get(key),
  set: async (key, value) => await db.set(key, value),
  delete: async (key) => await db.delete(key),
});
```

### User Authentication

Replace `DEFAULT_USER_ID` with actual user session management:

```typescript
// Get user from session
const userId = await getSessionUserId(request);
const client = createSheetsClient(userId);
```

### Error Handling

The client throws descriptive errors:
- `"Google Sheets not connected"` - User needs to authenticate
- `"Sheets API error: 404"` - Spreadsheet not found
- `"Token refresh failed"` - Re-authentication required

## Type Definitions

### Spreadsheet

```typescript
interface Spreadsheet {
  spreadsheetId: string;
  properties: {
    title: string;
    locale: string;
    timeZone: string;
  };
  sheets: Sheet[];
  spreadsheetUrl: string;
}
```

### Sheet

```typescript
interface Sheet {
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
```

### CellData

```typescript
interface CellData {
  values: unknown[][];
  range: string;
}
```

## API Documentation

- [Google Sheets API v4](https://developers.google.com/sheets/api/reference/rest)
- [Google OAuth 2.0](https://developers.google.com/identity/protocols/oauth2)
- [A1 Notation](https://developers.google.com/sheets/api/guides/concepts#cell)

## License

Part of the Veryfront framework.
