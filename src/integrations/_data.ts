// Auto-generated — do not edit
import type { IntegrationConfig } from "./schema.ts";

export const connectors: IntegrationConfig[] = [
  {
    "name": "airtable",
    "displayName": "Airtable",
    "icon": "airtable.svg",
    "description": "Read and write records in Airtable bases and tables",
    "auth": {
      "type": "oauth2",
      "provider": "airtable",
      "authorizationUrl": "https://airtable.com/oauth2/v1/authorize",
      "tokenUrl": "https://airtable.com/oauth2/v1/token",
      "scopes": [
        "data.records:read",
        "data.records:write",
        "schema.bases:read",
        "schema.bases:write",
      ],
      "tokenAuthMethod": "basic",
      "pkce": true,
      "requiredApis": [{
        "name": "Airtable OAuth Integration",
        "enableUrl": "https://airtable.com/create/oauth",
      }],
    },
    "envVars": [{
      "name": "AIRTABLE_CLIENT_ID",
      "description": "Airtable OAuth Client ID (from your OAuth integration)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://airtable.com/create/oauth",
    }, {
      "name": "AIRTABLE_CLIENT_SECRET",
      "description": "Airtable OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://airtable.com/create/oauth",
    }],
    "tools": [{
      "id": "list_bases",
      "name": "List Bases",
      "description": "List all accessible Airtable bases",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.airtable.com/v0/meta/bases",
        "params": {
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of bases to return",
            "default": 100,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Airtable",
          },
        },
        "response": { "transform": "bases" },
      },
    }, {
      "id": "get_base",
      "name": "Get Base",
      "description": "Get schema information for a specific base",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.airtable.com/v0/meta/bases/{baseId}/tables",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_records",
      "name": "List Records",
      "description": "List records from a table with optional filtering",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
          "view": { "type": "string", "in": "query", "description": "Optional view name or ID" },
          "filterByFormula": {
            "type": "string",
            "in": "query",
            "description": "Airtable formula used to filter returned records",
          },
          "maxRecords": {
            "type": "number",
            "in": "query",
            "description": "Maximum records to return",
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Records per page",
            "default": 100,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Airtable",
          },
        },
        "response": { "transform": "records" },
      },
    }, {
      "id": "get_record",
      "name": "Get Record",
      "description": "Get a specific record by ID",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}/{recordId}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
          "recordId": {
            "type": "string",
            "in": "path",
            "description": "Airtable record ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_record",
      "name": "Create Record",
      "description": "Create a new record in a table",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
        },
        "body": {
          "fields": {
            "type": "object",
            "description": "Field values for the new record",
            "required": true,
          },
          "typecast": {
            "type": "boolean",
            "description": "Allow Airtable to typecast field values",
            "default": false,
          },
        },
      },
    }, {
      "id": "create_records",
      "name": "Create Records",
      "description": "Create multiple records in a table",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
        },
        "body": {
          "records": {
            "type": "array",
            "description": "Array of 1-10 record objects with fields",
            "required": true,
          },
          "typecast": {
            "type": "boolean",
            "description": "Allow Airtable to typecast field values",
            "default": false,
          },
        },
        "response": { "transform": "records" },
      },
    }, {
      "id": "update_record",
      "name": "Update Record",
      "description": "Update fields on an existing record",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}/{recordId}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
          "recordId": {
            "type": "string",
            "in": "path",
            "description": "Airtable record ID",
            "required": true,
          },
        },
        "body": {
          "fields": { "type": "object", "description": "Field values to update", "required": true },
          "typecast": {
            "type": "boolean",
            "description": "Allow Airtable to typecast field values",
            "default": false,
          },
        },
      },
    }, {
      "id": "delete_record",
      "name": "Delete Record",
      "description": "Delete a record from a table",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://api.airtable.com/v0/{baseId}/{tableIdOrName}/{recordId}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableIdOrName": {
            "type": "string",
            "in": "path",
            "description": "Table ID or URL-encoded table name",
            "required": true,
          },
          "recordId": {
            "type": "string",
            "in": "path",
            "description": "Airtable record ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_table",
      "name": "Create Table",
      "description": "Create a new table in an Airtable base",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.airtable.com/v0/meta/bases/{baseId}/tables",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
        },
        "body": {
          "name": { "type": "string", "description": "Table name", "required": true },
          "description": { "type": "string", "description": "Table description" },
          "fields": {
            "type": "array",
            "description": "At least one initial field definition for the table",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_table",
      "name": "Update Table",
      "description": "Update table metadata such as name or description using the table ID",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableId": {
            "type": "string",
            "in": "path",
            "description": "Airtable table ID",
            "required": true,
          },
        },
        "body": {
          "name": { "type": "string", "description": "New table name" },
          "description": { "type": "string", "description": "New table description" },
        },
      },
    }, {
      "id": "create_field",
      "name": "Create Field",
      "description": "Create a new field in an Airtable table",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.airtable.com/v0/meta/bases/{baseId}/tables/{tableId}/fields",
        "params": {
          "baseId": {
            "type": "string",
            "in": "path",
            "description": "Airtable base ID",
            "required": true,
          },
          "tableId": {
            "type": "string",
            "in": "path",
            "description": "Airtable table ID",
            "required": true,
          },
        },
        "body": {
          "name": { "type": "string", "description": "Field name", "required": true },
          "type": { "type": "string", "description": "Airtable field type", "required": true },
          "description": { "type": "string", "description": "Field description" },
          "options": { "type": "object", "description": "Field type-specific options" },
        },
      },
    }],
    "prompts": [{
      "id": "query_data",
      "title": "Query my data",
      "prompt":
        "Search and query records from my Airtable bases. Find specific information across tables.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "add_record",
      "title": "Add a record",
      "prompt": "Create a new record in an Airtable table with the specified field values.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "analyze_base",
      "title": "Analyze base structure",
      "prompt":
        "Analyze the structure and schema of an Airtable base, including all tables and their fields.",
      "category": "productivity",
      "icon": "document",
    }],
    "suggestedWith": ["gmail", "slack", "notion"],
  },
  {
    "name": "anthropic",
    "displayName": "Anthropic",
    "icon": "anthropic.svg",
    "description":
      "Integrate with Anthropic Admin API to manage workspaces, monitor usage, and access organization data",
    "auth": {
      "type": "api-key",
      "envVars": {
        "ANTHROPIC_ADMIN_API_KEY": {
          "description": "Admin API key for Anthropic organization management",
          "required": true,
        },
      },
    },
    "tools": [
      { "name": "list-workspaces", "description": "List all workspaces in the organization" },
      { "name": "get-usage", "description": "Get API usage statistics for a date range" },
      { "name": "list-api-keys", "description": "List API keys for a workspace or organization" },
      { "name": "list-members", "description": "List all members in the organization" },
      { "name": "get-organization", "description": "Get organization details and settings" },
    ],
  },
  {
    "name": "asana",
    "displayName": "Asana",
    "icon": "asana.svg",
    "description": "Manage tasks, projects, and teams in Asana",
    "auth": {
      "type": "oauth2",
      "provider": "asana",
      "authorizationUrl": "https://app.asana.com/-/oauth_authorize",
      "tokenUrl": "https://app.asana.com/-/oauth_token",
      "scopes": ["default"],
      "requiredApis": [{
        "name": "Asana Developer Console",
        "enableUrl": "https://app.asana.com/0/developer-console",
      }],
    },
    "envVars": [{
      "name": "ASANA_CLIENT_ID",
      "description": "Asana OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://developers.asana.com/docs/oauth",
    }, {
      "name": "ASANA_CLIENT_SECRET",
      "description": "Asana OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://developers.asana.com/docs/oauth",
    }],
    "tools": [{
      "id": "list_tasks",
      "name": "List Tasks",
      "description": "List tasks in a project or assigned to a user",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/tasks",
        "params": {
          "project": {
            "type": "string",
            "in": "query",
            "description": "Asana project GID to list tasks from",
          },
          "assignee": {
            "type": "string",
            "in": "query",
            "description": "Assignee user GID, 'me', or omit when project is provided",
          },
          "workspace": {
            "type": "string",
            "in": "query",
            "description": "Workspace GID for assignee-based task lists",
          },
          "completed_since": {
            "type": "string",
            "in": "query",
            "description": "Only return tasks completed since this ISO timestamp",
            "default": "now",
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum tasks to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "tasks"],
            "collectionName": "tasks",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "tasks details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_task",
      "name": "Get Task",
      "description": "Get details of a specific task",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/tasks/{taskGid}",
        "params": {
          "taskGid": {
            "type": "string",
            "in": "path",
            "description": "Asana task GID",
            "required": true,
          },
          "opt_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated task fields to return",
          },
        },
        "response": { "transform": "data" },
      },
    }, {
      "id": "create_task",
      "name": "Create Task",
      "description": "Create a new task in a project",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://app.asana.com/api/1.0/tasks",
        "body": {
          "data": {
            "type": "object",
            "description":
              "Asana task payload with name, projects, workspace, assignee, notes, due_on, etc.",
            "required": true,
          },
        },
        "response": { "transform": "data" },
      },
    }, {
      "id": "update_task",
      "name": "Update Task",
      "description": "Update an existing task",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://app.asana.com/api/1.0/tasks/{taskGid}",
        "params": {
          "taskGid": {
            "type": "string",
            "in": "path",
            "description": "Asana task GID",
            "required": true,
          },
        },
        "body": {
          "data": {
            "type": "object",
            "description": "Asana task fields to update",
            "required": true,
          },
        },
        "response": { "transform": "data" },
      },
    }, {
      "id": "delete_task",
      "name": "Delete Task",
      "description": "Delete an Asana task by GID",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://app.asana.com/api/1.0/tasks/{taskGid}",
        "params": {
          "taskGid": {
            "type": "string",
            "in": "path",
            "description": "Asana task GID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description": "List all projects in the workspace",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/projects",
        "params": {
          "workspace": {
            "type": "string",
            "in": "query",
            "description": "Workspace GID to list projects from",
          },
          "team": {
            "type": "string",
            "in": "query",
            "description": "Team GID to list projects from",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to include archived projects",
            "default": false,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum projects to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "projects"],
            "collectionName": "projects",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "projects details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_workspaces",
      "name": "List Workspaces",
      "description": "List Asana workspaces accessible to the authenticated user",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/workspaces",
        "params": {
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum workspaces to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "workspaces"],
            "collectionName": "workspaces",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "workspaces details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_users",
      "name": "List Users",
      "description": "List users in an Asana workspace",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/users",
        "params": {
          "workspace": {
            "type": "string",
            "in": "query",
            "description": "Workspace GID",
            "required": true,
          },
          "team": { "type": "string", "in": "query", "description": "Optional team GID" },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum users to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
          "opt_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated user fields",
            "default": "gid,name,email",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "users"],
            "collectionName": "users",
            "itemFields": [{ "name": "gid" }, { "name": "name" }, { "name": "email" }],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "user profile details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_teams",
      "name": "List Teams",
      "description": "List teams in an Asana workspace",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/workspaces/{workspaceGid}/teams",
        "params": {
          "workspaceGid": {
            "type": "string",
            "in": "path",
            "description": "Workspace GID",
            "required": true,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum teams to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
          "opt_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated team fields",
            "default": "gid,name,description",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "teams"],
            "collectionName": "teams",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "teams details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "add_task_comment",
      "name": "Add Task Comment",
      "description": "Add a story/comment to an Asana task",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://app.asana.com/api/1.0/tasks/{taskGid}/stories",
        "params": {
          "taskGid": {
            "type": "string",
            "in": "path",
            "description": "Asana task GID",
            "required": true,
          },
        },
        "body": {
          "data": {
            "type": "object",
            "description": "Story payload, e.g. { text: 'Comment text' }",
            "required": true,
          },
        },
        "response": { "transform": "data" },
      },
    }, {
      "id": "list_task_comments",
      "name": "List Task Comments",
      "description": "List comment stories for an Asana task",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://app.asana.com/api/1.0/tasks/{taskGid}/stories",
        "params": {
          "taskGid": {
            "type": "string",
            "in": "path",
            "description": "Asana task GID",
            "required": true,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum stories to return",
            "default": 50,
          },
          "offset": {
            "type": "string",
            "in": "query",
            "description": "Pagination offset from Asana",
          },
          "opt_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated story fields",
            "default": "gid,type,text,created_at,created_by.name",
          },
        },
        "response": {
          "transform": "data",
          "historicalSummary": {
            "collectionKeys": ["data", "comments", "stories"],
            "collectionName": "comments",
            "itemFields": [
              { "name": "gid" },
              { "name": "type" },
              { "name": "text", "maxLength": 300 },
              { "name": "created_at" },
              { "name": "created_by", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "full comment story payloads and provider-specific fields",
          },
        },
      },
    }],
    "prompts": [{
      "id": "my_tasks",
      "title": "Show my tasks",
      "prompt": "List all tasks assigned to me in Asana with their due dates and priorities.",
      "category": "productivity",
      "icon": "list",
    }, {
      "id": "create_task",
      "title": "Create a task",
      "prompt": "Create a new task with a title, description, due date, and assignee.",
      "category": "productivity",
      "icon": "plus",
    }],
    "suggestedWith": ["slack", "notion", "calendar"],
  },
  {
    "name": "aws",
    "displayName": "Amazon Web Services",
    "icon": "aws.svg",
    "description": "Integration with AWS services including S3, EC2, and Lambda",
    "auth": {
      "type": "api-key",
      "fields": [{
        "name": "accessKeyId",
        "label": "AWS Access Key ID",
        "type": "string",
        "required": true,
        "envVar": "AWS_ACCESS_KEY_ID",
      }, {
        "name": "secretAccessKey",
        "label": "AWS Secret Access Key",
        "type": "password",
        "required": true,
        "envVar": "AWS_SECRET_ACCESS_KEY",
      }, {
        "name": "region",
        "label": "AWS Region",
        "type": "string",
        "required": true,
        "envVar": "AWS_REGION",
        "default": "us-east-1",
      }],
    },
    "envVars": [{
      "name": "AWS_ACCESS_KEY_ID",
      "description": "AWS Access Key ID",
      "required": true,
    }, {
      "name": "AWS_SECRET_ACCESS_KEY",
      "description": "AWS Secret Access Key",
      "required": true,
      "sensitive": true,
    }, {
      "name": "AWS_REGION",
      "description": "AWS Region (e.g. us-east-1)",
      "required": true,
      "default": "us-east-1",
    }],
    "tools": [{
      "name": "list-s3-buckets",
      "description": "List all S3 buckets in your AWS account",
      "file": "tools/list-s3-buckets.ts",
    }, {
      "name": "list-s3-objects",
      "description": "List objects in a specific S3 bucket",
      "file": "tools/list-s3-objects.ts",
    }, {
      "name": "get-s3-object",
      "description": "Get the contents of an object from S3",
      "file": "tools/get-s3-object.ts",
    }, {
      "name": "list-ec2-instances",
      "description": "List EC2 instances in your AWS account",
      "file": "tools/list-ec2-instances.ts",
    }, {
      "name": "list-lambda-functions",
      "description": "List Lambda functions in your AWS account",
      "file": "tools/list-lambda-functions.ts",
    }],
    "dependencies": {
      "@aws-sdk/client-s3": "^3.600.0",
      "@aws-sdk/client-ec2": "^3.600.0",
      "@aws-sdk/client-lambda": "^3.600.0",
      "@aws-sdk/credential-providers": "^3.600.0",
    },
  },
  {
    "name": "bitbucket",
    "displayName": "Bitbucket",
    "icon": "bitbucket.svg",
    "description": "Manage repositories, pull requests, and issues on Bitbucket",
    "auth": {
      "type": "oauth2",
      "provider": "bitbucket",
      "authorizationUrl": "https://bitbucket.org/site/oauth2/authorize",
      "tokenUrl": "https://bitbucket.org/site/oauth2/access_token",
      "scopes": ["repository", "pullrequest", "issue", "account"],
    },
    "envVars": [{
      "name": "BITBUCKET_CLIENT_ID",
      "description": "Bitbucket OAuth Consumer Key",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
    }, {
      "name": "BITBUCKET_CLIENT_SECRET",
      "description": "Bitbucket OAuth Consumer Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://support.atlassian.com/bitbucket-cloud/docs/use-oauth-on-bitbucket-cloud/",
    }],
    "tools": [{
      "id": "list_repositories",
      "name": "List Repositories",
      "description": "Get list of user's repositories",
      "requiresWrite": false,
    }, {
      "id": "list_pull_requests",
      "name": "List Pull Requests",
      "description": "Get pull requests for a repository",
      "requiresWrite": false,
    }, {
      "id": "create_pull_request",
      "name": "Create Pull Request",
      "description": "Create a new pull request",
      "requiresWrite": true,
    }, {
      "id": "list_issues",
      "name": "List Issues",
      "description": "Get issues for a repository",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "review_prs",
      "title": "Review my pull requests",
      "prompt":
        "Show me my open pull requests on Bitbucket and help me review them. Summarize the changes and any comments.",
      "category": "development",
      "icon": "git-pull-request",
    }, {
      "id": "list_repos",
      "title": "List my repositories",
      "prompt": "Show me all my Bitbucket repositories with their details and recent activity.",
      "category": "development",
      "icon": "folder",
    }, {
      "id": "check_issues",
      "title": "Check repository issues",
      "prompt": "Show me the open issues in my repositories and help me prioritize them.",
      "category": "development",
      "icon": "bug",
    }],
    "suggestedWith": ["github", "gitlab", "jira"],
  },
  {
    "name": "calendar",
    "displayName": "Google Calendar",
    "icon": "calendar.svg",
    "description": "Manage events, find free time, and schedule meetings",
    "auth": {
      "type": "oauth2",
      "provider": "google",
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
      "tokenUrl": "https://oauth2.googleapis.com/token",
      "scopes": [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      "requiredApis": [{
        "name": "Google Calendar API",
        "enableUrl": "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com",
      }],
    },
    "envVars": [{
      "name": "GOOGLE_CLIENT_ID",
      "description": "Google OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }, {
      "name": "GOOGLE_CLIENT_SECRET",
      "description": "Google OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }],
    "tools": [{
      "id": "list_calendars",
      "name": "List Calendars",
      "description": "List all calendars in the authenticated user's calendar list",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/calendar/v3/users/me/calendarList",
        "params": {
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum calendars to return",
            "default": 100,
          },
        },
        "response": { "transform": "items" },
      },
    }, {
      "id": "list_events",
      "name": "List Events",
      "description": "Get upcoming calendar events",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID (use 'primary' for main calendar)",
            "required": true,
            "default": "primary",
          },
          "timeMin": { "type": "string", "in": "query", "description": "Start time (RFC3339)" },
          "timeMax": { "type": "string", "in": "query", "description": "End time (RFC3339)" },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum events",
            "default": 10,
          },
          "orderBy": {
            "type": "string",
            "in": "query",
            "description": "Order by: startTime or updated",
            "default": "startTime",
          },
          "singleEvents": {
            "type": "boolean",
            "in": "query",
            "description": "Expand recurring events",
            "default": true,
          },
        },
        "response": { "transform": "items" },
      },
    }, {
      "id": "create_event",
      "name": "Create Event",
      "description": "Schedule a new calendar event",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
            "default": "primary",
          },
        },
        "body": {
          "summary": { "type": "string", "description": "Event title", "required": true },
          "description": { "type": "string", "description": "Event description" },
          "start": {
            "type": "object",
            "description": "Start time: {dateTime: 'RFC3339', timeZone: 'TZ'}",
            "required": true,
          },
          "end": {
            "type": "object",
            "description": "End time: {dateTime: 'RFC3339', timeZone: 'TZ'}",
            "required": true,
          },
          "attendees": { "type": "array", "description": "Array of {email: string} objects" },
          "location": { "type": "string", "description": "Event location" },
        },
      },
    }, {
      "id": "get_event",
      "name": "Get Event",
      "description": "Get details of a specific calendar event",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
            "default": "primary",
          },
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_event",
      "name": "Update Event",
      "description": "Update an existing calendar event",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
            "default": "primary",
          },
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID to update",
            "required": true,
          },
          "sendUpdates": {
            "type": "string",
            "in": "query",
            "description": "Whether to send update notifications: all, externalOnly, or none",
            "default": "none",
          },
        },
        "body": {
          "summary": { "type": "string", "description": "Updated event title" },
          "description": { "type": "string", "description": "Updated event description" },
          "start": {
            "type": "object",
            "description": "Updated start time: {dateTime: 'RFC3339', timeZone: 'TZ'}",
          },
          "end": {
            "type": "object",
            "description": "Updated end time: {dateTime: 'RFC3339', timeZone: 'TZ'}",
          },
          "attendees": {
            "type": "array",
            "description": "Updated array of {email: string} attendees",
          },
          "location": { "type": "string", "description": "Updated event location" },
        },
      },
    }, {
      "id": "delete_event",
      "name": "Delete Event",
      "description": "Delete a calendar event by ID",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events/{eventId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
            "default": "primary",
          },
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID to delete",
            "required": true,
          },
          "sendUpdates": {
            "type": "string",
            "in": "query",
            "description": "Whether to send cancellation notifications: all, externalOnly, or none",
            "default": "none",
          },
        },
      },
    }, {
      "id": "find_free_time",
      "name": "Find Free Time",
      "description": "Find available time slots in calendar",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://www.googleapis.com/calendar/v3/freeBusy",
        "body": {
          "timeMin": {
            "type": "string",
            "description": "Start of window (RFC3339)",
            "required": true,
          },
          "timeMax": {
            "type": "string",
            "description": "End of window (RFC3339)",
            "required": true,
          },
          "items": {
            "type": "array",
            "description": "Array of {id: calendarId} to check",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "block_deep_work",
      "title": "Block time for deep work",
      "prompt": "Find a 2-hour block for focused work this week and add it to my calendar.",
      "category": "productivity",
      "icon": "clock",
    }, {
      "id": "schedule_meeting",
      "title": "Schedule a meeting",
      "prompt":
        "Help me schedule a meeting. Find available time slots and create the calendar event.",
      "category": "productivity",
      "icon": "users",
    }, {
      "id": "today_agenda",
      "title": "What's on my calendar today?",
      "prompt": "Show me my calendar for today and summarize my schedule.",
      "category": "productivity",
      "icon": "calendar",
    }],
    "suggestedWith": ["gmail", "slack"],
  },
  {
    "name": "confluence",
    "displayName": "Confluence",
    "icon": "confluence.svg",
    "description": "Search, read, and create documentation in Confluence",
    "auth": {
      "type": "oauth2",
      "provider": "atlassian",
      "authorizationUrl": "https://auth.atlassian.com/authorize",
      "tokenUrl": "https://auth.atlassian.com/oauth/token",
      "scopes": ["read:confluence-content.all", "write:confluence-content"],
      "tokenAuthMethod": "client_secret_post",
      "requiredApis": [{
        "name": "Atlassian OAuth 2.0 App",
        "enableUrl": "https://developer.atlassian.com/console/myapps/",
      }],
      "additionalParams": { "audience": "api.atlassian.com", "prompt": "consent" },
      "additionalAuthParams": { "audience": "api.atlassian.com", "prompt": "consent" },
    },
    "envVars": [{
      "name": "ATLASSIAN_CLIENT_ID",
      "description": "Atlassian OAuth Client ID (from your OAuth 2.0 app)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://developer.atlassian.com/console/myapps/",
    }, {
      "name": "ATLASSIAN_CLIENT_SECRET",
      "description": "Atlassian OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://developer.atlassian.com/console/myapps/",
    }],
    "tools": [{
      "id": "list_sites",
      "name": "List Atlassian Sites",
      "description":
        "List Atlassian cloud sites/resources the OAuth token can access; use the returned id as cloudId for Jira and Confluence tools",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/oauth/token/accessible-resources",
        "response": { "transform": "" },
      },
    }, {
      "id": "search_content",
      "name": "Search Confluence",
      "description": "Search for pages and blog posts in Confluence",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/content/search",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "cql": {
            "type": "string",
            "in": "query",
            "description": "Confluence Query Language expression",
            "required": true,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum results to return",
            "default": 25,
          },
          "start": {
            "type": "number",
            "in": "query",
            "description": "Pagination offset",
            "default": 0,
          },
          "expand": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated expansions",
            "default": "space,version",
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "get_page",
      "name": "Get Page",
      "description": "Get the content of a specific Confluence page (uses v2 API)",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "pageId": {
            "type": "string",
            "in": "path",
            "description": "Confluence page ID",
            "required": true,
          },
          "body-format": {
            "type": "string",
            "in": "query",
            "description": "Body representation format",
            "default": "storage",
          },
        },
      },
    }, {
      "id": "create_page",
      "name": "Create Page",
      "description":
        "Create a new page in a Confluence space (uses v2 API; requires spaceId from list_spaces)",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/pages",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
        },
        "body": {
          "spaceId": {
            "type": "string",
            "description": "Numeric space ID (use list_spaces to get the id field)",
            "required": true,
          },
          "title": { "type": "string", "description": "Page title", "required": true },
          "status": { "type": "string", "description": "Page status", "default": "current" },
          "parentId": { "type": "string", "description": "Parent page ID (optional)" },
          "body": {
            "type": "object",
            "description": "Page body, e.g. {representation: 'storage', value: '<p>content</p>'}",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_page",
      "name": "Update Page",
      "description":
        "Update the content of an existing Confluence page (uses v2 API; version.number must be current+1)",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/api/v2/pages/{pageId}",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "pageId": {
            "type": "string",
            "in": "path",
            "description": "Confluence page ID",
            "required": true,
          },
        },
        "body": {
          "id": {
            "type": "string",
            "description": "Page ID (must match pageId path param)",
            "required": true,
          },
          "status": { "type": "string", "description": "Page status", "default": "current" },
          "title": { "type": "string", "description": "New page title (omit to keep existing)" },
          "version": {
            "type": "object",
            "description": "Version object; number must be current version + 1",
            "required": true,
          },
          "body": {
            "type": "object",
            "description": "Updated body, e.g. {representation: 'storage', value: '<p>...</p>'}",
          },
        },
      },
    }, {
      "id": "list_spaces",
      "name": "List Spaces",
      "description": "List all accessible Confluence spaces",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/confluence/{cloudId}/wiki/rest/api/space",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum spaces to return",
            "default": 25,
          },
          "start": {
            "type": "number",
            "in": "query",
            "description": "Pagination offset",
            "default": 0,
          },
        },
        "response": { "transform": "results" },
      },
    }],
    "prompts": [{
      "id": "search_docs",
      "title": "Search documentation",
      "prompt": "Search Confluence for documentation about a specific topic or feature.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "summarize_page",
      "title": "Summarize a page",
      "prompt": "Read and summarize a Confluence page. Extract key information and action items.",
      "category": "productivity",
      "icon": "document",
    }, {
      "id": "create_doc",
      "title": "Create documentation",
      "prompt": "Create a new documentation page in Confluence with structured content.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "update_doc",
      "title": "Update documentation",
      "prompt":
        "Update an existing Confluence page with new information while preserving existing content.",
      "category": "productivity",
      "icon": "edit",
    }],
    "suggestedWith": ["jira", "slack", "notion"],
  },
  {
    "name": "docs-google",
    "displayName": "Google Docs",
    "icon": "docs-google.svg",
    "description": "Read, create, and manage Google Docs documents",
    "auth": {
      "type": "oauth2",
      "provider": "google",
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
      "tokenUrl": "https://oauth2.googleapis.com/token",
      "scopes": [
        "https://www.googleapis.com/auth/documents.readonly",
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
      "requiredApis": [{
        "name": "Google Docs API",
        "enableUrl": "https://console.cloud.google.com/apis/library/docs.googleapis.com",
      }, {
        "name": "Google Drive API",
        "enableUrl": "https://console.cloud.google.com/apis/library/drive.googleapis.com",
      }],
    },
    "envVars": [{
      "name": "GOOGLE_CLIENT_ID",
      "description": "Google OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }, {
      "name": "GOOGLE_CLIENT_SECRET",
      "description": "Google OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }],
    "tools": [{
      "id": "list_documents",
      "name": "List Documents",
      "description": "List recent Google Docs documents from Drive",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Drive query limited to Google Docs documents",
            "default": "mimeType='application/vnd.google-apps.document' and trashed=false",
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of documents to return",
            "default": 100,
          },
          "pageToken": { "type": "string", "in": "query", "description": "Pagination token" },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "nextPageToken, files(id, name, webViewLink, modifiedTime)",
          },
        },
        "response": { "transform": "files" },
      },
    }, {
      "id": "get_document",
      "name": "Get Document",
      "description": "Get document content and metadata",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://docs.googleapis.com/v1/documents/{documentId}",
        "params": {
          "documentId": {
            "type": "string",
            "in": "path",
            "description": "Google Docs document ID",
            "required": true,
          },
          "suggestionsViewMode": {
            "type": "string",
            "in": "query",
            "description": "Suggestions view mode to use when reading the document",
          },
        },
      },
    }, {
      "id": "create_document",
      "name": "Create Document",
      "description": "Create a new document with optional initial content",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://docs.googleapis.com/v1/documents",
        "body": {
          "title": { "type": "string", "description": "Document title", "required": true },
        },
      },
    }, {
      "id": "update_document",
      "name": "Update Document",
      "description": "Update document content using batch requests",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://docs.googleapis.com/v1/documents/{documentId}:batchUpdate",
        "params": {
          "documentId": {
            "type": "string",
            "in": "path",
            "description": "Google Docs document ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description":
              "Google Docs batchUpdate requests, e.g. insertText/updateTextStyle requests",
            "required": true,
          },
          "writeControl": { "type": "object", "description": "Optional Google Docs write control" },
        },
      },
    }, {
      "id": "search_documents",
      "name": "Search Documents",
      "description": "Search for documents by query string",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Drive query expression for Google Docs documents",
            "required": true,
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of documents to return",
            "default": 100,
          },
          "pageToken": { "type": "string", "in": "query", "description": "Pagination token" },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "nextPageToken, files(id, name, webViewLink, modifiedTime)",
          },
        },
        "response": { "transform": "files" },
      },
    }],
    "prompts": [{
      "id": "summarize_doc",
      "title": "Summarize a document",
      "prompt":
        "Read a Google Docs document and provide a concise summary of its contents, key points, and main themes.",
      "category": "productivity",
      "icon": "file-text",
    }, {
      "id": "create_report",
      "title": "Create a report document",
      "prompt":
        "Create a new Google Docs document with a well-formatted report including headings, bullet points, and structured content.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "edit_document",
      "title": "Edit a document",
      "prompt":
        "Update an existing Google Docs document with new content, formatting changes, or corrections.",
      "category": "productivity",
      "icon": "edit",
    }],
    "suggestedWith": ["gmail", "calendar", "drive", "sheets"],
  },
  {
    "name": "drive",
    "displayName": "Google Drive",
    "icon": "drive.svg",
    "description": "Access, search, and manage files and folders in Google Drive",
    "auth": {
      "type": "oauth2",
      "provider": "google",
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
      "tokenUrl": "https://oauth2.googleapis.com/token",
      "scopes": [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ],
      "requiredApis": [{
        "name": "Google Drive API",
        "enableUrl": "https://console.cloud.google.com/apis/library/drive.googleapis.com",
      }],
    },
    "envVars": [{
      "name": "GOOGLE_CLIENT_ID",
      "description": "Google OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }, {
      "name": "GOOGLE_CLIENT_SECRET",
      "description": "Google OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }],
    "tools": [{
      "id": "list_files",
      "name": "List Files",
      "description": "List files and folders in a Google Drive folder or root",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Optional Drive query expression",
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of files to return",
            "default": 100,
          },
          "pageToken": { "type": "string", "in": "query", "description": "Pagination token" },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default":
              "nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, size, parents)",
          },
        },
        "response": { "transform": "files" },
      },
    }, {
      "id": "get_file",
      "name": "Get File",
      "description": "Get metadata and details about a specific file or folder",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files/{fileId}",
        "params": {
          "fileId": {
            "type": "string",
            "in": "path",
            "description": "Google Drive file ID",
            "required": true,
          },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "id, name, mimeType, webViewLink, modifiedTime, size, parents",
          },
        },
      },
    }, {
      "id": "search_files",
      "name": "Search Files",
      "description": "Search for files and folders using queries",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Drive query expression used to search files",
            "required": true,
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of files to return",
            "default": 100,
          },
          "pageToken": { "type": "string", "in": "query", "description": "Pagination token" },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default":
              "nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime, size, parents)",
          },
        },
        "response": { "transform": "files" },
      },
    }, {
      "id": "create_folder",
      "name": "Create Folder",
      "description": "Create a new folder in Google Drive",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://www.googleapis.com/drive/v3/files",
        "body": {
          "name": { "type": "string", "description": "Folder name", "required": true },
          "mimeType": {
            "type": "string",
            "description": "Google Drive MIME type for folders",
            "default": "application/vnd.google-apps.folder",
          },
          "parents": { "type": "array", "description": "Optional parent folder IDs" },
        },
      },
    }, {
      "id": "upload_file",
      "name": "Upload File",
      "description": "Upload or create a file in Google Drive",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://www.googleapis.com/upload/drive/v3/files",
        "params": {
          "uploadType": {
            "type": "string",
            "in": "query",
            "description": "Google Drive upload mode",
            "default": "media",
          },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "id, name, mimeType, webViewLink, modifiedTime, size, parents",
          },
        },
        "body": {
          "content": {
            "type": "string",
            "description": "Text content to upload",
            "required": true,
          },
          "mimeType": {
            "type": "string",
            "description": "Content MIME type",
            "default": "text/plain",
          },
          "name": {
            "type": "string",
            "description": "Desired file name; use create_folder for folders",
            "required": false,
          },
          "parents": { "type": "array", "description": "Optional parent folder IDs" },
        },
      },
    }, {
      "id": "update_file",
      "name": "Update File",
      "description":
        "Rename a file, update its description, or move it to a different folder in Google Drive",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://www.googleapis.com/drive/v3/files/{fileId}",
        "params": {
          "fileId": {
            "type": "string",
            "in": "path",
            "description": "Google Drive file ID to update",
            "required": true,
          },
          "addParents": {
            "type": "string",
            "in": "query",
            "description":
              "Comma-separated parent folder IDs to add (use with removeParents to move)",
          },
          "removeParents": {
            "type": "string",
            "in": "query",
            "description":
              "Comma-separated parent folder IDs to remove (use with addParents to move)",
          },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "id, name, mimeType, webViewLink, modifiedTime, parents",
          },
        },
        "body": {
          "name": { "type": "string", "description": "New file name" },
          "description": { "type": "string", "description": "New file description" },
        },
      },
    }, {
      "id": "delete_file",
      "name": "Delete File",
      "description": "Permanently delete a file or folder from Google Drive",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://www.googleapis.com/drive/v3/files/{fileId}",
        "params": {
          "fileId": {
            "type": "string",
            "in": "path",
            "description": "Google Drive file ID to delete",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "organize_files",
      "title": "Organize Drive files",
      "prompt":
        "Help me organize files in Google Drive by creating folders and moving files based on file types or names.",
      "category": "productivity",
      "icon": "folder",
    }, {
      "id": "find_document",
      "title": "Find a document",
      "prompt": "Search Google Drive for a specific file or document by name, type, or content.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "backup_files",
      "title": "Create backup structure",
      "prompt": "Create a backup folder structure in Google Drive and organize important files.",
      "category": "productivity",
      "icon": "upload",
    }],
    "suggestedWith": ["gmail", "calendar", "sheets"],
  },
  {
    "name": "figma",
    "displayName": "Figma",
    "icon": "figma.svg",
    "description": "Access Figma designs, files, comments, and collaborate on design projects",
    "auth": {
      "type": "oauth2",
      "provider": "figma",
      "authorizationUrl": "https://www.figma.com/oauth",
      "tokenUrl": "https://api.figma.com/v1/oauth/token",
      "scopes": [
        "current_user:read",
        "file_content:read",
        "file_comments:read",
        "file_comments:write",
      ],
      "tokenAuthMethod": "client_secret_basic",
      "requiredApis": [{
        "name": "Figma OAuth App",
        "enableUrl": "https://www.figma.com/developers/apps",
      }],
    },
    "envVars": [{
      "name": "FIGMA_CLIENT_ID",
      "description": "Figma OAuth Client ID (from your app settings)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://www.figma.com/developers/apps",
    }, {
      "name": "FIGMA_CLIENT_SECRET",
      "description": "Figma OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://www.figma.com/developers/apps",
    }],
    "tools": [{
      "id": "get_me",
      "name": "Get Me",
      "description":
        "Get the authenticated user's Figma profile (id, email, handle). Use this to verify the connection and identify the user.",
      "requiresWrite": false,
      "endpoint": { "method": "GET", "url": "https://api.figma.com/v1/me" },
    }, {
      "id": "list_files",
      "name": "List Files",
      "description": "List recent Figma files accessible to the user",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.figma.com/v1/projects/{projectId}/files",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "Figma project ID whose files should be listed",
            "required": true,
          },
          "branch_data": {
            "type": "boolean",
            "in": "query",
            "description": "Include branch metadata",
            "default": false,
          },
        },
      },
    }, {
      "id": "get_file",
      "name": "Get File",
      "description": "Get detailed information about a Figma file including components and styles",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.figma.com/v1/files/{fileKey}",
        "params": {
          "fileKey": {
            "type": "string",
            "in": "path",
            "description": "Figma file key",
            "required": true,
          },
          "ids": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated node IDs to include",
          },
          "depth": {
            "type": "number",
            "in": "query",
            "description": "Traversal depth for document tree",
          },
          "geometry": {
            "type": "string",
            "in": "query",
            "description": "Set to paths to export vector data",
          },
          "plugin_data": {
            "type": "string",
            "in": "query",
            "description": "Plugin data namespace to include",
          },
        },
      },
    }, {
      "id": "get_comments",
      "name": "Get Comments",
      "description": "Get all comments on a Figma file",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.figma.com/v1/files/{fileKey}/comments",
        "params": {
          "fileKey": {
            "type": "string",
            "in": "path",
            "description": "Figma file key",
            "required": true,
          },
        },
        "response": { "transform": "comments" },
      },
    }, {
      "id": "post_comment",
      "name": "Post Comment",
      "description": "Post a comment on a Figma file",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.figma.com/v1/files/{fileKey}/comments",
        "params": {
          "fileKey": {
            "type": "string",
            "in": "path",
            "description": "Figma file key",
            "required": true,
          },
        },
        "body": {
          "message": { "type": "string", "description": "Comment text", "required": true },
          "client_meta": {
            "type": "object",
            "description": "Optional Figma comment position metadata",
          },
        },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description":
        "List all projects in a team. The teamId is the numeric ID found in the Figma URL: figma.com/files/team/{teamId}/...",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.figma.com/v1/teams/{teamId}/projects",
        "params": {
          "teamId": {
            "type": "string",
            "in": "path",
            "description": "Numeric Figma team ID from the URL: figma.com/files/team/{teamId}/...",
            "required": true,
          },
        },
        "response": { "transform": "projects" },
      },
    }],
    "prompts": [{
      "id": "review_design",
      "title": "Review a design",
      "prompt":
        "Review a Figma design file and provide feedback on the components, layout, and design system usage.",
      "category": "design",
      "icon": "eye",
    }, {
      "id": "summarize_comments",
      "title": "Summarize comments",
      "prompt":
        "Read all comments on a Figma file and summarize the feedback, action items, and unresolved discussions.",
      "category": "design",
      "icon": "message",
    }, {
      "id": "extract_components",
      "title": "Extract components",
      "prompt":
        "List all components in a Figma file and describe their structure, variants, and properties.",
      "category": "design",
      "icon": "component",
    }, {
      "id": "design_feedback",
      "title": "Give design feedback",
      "prompt":
        "Review the design file and post constructive feedback as comments on specific elements.",
      "category": "design",
      "icon": "plus",
    }],
    "suggestedWith": ["linear", "slack", "notion"],
  },
  {
    "name": "github",
    "displayName": "GitHub",
    "icon": "github.svg",
    "description": "Manage repositories, issues, and pull requests",
    "auth": {
      "type": "oauth2",
      "provider": "github",
      "authorizationUrl": "https://github.com/login/oauth/authorize",
      "tokenUrl": "https://github.com/login/oauth/access_token",
      "scopes": ["repo", "read:user", "read:org"],
    },
    "envVars": [{
      "name": "GITHUB_CLIENT_ID",
      "description": "GitHub OAuth App Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://github.com/settings/developers",
    }, {
      "name": "GITHUB_CLIENT_SECRET",
      "description": "GitHub OAuth App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://github.com/settings/developers",
    }],
    "tools": [{
      "id": "get_current_user",
      "name": "Get Current User",
      "description": "Get the authenticated GitHub user identity",
      "requiresWrite": false,
      "endpoint": { "method": "GET", "url": "https://api.github.com/user" },
    }, {
      "id": "list_repos",
      "name": "List Repositories",
      "description": "Get list of user's repositories",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/user/repos",
        "params": {
          "type": {
            "type": "string",
            "in": "query",
            "description": "Type: all, owner, public, private, member",
          },
          "sort": {
            "type": "string",
            "in": "query",
            "description": "Sort: created, updated, pushed, full_name",
            "default": "updated",
          },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 30,
          },
          "page": { "type": "number", "in": "query", "description": "Page number for pagination" },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["repositories", "data"],
            "collectionName": "repositories",
            "itemFields": [
              { "name": "id" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "full_name" },
              { "name": "owner", "kind": "contact" },
              { "name": "html_url" },
              { "name": "private" },
              { "name": "archived" },
              { "name": "open_issues_count" },
              { "name": "default_branch" },
              { "name": "updated_at" },
              { "name": "pushed_at" },
            ],
            "omitted": "repository descriptions and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_user",
      "name": "Get User",
      "description":
        "Get a GitHub user profile by username. Use this to verify repository owners, assignees, and other GitHub usernames before acting.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/users/{username}",
        "params": {
          "username": {
            "type": "string",
            "in": "path",
            "description": "GitHub username/login to look up",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_repo",
      "name": "Get Repository",
      "description": "Get details of a specific repository",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_prs",
      "name": "List Pull Requests",
      "description": "Get pull requests for a repository",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}/pulls",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "state": {
            "type": "string",
            "in": "query",
            "description": "State: open, closed, all",
            "default": "open",
          },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page",
            "default": 30,
          },
          "page": { "type": "number", "in": "query", "description": "Page number for pagination" },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["pullRequests", "data"],
            "collectionName": "pullRequests",
            "itemFields": [
              { "name": "id" },
              { "name": "node_id" },
              { "name": "number" },
              { "name": "title" },
              { "name": "state" },
              { "name": "html_url" },
              { "name": "user", "kind": "contact" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "closed_at" },
              { "name": "merged_at" },
              { "name": "draft" },
            ],
            "omitted": "pull request bodies, diff details, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "create_issue",
      "name": "Create Issue",
      "description": "Create a new issue in a repository",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.github.com/repos/{owner}/{repo}/issues",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
        },
        "body": {
          "title": { "type": "string", "description": "Issue title", "required": true },
          "body": { "type": "string", "description": "Issue body (markdown)" },
          "labels": { "type": "array", "description": "Label names" },
          "assignees": { "type": "array", "description": "Usernames to assign" },
        },
      },
    }, {
      "id": "get_pr_diff",
      "name": "Get PR Diff",
      "description": "Get the diff for a pull request",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "pull_number": {
            "type": "number",
            "in": "path",
            "description": "Pull request number",
            "required": true,
          },
          "Accept": {
            "type": "string",
            "in": "header",
            "description": "Response format",
            "default": "application/vnd.github.v3.diff",
          },
        },
      },
    }, {
      "id": "list_issues",
      "name": "List Issues",
      "description": "List issues for a repository",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.github.com/graphql",
        "query":
          "query($owner: String!, $repo: String!, $first: Int, $states: [IssueState!]) { repository(owner: $owner, name: $repo) { issues(first: $first, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { id number title body state url createdAt updatedAt author { login } labels(first: 10) { nodes { name } } assignees(first: 10) { nodes { login } } } pageInfo { hasNextPage endCursor } } } }",
        "params": {
          "owner": {
            "type": "string",
            "in": "body",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "body",
            "description": "Repository name",
            "required": true,
          },
          "states": {
            "type": "string[]",
            "in": "body",
            "description": "Issue states to include (e.g. OPEN, CLOSED)",
            "default": ["OPEN"],
          },
          "first": {
            "type": "number",
            "in": "body",
            "description": "Results per page",
            "default": 30,
          },
        },
        "response": {
          "transform": "repository.issues.nodes",
          "historicalSummary": {
            "collectionKeys": ["issues", "nodes", "data"],
            "collectionName": "issues",
            "itemFields": [
              { "name": "id" },
              { "name": "node_id" },
              { "name": "number" },
              { "name": "title" },
              { "name": "state" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "author", "kind": "contact" },
              { "name": "user", "kind": "contact" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "created_at" },
              { "name": "updated_at" },
            ],
            "outputFields": [{ "name": "pageInfo", "kind": "object" }],
            "omitted": "issue bodies, comments, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_issue",
      "name": "Get Issue",
      "description": "Get details of a GitHub issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "issue_number": {
            "type": "number",
            "in": "path",
            "description": "Issue number",
            "required": true,
          },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["issue", "data"],
            "collectionName": "issues",
            "itemFields": [
              { "name": "id" },
              { "name": "node_id" },
              { "name": "number" },
              { "name": "title" },
              { "name": "state" },
              { "name": "html_url" },
              { "name": "url" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "closed_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
            ],
            "singleItem": true,
            "omitted": "issue body, comments, timeline, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "update_issue",
      "name": "Update Issue",
      "description": "Update, close, or reopen a GitHub issue",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "issue_number": {
            "type": "number",
            "in": "path",
            "description": "Issue number",
            "required": true,
          },
        },
        "body": {
          "title": { "type": "string", "description": "Updated issue title" },
          "body": { "type": "string", "description": "Updated issue body (markdown)" },
          "state": { "type": "string", "description": "Issue state: open or closed" },
          "labels": { "type": "array", "description": "Replacement label names" },
          "assignees": { "type": "array", "description": "Replacement assignee usernames" },
        },
      },
    }, {
      "id": "add_issue_comment",
      "name": "Add Issue Comment",
      "description": "Add a comment to a GitHub issue or pull request",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}/comments",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "issue_number": {
            "type": "number",
            "in": "path",
            "description": "Issue or pull request number",
            "required": true,
          },
        },
        "body": {
          "body": { "type": "string", "description": "Comment body (markdown)", "required": true },
        },
      },
    }, {
      "id": "get_pr",
      "name": "Get Pull Request",
      "description":
        "Get details of a specific pull request (title, body, status, author, reviewers, labels)",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "pull_number": {
            "type": "number",
            "in": "path",
            "description": "Pull request number",
            "required": true,
          },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["pullRequest", "data"],
            "collectionName": "pullRequests",
            "itemFields": [
              { "name": "id" },
              { "name": "node_id" },
              { "name": "number" },
              { "name": "title" },
              { "name": "state" },
              { "name": "html_url" },
              { "name": "url" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "closed_at" },
              { "name": "merged_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "draft" },
              { "name": "mergeable" },
            ],
            "singleItem": true,
            "omitted": "pull request body, diff, reviews, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "create_pr",
      "name": "Create Pull Request",
      "description": "Create a new pull request in a repository",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.github.com/repos/{owner}/{repo}/pulls",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
        },
        "body": {
          "title": { "type": "string", "description": "PR title", "required": true },
          "body": { "type": "string", "description": "PR description (markdown)" },
          "head": {
            "type": "string",
            "description": "Branch to merge from (e.g. feature-branch or owner:feature-branch)",
            "required": true,
          },
          "base": {
            "type": "string",
            "description": "Branch to merge into (e.g. main)",
            "required": true,
          },
          "draft": { "type": "boolean", "description": "Create as draft PR", "default": false },
        },
      },
    }, {
      "id": "merge_pr",
      "name": "Merge Pull Request",
      "description": "Merge an open pull request",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://api.github.com/repos/{owner}/{repo}/pulls/{pull_number}/merge",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "pull_number": {
            "type": "number",
            "in": "path",
            "description": "Pull request number to merge",
            "required": true,
          },
        },
        "body": {
          "commit_title": { "type": "string", "description": "Merge commit title" },
          "commit_message": { "type": "string", "description": "Merge commit message" },
          "merge_method": {
            "type": "string",
            "description": "Merge method: merge, squash, or rebase",
            "default": "merge",
          },
        },
      },
    }, {
      "id": "list_commits",
      "name": "List Commits",
      "description": "List commits for a repository, branch, or file path",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.github.com/repos/{owner}/{repo}/commits",
        "params": {
          "owner": {
            "type": "string",
            "in": "path",
            "description": "Repository owner",
            "required": true,
          },
          "repo": {
            "type": "string",
            "in": "path",
            "description": "Repository name",
            "required": true,
          },
          "sha": {
            "type": "string",
            "in": "query",
            "description": "SHA or branch name to list commits from",
          },
          "path": {
            "type": "string",
            "in": "query",
            "description": "Only include commits touching this file path",
          },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 30,
          },
          "page": { "type": "number", "in": "query", "description": "Page number for pagination" },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["commits", "data"],
            "collectionName": "commits",
            "itemFields": [{ "name": "sha" }, { "name": "node_id" }, { "name": "html_url" }, {
              "name": "author",
              "kind": "contact",
            }, { "name": "committer", "kind": "contact" }],
            "omitted": "full commit messages, verification payloads, and file details",
          },
        },
      },
    }],
    "prompts": [{
      "id": "review_prs",
      "title": "Review my open PRs",
      "prompt":
        "Show me my open pull requests and help me review them. Summarize the changes and any comments.",
      "category": "development",
      "icon": "git-pull-request",
    }, {
      "id": "create_issue",
      "title": "Create GitHub issue",
      "prompt":
        "Help me create a new GitHub issue with a clear description and appropriate labels.",
      "category": "development",
      "icon": "circle-dot",
    }, {
      "id": "summarize_commits",
      "title": "Summarize recent commits",
      "prompt": "Summarize the recent commits in my repository and highlight significant changes.",
      "category": "development",
      "icon": "git-commit",
    }],
    "suggestedWith": ["jira", "slack"],
  },
  {
    "name": "gitlab",
    "displayName": "GitLab",
    "icon": "gitlab.svg",
    "description": "Search and manage GitLab issues, merge requests, and projects",
    "auth": {
      "type": "oauth2",
      "provider": "gitlab",
      "authorizationUrl": "https://gitlab.com/oauth/authorize",
      "tokenUrl": "https://gitlab.com/oauth/token",
      "scopes": ["api", "read_user", "read_repository"],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "GitLab Application",
        "enableUrl": "https://gitlab.com/-/profile/applications",
      }],
    },
    "envVars": [{
      "name": "GITLAB_CLIENT_ID",
      "description": "GitLab OAuth Application ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.gitlab.com/ee/api/oauth2.html",
    }, {
      "name": "GITLAB_CLIENT_SECRET",
      "description": "GitLab OAuth Application Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://docs.gitlab.com/ee/api/oauth2.html",
    }],
    "tools": [{
      "id": "list_projects",
      "name": "List Projects",
      "description": "List accessible GitLab projects",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/projects",
        "params": {
          "membership": {
            "type": "boolean",
            "in": "query",
            "description": "Only return projects the user is a member of",
            "default": true,
          },
          "search": { "type": "string", "in": "query", "description": "Search text for projects" },
          "simple": {
            "type": "boolean",
            "in": "query",
            "description": "Return simplified project objects",
            "default": true,
          },
          "page": { "type": "number", "in": "query", "description": "Result page", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page",
            "default": 20,
          },
        },
      },
    }, {
      "id": "get_project",
      "name": "Get Project",
      "description": "Get detailed information about a GitLab project",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/projects/{projectId}",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
        },
      },
    }, {
      "id": "search_issues",
      "name": "Search Issues",
      "description": "Search for issues across projects",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/issues",
        "params": {
          "search": {
            "type": "string",
            "in": "query",
            "description": "Search text for issue title or description",
          },
          "state": {
            "type": "string",
            "in": "query",
            "description": "Issue state",
            "default": "opened",
          },
          "scope": {
            "type": "string",
            "in": "query",
            "description": "Issue scope such as created_by_me, assigned_to_me, or all",
            "default": "assigned_to_me",
          },
          "labels": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated label names",
          },
          "page": { "type": "number", "in": "query", "description": "Result page", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page",
            "default": 20,
          },
        },
      },
    }, {
      "id": "get_issue",
      "name": "Get Issue",
      "description": "Get detailed information about a specific issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/projects/{projectId}/issues/{issueIid}",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
          "issueIid": {
            "type": "number",
            "in": "path",
            "description": "Project-local issue IID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_issue",
      "name": "Create Issue",
      "description": "Create a new issue in a project",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gitlab.com/api/v4/projects/{projectId}/issues",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
        },
        "body": {
          "title": { "type": "string", "description": "Issue title", "required": true },
          "description": { "type": "string", "description": "Issue description" },
          "labels": { "type": "string", "description": "Comma-separated labels" },
          "assignee_ids": { "type": "array", "description": "GitLab user IDs to assign" },
        },
      },
    }, {
      "id": "update_issue",
      "name": "Update Issue",
      "description": "Update, close, or reopen a GitLab issue",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://gitlab.com/api/v4/projects/{projectId}/issues/{issueIid}",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
          "issueIid": {
            "type": "number",
            "in": "path",
            "description": "Project-local issue IID",
            "required": true,
          },
        },
        "body": {
          "title": { "type": "string", "description": "Updated issue title" },
          "description": { "type": "string", "description": "Updated issue description" },
          "state_event": { "type": "string", "description": "close or reopen" },
          "labels": { "type": "string", "description": "Comma-separated replacement labels" },
          "assignee_ids": { "type": "array", "description": "GitLab user IDs to assign" },
        },
      },
    }, {
      "id": "add_issue_comment",
      "name": "Add Issue Comment",
      "description": "Add a comment/note to a GitLab issue",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gitlab.com/api/v4/projects/{projectId}/issues/{issueIid}/notes",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
          "issueIid": {
            "type": "number",
            "in": "path",
            "description": "Project-local issue IID",
            "required": true,
          },
        },
        "body": {
          "body": { "type": "string", "description": "Comment body in Markdown", "required": true },
          "confidential": {
            "type": "boolean",
            "description": "Make the note visible only to project members",
          },
        },
      },
    }, {
      "id": "list_merge_requests",
      "name": "List Merge Requests",
      "description": "List merge requests for a project or across projects",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/merge_requests",
        "params": {
          "state": {
            "type": "string",
            "in": "query",
            "description": "Merge request state",
            "default": "opened",
          },
          "scope": {
            "type": "string",
            "in": "query",
            "description": "Merge request scope such as created_by_me, assigned_to_me, or all",
            "default": "assigned_to_me",
          },
          "search": {
            "type": "string",
            "in": "query",
            "description": "Search text for merge requests",
          },
          "page": { "type": "number", "in": "query", "description": "Result page", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page",
            "default": 20,
          },
        },
      },
    }, {
      "id": "get_merge_request",
      "name": "Get Merge Request",
      "description": "Get detailed information about a specific GitLab merge request",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gitlab.com/api/v4/projects/{projectId}/merge_requests/{mergeRequestIid}",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
          "mergeRequestIid": {
            "type": "number",
            "in": "path",
            "description": "Project-local merge request IID",
            "required": true,
          },
        },
      },
    }, {
      "id": "add_merge_request_comment",
      "name": "Add Merge Request Comment",
      "description": "Add a comment/note to a GitLab merge request",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url":
          "https://gitlab.com/api/v4/projects/{projectId}/merge_requests/{mergeRequestIid}/notes",
        "params": {
          "projectId": {
            "type": "string",
            "in": "path",
            "description": "GitLab numeric project ID or raw namespace/project path",
            "required": true,
          },
          "mergeRequestIid": {
            "type": "number",
            "in": "path",
            "description": "Project-local merge request IID",
            "required": true,
          },
        },
        "body": {
          "body": { "type": "string", "description": "Comment body in Markdown", "required": true },
          "internal": { "type": "boolean", "description": "Make the note internal when supported" },
        },
      },
    }],
    "prompts": [{
      "id": "find_issues",
      "title": "Find my issues",
      "prompt": "Search for issues assigned to me that are open. Show me the most important ones.",
      "category": "development",
      "icon": "bug",
    }, {
      "id": "review_mrs",
      "title": "Review merge requests",
      "prompt":
        "Show me all open merge requests that need my review. Summarize what each one does.",
      "category": "development",
      "icon": "git-merge",
    }, {
      "id": "create_bug_report",
      "title": "Create bug report",
      "prompt":
        "Help me create a detailed bug report issue with steps to reproduce, expected vs actual behavior.",
      "category": "development",
      "icon": "plus",
    }, {
      "id": "project_status",
      "title": "Project status",
      "prompt":
        "Give me a summary of my projects: open issues, merge requests, and recent activity.",
      "category": "development",
      "icon": "list",
    }],
    "suggestedWith": ["github", "jira", "slack"],
  },
  {
    "name": "gmail",
    "displayName": "Gmail",
    "icon": "gmail.svg",
    "description": "Read and send emails via Gmail API",
    "auth": {
      "type": "oauth2",
      "provider": "google",
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
      "tokenUrl": "https://oauth2.googleapis.com/token",
      "scopes": [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.labels",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://mail.google.com/",
      ],
      "requiredApis": [{
        "name": "Gmail API",
        "enableUrl": "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
      }],
    },
    "envVars": [{
      "name": "GOOGLE_CLIENT_ID",
      "description": "Google OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }, {
      "name": "GOOGLE_CLIENT_SECRET",
      "description": "Google OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }],
    "tools": [{
      "id": "list_emails",
      "name": "List Emails",
      "description":
        "List Gmail message summaries with IDs, sender, recipient, subject, date, snippet, labels, and pagination tokens. Use get-email only when full message content is needed.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "params": {
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of message summaries to return (1-50)",
            "default": 20,
          },
          "q": {
            "type": "string",
            "in": "query",
            "description": "Gmail search query (e.g. is:unread, from:user@example.com)",
          },
          "labelIds": {
            "type": "string[]",
            "in": "query",
            "description": "Only return messages with these label IDs (e.g. INBOX, UNREAD)",
          },
          "pageToken": {
            "type": "string",
            "in": "query",
            "description": "Page token for pagination",
          },
        },
        "response": {
          "enrich": {
            "type": "gmail-message-metadata",
            "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}",
            "idField": "id",
            "metadataHeaders": ["From", "To", "Subject", "Date"],
            "maxItems": 50,
          },
          "historicalSummary": {
            "collectionKeys": ["messages", "data"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "threadId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "to" },
              { "name": "subject" },
              { "name": "date" },
              { "name": "internalDate" },
              { "name": "snippet", "maxLength": 300 },
              { "name": "labelIds", "kind": "string-array" },
              { "name": "isUnread" },
              { "name": "unread" },
            ],
            "outputFields": [{ "name": "nextPageToken" }, { "name": "resultSizeEstimate" }],
            "omitted": "large email bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "send_email",
      "name": "Send Email",
      "description": "Send an email to recipients",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        "body": {
          "raw": {
            "type": "string",
            "description": "Base64url-encoded RFC 2822 email message",
            "required": true,
          },
          "threadId": { "type": "string", "description": "Thread ID for a reply" },
        },
      },
    }, {
      "id": "get_email",
      "name": "Get Email",
      "description": "Get a specific email by ID with full content",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
          "format": {
            "type": "string",
            "in": "query",
            "description": "Format: full, metadata, minimal, raw",
            "default": "full",
          },
          "metadataHeaders": {
            "type": "string[]",
            "in": "query",
            "description":
              "Headers to include when format is metadata, e.g. From, To, Subject, Date",
          },
        },
      },
    }, {
      "id": "search_emails",
      "name": "Search Emails",
      "description":
        "Search Gmail messages and return summaries with IDs, sender, recipient, subject, date, snippet, labels, and pagination tokens.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Gmail search query",
            "required": true,
          },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of message summaries to return (1-50)",
            "default": 10,
          },
          "pageToken": {
            "type": "string",
            "in": "query",
            "description": "Page token for pagination",
          },
        },
        "response": {
          "enrich": {
            "type": "gmail-message-metadata",
            "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}",
            "idField": "id",
            "metadataHeaders": ["From", "To", "Subject", "Date"],
            "maxItems": 50,
          },
          "historicalSummary": {
            "collectionKeys": ["messages", "data"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "threadId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "to" },
              { "name": "subject" },
              { "name": "date" },
              { "name": "internalDate" },
              { "name": "snippet", "maxLength": 300 },
              { "name": "labelIds", "kind": "string-array" },
              { "name": "isUnread" },
              { "name": "unread" },
            ],
            "outputFields": [{ "name": "nextPageToken" }, { "name": "resultSizeEstimate" }],
            "omitted": "large email bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "mark_email_read",
      "name": "Mark Email Read",
      "description": "Mark an email as read",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/modify",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
        "body": {
          "removeLabelIds": {
            "type": "array",
            "description": "Label IDs to remove, use UNREAD",
            "default": ["UNREAD"],
          },
        },
      },
    }, {
      "id": "archive_email",
      "name": "Archive Email",
      "description": "Archive an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/modify",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
        "body": {
          "removeLabelIds": {
            "type": "array",
            "description": "Label IDs to remove, use INBOX",
            "default": ["INBOX"],
          },
        },
      },
    }, {
      "id": "list_labels",
      "name": "List Labels",
      "description": "List Gmail labels",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        "response": {
          "transform": "labels",
          "historicalSummary": {
            "collectionKeys": ["labels", "data"],
            "collectionName": "labels",
            "itemFields": [{ "name": "id" }, { "name": "name" }, { "name": "type" }],
            "omitted": "label counters and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_label",
      "name": "Get Label",
      "description": "Get a Gmail label",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/labels/{labelId}",
        "params": {
          "labelId": {
            "type": "string",
            "in": "path",
            "description": "Label ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_label",
      "name": "Create Label",
      "description": "Create a Gmail user label",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/labels",
        "body": {
          "name": { "type": "string", "description": "Label display name", "required": true },
          "messageListVisibility": {
            "type": "string",
            "description": "Message list visibility: show or hide",
          },
          "labelListVisibility": { "type": "string", "description": "Label list visibility" },
          "color": { "type": "object", "description": "Label color object" },
        },
      },
    }, {
      "id": "update_label",
      "name": "Update Label",
      "description": "Update a Gmail user label",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/labels/{labelId}",
        "params": {
          "labelId": {
            "type": "string",
            "in": "path",
            "description": "Label ID",
            "required": true,
          },
        },
        "body": {
          "name": { "type": "string", "description": "Label display name", "required": true },
          "messageListVisibility": {
            "type": "string",
            "description": "Message list visibility: show or hide",
          },
          "labelListVisibility": { "type": "string", "description": "Label list visibility" },
          "color": { "type": "object", "description": "Label color object" },
        },
      },
    }, {
      "id": "delete_label",
      "name": "Delete Label",
      "description": "Delete a Gmail user label",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/labels/{labelId}",
        "params": {
          "labelId": {
            "type": "string",
            "in": "path",
            "description": "Label ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "apply_labels",
      "name": "Apply Labels",
      "description": "Apply or remove labels on an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/modify",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
        "body": {
          "addLabelIds": { "type": "array", "description": "Label IDs to add" },
          "removeLabelIds": { "type": "array", "description": "Label IDs to remove" },
        },
      },
    }, {
      "id": "modify_email_labels",
      "name": "Modify Email Labels",
      "description": "Modify labels on an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/modify",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
        "body": {
          "addLabelIds": { "type": "array", "description": "Label IDs to add" },
          "removeLabelIds": { "type": "array", "description": "Label IDs to remove" },
        },
      },
    }, {
      "id": "trash_email",
      "name": "Trash Email",
      "description": "Move an email to trash",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/trash",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "untrash_email",
      "name": "Untrash Email",
      "description": "Remove an email from trash",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/untrash",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_email",
      "name": "Delete Email",
      "description": "Permanently delete an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "batch_modify_emails",
      "name": "Batch Modify Emails",
      "description": "Modify labels on multiple emails",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
        "body": {
          "ids": { "type": "array", "description": "Email message IDs", "required": true },
          "addLabelIds": { "type": "array", "description": "Label IDs to add" },
          "removeLabelIds": { "type": "array", "description": "Label IDs to remove" },
        },
      },
    }, {
      "id": "batch_delete_emails",
      "name": "Batch Delete Emails",
      "description": "Permanently delete multiple emails",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchDelete",
        "body": {
          "ids": { "type": "array", "description": "Email message IDs", "required": true },
        },
      },
    }, {
      "id": "list_threads",
      "name": "List Threads",
      "description": "List Gmail threads",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads",
        "params": {
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of threads to return (1-500)",
            "default": 20,
          },
          "q": { "type": "string", "in": "query", "description": "Gmail search query" },
          "labelIds": {
            "type": "string[]",
            "in": "query",
            "description": "Only return threads with these label IDs",
          },
          "pageToken": {
            "type": "string",
            "in": "query",
            "description": "Page token for pagination",
          },
        },
        "response": {
          "transform": "threads",
          "historicalSummary": {
            "collectionKeys": ["threads", "data"],
            "collectionName": "threads",
            "itemFields": [{ "name": "id" }, { "name": "snippet", "maxLength": 300 }, {
              "name": "historyId",
            }],
            "outputFields": [{ "name": "nextPageToken" }, { "name": "resultSizeEstimate" }],
            "omitted": "large thread payloads and provider-specific fields",
          },
        },
      },
    }, {
      "id": "get_thread",
      "name": "Get Thread",
      "description": "Get a Gmail thread",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}",
        "params": {
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Thread ID",
            "required": true,
          },
          "format": {
            "type": "string",
            "in": "query",
            "description": "Format: full, metadata, minimal",
            "default": "full",
          },
        },
      },
    }, {
      "id": "modify_thread_labels",
      "name": "Modify Thread Labels",
      "description": "Modify labels on a Gmail thread",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}/modify",
        "params": {
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Thread ID",
            "required": true,
          },
        },
        "body": {
          "addLabelIds": { "type": "array", "description": "Label IDs to add" },
          "removeLabelIds": { "type": "array", "description": "Label IDs to remove" },
        },
      },
    }, {
      "id": "trash_thread",
      "name": "Trash Thread",
      "description": "Move a Gmail thread to trash",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}/trash",
        "params": {
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Thread ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "untrash_thread",
      "name": "Untrash Thread",
      "description": "Remove a Gmail thread from trash",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}/untrash",
        "params": {
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Thread ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_thread",
      "name": "Delete Thread",
      "description": "Permanently delete a Gmail thread",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/threads/{threadId}",
        "params": {
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Thread ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_draft",
      "name": "Create Draft",
      "description": "Create a Gmail draft",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        "body": {
          "message": {
            "type": "object",
            "description": "Draft message containing raw RFC 2822 content",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_drafts",
      "name": "List Drafts",
      "description": "List Gmail drafts",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts",
        "params": {
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of drafts to return (1-500)",
            "default": 20,
          },
          "q": { "type": "string", "in": "query", "description": "Gmail search query" },
          "pageToken": {
            "type": "string",
            "in": "query",
            "description": "Page token for pagination",
          },
        },
        "response": {
          "transform": "drafts",
          "historicalSummary": {
            "collectionKeys": ["drafts", "data"],
            "collectionName": "drafts",
            "itemFields": [{ "name": "id" }, { "name": "message", "kind": "object" }],
            "outputFields": [{ "name": "nextPageToken" }, { "name": "resultSizeEstimate" }],
            "omitted": "draft message bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_draft",
      "name": "Get Draft",
      "description": "Get a Gmail draft",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts/{draftId}",
        "params": {
          "draftId": {
            "type": "string",
            "in": "path",
            "description": "Draft ID",
            "required": true,
          },
          "format": {
            "type": "string",
            "in": "query",
            "description": "Format: full, metadata, minimal, raw",
            "default": "full",
          },
        },
      },
    }, {
      "id": "update_draft",
      "name": "Update Draft",
      "description": "Replace a Gmail draft",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts/{draftId}",
        "params": {
          "draftId": {
            "type": "string",
            "in": "path",
            "description": "Draft ID",
            "required": true,
          },
        },
        "body": {
          "message": {
            "type": "object",
            "description": "Draft message containing raw RFC 2822 content",
            "required": true,
          },
        },
      },
    }, {
      "id": "send_draft",
      "name": "Send Draft",
      "description": "Send an existing Gmail draft",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts/send",
        "body": { "id": { "type": "string", "description": "Draft ID", "required": true } },
      },
    }, {
      "id": "delete_draft",
      "name": "Delete Draft",
      "description": "Permanently delete a Gmail draft",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/drafts/{draftId}",
        "params": {
          "draftId": {
            "type": "string",
            "in": "path",
            "description": "Draft ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_attachment",
      "name": "Get Attachment",
      "description": "Get a Gmail message attachment",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/{messageId}/attachments/{attachmentId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Email message ID",
            "required": true,
          },
          "attachmentId": {
            "type": "string",
            "in": "path",
            "description": "Attachment ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_profile",
      "name": "Get Profile",
      "description": "Get the Gmail mailbox profile",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      },
    }, {
      "id": "list_history",
      "name": "List History",
      "description": "List Gmail mailbox history changes",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://gmail.googleapis.com/gmail/v1/users/me/history",
        "params": {
          "startHistoryId": {
            "type": "string",
            "in": "query",
            "description": "History ID to start after",
            "required": true,
          },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum history records",
            "default": 100,
          },
          "pageToken": {
            "type": "string",
            "in": "query",
            "description": "Page token for pagination",
          },
          "labelId": {
            "type": "string",
            "in": "query",
            "description": "Only return history for this label",
          },
          "historyTypes": {
            "type": "string[]",
            "in": "query",
            "description": "History event types",
          },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["history", "data"],
            "collectionName": "history",
            "itemFields": [{ "name": "id" }, { "name": "messages", "kind": "object" }, {
              "name": "messagesAdded",
              "kind": "object",
            }, { "name": "messagesDeleted", "kind": "object" }],
            "outputFields": [{ "name": "nextPageToken" }, { "name": "historyId" }],
            "omitted": "history details and provider-specific payload fields",
          },
        },
      },
    }],
    "prompts": [{
      "id": "summarize_emails",
      "title": "Summarize today's emails",
      "prompt":
        "Summarize my unread emails from today. Group them by priority and highlight any that need immediate attention.",
      "category": "productivity",
      "icon": "mail",
    }, {
      "id": "draft_reply",
      "title": "Draft a quick reply",
      "prompt": "Help me draft a reply to my most recent email. Keep it professional and concise.",
      "category": "productivity",
      "icon": "reply",
    }, {
      "id": "find_emails",
      "title": "Find important emails",
      "prompt":
        "Search my emails for important messages from the past week that I might have missed.",
      "category": "productivity",
      "icon": "search",
    }],
    "suggestedWith": ["calendar", "slack"],
  },
  {
    "name": "harvest",
    "displayName": "Harvest",
    "icon": "harvest.svg",
    "description":
      "Track time, manage projects, and control invoices with Harvest — trusted by 70,000+ businesses",
    "auth": {
      "type": "oauth2",
      "provider": "harvest",
      "authorizationUrl": "https://id.getharvest.com/oauth2/authorize",
      "tokenUrl": "https://id.getharvest.com/api/v2/oauth2/token",
      "scopes": [],
      "requiredApis": [{
        "name": "Harvest OAuth2 Application",
        "enableUrl": "https://id.getharvest.com/developers",
      }],
    },
    "envVars": [{
      "name": "HARVEST_CLIENT_ID",
      "description": "Harvest OAuth2 Client ID (from your OAuth2 application in Harvest ID)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://id.getharvest.com/developers",
    }, {
      "name": "HARVEST_CLIENT_SECRET",
      "description": "Harvest OAuth2 Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://id.getharvest.com/developers",
    }],
    "tools": [{
      "id": "list_accounts",
      "name": "List Accounts",
      "description":
        "List all Harvest accounts the authenticated user can access. Call this first to get your Harvest-Account-Id for subsequent API calls.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://id.getharvest.com/api/v2/accounts",
        "response": {
          "transform": "accounts",
          "historicalSummary": {
            "collectionKeys": ["accounts", "data"],
            "collectionName": "accounts",
            "itemFields": [{ "name": "id" }, { "name": "name" }, { "name": "product" }],
            "omitted": "account auth policy and provider-specific fields",
          },
        },
      },
    }, {
      "id": "get_current_user",
      "name": "Get Current User",
      "description":
        "Get the authenticated user's Harvest profile (id, name, email, timezone, roles)",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/users/me",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
        },
      },
    }, {
      "id": "list_users",
      "name": "List Users",
      "description": "List all active users in the Harvest account",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/users",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "is_active": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by active status",
            "default": true,
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return users updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "users",
          "historicalSummary": {
            "collectionKeys": ["users", "data"],
            "collectionName": "users",
            "itemFields": [
              { "name": "id" },
              { "name": "email" },
              { "name": "first_name" },
              { "name": "last_name" },
              { "name": "is_active" },
              { "name": "timezone" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "user rates, avatars, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_time_entries",
      "name": "List Time Entries",
      "description":
        "List time entries (timesheets). Filter by user, project, client, or date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/time_entries",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "user_id": { "type": "number", "in": "query", "description": "Filter by user ID" },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "task_id": { "type": "number", "in": "query", "description": "Filter by task ID" },
          "is_running": {
            "type": "boolean",
            "in": "query",
            "description": "Filter to only currently running timers",
          },
          "is_billed": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by billed status",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Start date (YYYY-MM-DD). Return entries with spent_date >= from.",
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "End date (YYYY-MM-DD). Return entries with spent_date <= to.",
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return entries updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "time_entries",
          "historicalSummary": {
            "collectionKeys": ["time_entries", "data"],
            "collectionName": "timeEntries",
            "itemFields": [
              { "name": "id" },
              { "name": "spent_date" },
              { "name": "hours" },
              { "name": "billable" },
              { "name": "user", "kind": "contact" },
              { "name": "client", "kind": "object" },
              { "name": "project", "kind": "object" },
              { "name": "task", "kind": "object" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "notes, rates, invoice details, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_time_entry",
      "name": "Get Time Entry",
      "description": "Get details of a specific time entry by ID",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/time_entries/{timeEntryId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "timeEntryId": {
            "type": "number",
            "in": "path",
            "description": "Harvest time entry ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_time_entry",
      "name": "Create Time Entry",
      "description":
        "Create a new time entry (timesheet). Provide either hours or start/end times.",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.harvestapp.com/v2/time_entries",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
        },
        "body": {
          "project_id": { "type": "number", "description": "Harvest project ID", "required": true },
          "task_id": { "type": "number", "description": "Harvest task ID", "required": true },
          "spent_date": {
            "type": "string",
            "description": "Date of the time entry (YYYY-MM-DD)",
            "required": true,
          },
          "user_id": {
            "type": "number",
            "description": "User ID to log time for (defaults to authenticated user)",
          },
          "hours": {
            "type": "number",
            "description": "Hours to log (e.g. 1.5). Use instead of started_time/ended_time.",
          },
          "started_time": {
            "type": "string",
            "description":
              "Start time (hh:mmam/pm, e.g. 8:00am). Use with ended_time instead of hours.",
          },
          "ended_time": {
            "type": "string",
            "description":
              "End time (hh:mmam/pm, e.g. 5:30pm). Use with started_time instead of hours.",
          },
          "notes": { "type": "string", "description": "Notes about the time entry" },
          "external_reference": {
            "type": "object",
            "description": "External reference object with id, group_id, account_id, permalink",
          },
        },
      },
    }, {
      "id": "update_time_entry",
      "name": "Update Time Entry",
      "description": "Update an existing time entry",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.harvestapp.com/v2/time_entries/{timeEntryId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "timeEntryId": {
            "type": "number",
            "in": "path",
            "description": "Harvest time entry ID",
            "required": true,
          },
        },
        "body": {
          "project_id": { "type": "number", "description": "Updated project ID" },
          "task_id": { "type": "number", "description": "Updated task ID" },
          "spent_date": { "type": "string", "description": "Updated date (YYYY-MM-DD)" },
          "hours": { "type": "number", "description": "Updated hours" },
          "started_time": { "type": "string", "description": "Updated start time (hh:mmam/pm)" },
          "ended_time": { "type": "string", "description": "Updated end time (hh:mmam/pm)" },
          "notes": { "type": "string", "description": "Updated notes" },
          "is_locked": { "type": "boolean", "description": "Lock/unlock the time entry" },
        },
      },
    }, {
      "id": "delete_time_entry",
      "name": "Delete Time Entry",
      "description": "Delete a time entry. Only unlocked, non-billed entries can be deleted.",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://api.harvestapp.com/v2/time_entries/{timeEntryId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "timeEntryId": {
            "type": "number",
            "in": "path",
            "description": "Harvest time entry ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "stop_timer",
      "name": "Stop Timer",
      "description": "Stop a running timer for a time entry",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.harvestapp.com/v2/time_entries/{timeEntryId}/stop",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "timeEntryId": {
            "type": "number",
            "in": "path",
            "description": "Harvest time entry ID of the running timer",
            "required": true,
          },
        },
      },
    }, {
      "id": "restart_timer",
      "name": "Restart Timer",
      "description": "Restart a stopped timer for a time entry",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.harvestapp.com/v2/time_entries/{timeEntryId}/restart",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "timeEntryId": {
            "type": "number",
            "in": "path",
            "description": "Harvest time entry ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description": "List all projects in the Harvest account",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/projects",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "is_active": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by active status",
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return projects updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "projects",
          "historicalSummary": {
            "collectionKeys": ["projects", "data"],
            "collectionName": "projects",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "code" },
              { "name": "is_active" },
              { "name": "client", "kind": "object" },
              { "name": "updated_at" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "project budgets, notes, rates, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_project",
      "name": "Get Project",
      "description": "Get details of a specific project",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/projects/{projectId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "projectId": {
            "type": "number",
            "in": "path",
            "description": "Harvest project ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_tasks",
      "name": "List Tasks",
      "description": "List all tasks available in the Harvest account",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/tasks",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "is_active": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by active status",
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return tasks updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "tasks",
          "historicalSummary": {
            "collectionKeys": ["tasks", "data"],
            "collectionName": "tasks",
            "itemFields": [{ "name": "id" }, { "name": "name" }, { "name": "is_active" }, {
              "name": "is_default",
            }, { "name": "updated_at" }],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "task rates and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_project_task_assignments",
      "name": "List Project Task Assignments",
      "description":
        "List all task assignments for a specific project (tasks billable to this project)",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/projects/{projectId}/task_assignments",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "projectId": {
            "type": "number",
            "in": "path",
            "description": "Harvest project ID",
            "required": true,
          },
          "is_active": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by active status",
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return task assignments updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "task_assignments",
          "historicalSummary": {
            "collectionKeys": ["task_assignments", "data"],
            "collectionName": "taskAssignments",
            "itemFields": [
              { "name": "id" },
              { "name": "task", "kind": "object" },
              { "name": "project", "kind": "object" },
              { "name": "is_active" },
              { "name": "updated_at" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "task assignment rates and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_clients",
      "name": "List Clients",
      "description": "List all clients in the Harvest account",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/clients",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "is_active": {
            "type": "boolean",
            "in": "query",
            "description": "Filter by active status",
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return clients updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "clients",
          "historicalSummary": {
            "collectionKeys": ["clients", "data"],
            "collectionName": "clients",
            "itemFields": [{ "name": "id" }, { "name": "name" }, { "name": "currency" }, {
              "name": "is_active",
            }, { "name": "updated_at" }],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "client addresses, statement keys, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_client",
      "name": "Get Client",
      "description": "Get details of a specific client",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/clients/{clientId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "clientId": {
            "type": "number",
            "in": "path",
            "description": "Harvest client ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_invoices",
      "name": "List Invoices",
      "description": "List all invoices. Filter by client, status, or date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/invoices",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "state": {
            "type": "string",
            "in": "query",
            "description": "Filter by state: draft, open, paid, closed",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Only invoices with issue_date >= from (YYYY-MM-DD)",
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Only invoices with issue_date <= to (YYYY-MM-DD)",
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return invoices updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "invoices",
          "historicalSummary": {
            "collectionKeys": ["invoices", "data"],
            "collectionName": "invoices",
            "itemFields": [
              { "name": "id" },
              { "name": "number" },
              { "name": "state" },
              { "name": "amount" },
              { "name": "due_date" },
              { "name": "client", "kind": "object" },
              { "name": "updated_at" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "invoice notes, line items, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_invoice",
      "name": "Get Invoice",
      "description": "Get details of a specific invoice including line items",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/invoices/{invoiceId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "invoiceId": {
            "type": "number",
            "in": "path",
            "description": "Harvest invoice ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_invoice",
      "name": "Create Invoice",
      "description": "Create a new invoice for a client",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.harvestapp.com/v2/invoices",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
        },
        "body": {
          "client_id": {
            "type": "number",
            "description": "Client ID to invoice",
            "required": true,
          },
          "subject": { "type": "string", "description": "Invoice subject line" },
          "notes": { "type": "string", "description": "Invoice notes visible to client" },
          "issue_date": {
            "type": "string",
            "description": "Issue date (YYYY-MM-DD, defaults to today)",
          },
          "due_date": { "type": "string", "description": "Due date (YYYY-MM-DD)" },
          "currency": {
            "type": "string",
            "description": "Invoice currency code (e.g. USD, EUR). Defaults to account currency.",
          },
          "line_items_import": {
            "type": "object",
            "description":
              "Import time entries/expenses into line items: { project_ids: number[], time: { summary_type, from, to }, expenses: { summary_type, from, to, attach_receipt } }",
          },
          "line_items": {
            "type": "array",
            "description":
              "Manual line items array: [{ kind, description, unit_price, quantity, taxed, taxed2 }]",
          },
        },
      },
    }, {
      "id": "update_invoice",
      "name": "Update Invoice",
      "description": "Update an existing invoice (subject, notes, dates, line items, state)",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.harvestapp.com/v2/invoices/{invoiceId}",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "invoiceId": {
            "type": "number",
            "in": "path",
            "description": "Harvest invoice ID",
            "required": true,
          },
        },
        "body": {
          "subject": { "type": "string", "description": "Updated subject" },
          "notes": { "type": "string", "description": "Updated notes" },
          "issue_date": { "type": "string", "description": "Updated issue date (YYYY-MM-DD)" },
          "due_date": { "type": "string", "description": "Updated due date (YYYY-MM-DD)" },
          "line_items": { "type": "array", "description": "Updated line items" },
        },
      },
    }, {
      "id": "list_invoice_payments",
      "name": "List Invoice Payments",
      "description": "List all payments recorded for an invoice",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/invoices/{invoiceId}/payments",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "invoiceId": {
            "type": "number",
            "in": "path",
            "description": "Harvest invoice ID",
            "required": true,
          },
          "updated_since": {
            "type": "string",
            "in": "query",
            "description": "Only return payments updated after this ISO 8601 datetime",
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "invoice_payments",
          "historicalSummary": {
            "collectionKeys": ["invoice_payments", "data"],
            "collectionName": "invoicePayments",
            "itemFields": [{ "name": "id" }, { "name": "amount" }, { "name": "paid_at" }, {
              "name": "created_at",
            }, { "name": "updated_at" }],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "payment notes and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "create_invoice_payment",
      "name": "Create Invoice Payment",
      "description": "Record a payment for an invoice",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.harvestapp.com/v2/invoices/{invoiceId}/payments",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "invoiceId": {
            "type": "number",
            "in": "path",
            "description": "Harvest invoice ID",
            "required": true,
          },
        },
        "body": {
          "amount": { "type": "number", "description": "Payment amount", "required": true },
          "paid_at": {
            "type": "string",
            "description": "Payment datetime (ISO 8601, defaults to now)",
          },
          "paid_date": {
            "type": "string",
            "description": "Payment date (YYYY-MM-DD, use instead of paid_at for date-only)",
          },
          "notes": { "type": "string", "description": "Payment notes" },
          "send_thank_you": {
            "type": "boolean",
            "description": "Send a thank-you email to the client",
            "default": false,
          },
        },
      },
    }, {
      "id": "time_report_by_project",
      "name": "Time Report by Project",
      "description": "Get a time report aggregated by project. Requires from and to date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/reports/time/projects",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Report start date (YYYY-MM-DD)",
            "required": true,
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Report end date (YYYY-MM-DD)",
            "required": true,
          },
          "include_fixed_fee": {
            "type": "boolean",
            "in": "query",
            "description": "Include fixed-fee projects",
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "user_id": { "type": "number", "in": "query", "description": "Filter by user ID" },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "results",
          "historicalSummary": {
            "collectionKeys": ["results", "data"],
            "collectionName": "projectTimeReports",
            "itemFields": [
              { "name": "project_id" },
              { "name": "project_name" },
              { "name": "client_id" },
              { "name": "client_name" },
              { "name": "total_hours" },
              { "name": "billable_hours" },
              { "name": "billable_amount" },
              { "name": "currency" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "report breakdown details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "time_report_by_team",
      "name": "Time Report by Team",
      "description":
        "Get a time report aggregated by team member. Requires from and to date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/reports/time/team",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Report start date (YYYY-MM-DD)",
            "required": true,
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Report end date (YYYY-MM-DD)",
            "required": true,
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "user_id": { "type": "number", "in": "query", "description": "Filter by user ID" },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "results",
          "historicalSummary": {
            "collectionKeys": ["results", "data"],
            "collectionName": "teamTimeReports",
            "itemFields": [
              { "name": "user_id" },
              { "name": "user_name" },
              { "name": "total_hours" },
              { "name": "billable_hours" },
              { "name": "billable_amount" },
              { "name": "currency" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "team report details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "time_report_by_client",
      "name": "Time Report by Client",
      "description": "Get a time report aggregated by client. Requires from and to date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/reports/time/clients",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Report start date (YYYY-MM-DD)",
            "required": true,
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Report end date (YYYY-MM-DD)",
            "required": true,
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "user_id": { "type": "number", "in": "query", "description": "Filter by user ID" },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "results",
          "historicalSummary": {
            "collectionKeys": ["results", "data"],
            "collectionName": "clientTimeReports",
            "itemFields": [
              { "name": "client_id" },
              { "name": "client_name" },
              { "name": "total_hours" },
              { "name": "billable_hours" },
              { "name": "billable_amount" },
              { "name": "currency" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "client report details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "time_report_by_task",
      "name": "Time Report by Task",
      "description": "Get a time report aggregated by task. Requires from and to date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/reports/time/tasks",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Report start date (YYYY-MM-DD)",
            "required": true,
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Report end date (YYYY-MM-DD)",
            "required": true,
          },
          "client_id": { "type": "number", "in": "query", "description": "Filter by client ID" },
          "project_id": { "type": "number", "in": "query", "description": "Filter by project ID" },
          "user_id": { "type": "number", "in": "query", "description": "Filter by user ID" },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "results",
          "historicalSummary": {
            "collectionKeys": ["results", "data"],
            "collectionName": "taskTimeReports",
            "itemFields": [
              { "name": "task_id" },
              { "name": "task_name" },
              { "name": "total_hours" },
              { "name": "billable_hours" },
              { "name": "billable_amount" },
              { "name": "currency" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "task report details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "invoice_report",
      "name": "Invoice Report",
      "description": "Get an invoiced time and expenses report. Requires from and to date range.",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.harvestapp.com/v2/reports/invoices/invoiced",
        "params": {
          "account_id": {
            "type": "string",
            "in": "header",
            "description": "Harvest Account ID (get it from list_accounts)",
            "required": true,
            "headerName": "Harvest-Account-Id",
          },
          "from": {
            "type": "string",
            "in": "query",
            "description": "Report start date (YYYY-MM-DD)",
            "required": true,
          },
          "to": {
            "type": "string",
            "in": "query",
            "description": "Report end date (YYYY-MM-DD)",
            "required": true,
          },
          "page": { "type": "number", "in": "query", "description": "Page number", "default": 1 },
          "per_page": {
            "type": "number",
            "in": "query",
            "description": "Results per page (max 100)",
            "default": 50,
          },
        },
        "response": {
          "transform": "results",
          "historicalSummary": {
            "collectionKeys": ["results", "data"],
            "collectionName": "invoiceReports",
            "itemFields": [
              { "name": "client_id" },
              { "name": "client_name" },
              { "name": "invoice_id" },
              { "name": "invoice_number" },
              { "name": "amount" },
              { "name": "currency" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "invoice report details and provider-specific payload fields",
          },
        },
      },
    }],
    "prompts": [{
      "id": "log_time",
      "title": "Log time for today",
      "prompt":
        "Log time entries for today. Show me my projects and tasks, then create time entries for the work I describe.",
      "category": "productivity",
      "icon": "clock",
    }, {
      "id": "weekly_timesheet",
      "title": "Show weekly timesheet",
      "prompt":
        "Show me my time entries for this week grouped by project. Calculate total hours per project and overall.",
      "category": "productivity",
      "icon": "calendar",
    }, {
      "id": "create_invoice",
      "title": "Create an invoice",
      "prompt":
        "Create a new invoice for a client. Import tracked time entries for the specified period and generate the invoice.",
      "category": "finance",
      "icon": "file-text",
    }, {
      "id": "invoice_status",
      "title": "Check invoice status",
      "prompt":
        "Show me all open invoices with their amounts, due dates, and payment status. Flag any overdue invoices.",
      "category": "finance",
      "icon": "alert-circle",
    }, {
      "id": "team_report",
      "title": "Team time report",
      "prompt":
        "Generate a time report for the team this month. Show hours logged per person, per project, and identify anyone who hasn't logged time.",
      "category": "management",
      "icon": "users",
    }],
    "suggestedWith": ["github", "jira", "slack"],
  },
  {
    "name": "hubspot",
    "displayName": "HubSpot",
    "icon": "hubspot.svg",
    "description": "Access HubSpot forms, submissions, contacts, and leads",
    "auth": {
      "type": "oauth2",
      "provider": "hubspot",
      "authorizationUrl": "https://app.hubspot.com/oauth/authorize",
      "tokenUrl": "https://api.hubapi.com/oauth/v1/token",
      "scopes": ["oauth", "crm.objects.contacts.read"],
      "optionalScopes": ["crm.objects.leads.read", "crm.objects.leads.write"],
      "tokenAuthMethod": "request_body",
      "supportsRefreshToken": true,
      "requiredApis": [{
        "name": "HubSpot public app",
        "enableUrl": "https://app.hubspot.com/developer-projects",
      }],
    },
    "envVars": [{
      "name": "HUBSPOT_CLIENT_ID",
      "description": "HubSpot OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl":
        "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth",
    }, {
      "name": "HUBSPOT_CLIENT_SECRET",
      "description": "HubSpot OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl":
        "https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth",
    }],
    "tools": [{
      "id": "list_forms",
      "name": "List Forms",
      "description": "List HubSpot forms so agents can find a form ID before reading submissions",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/marketing/v3/forms",
        "params": {
          "limit": { "type": "number", "in": "query", "description": "Maximum forms to return" },
          "after": {
            "type": "string",
            "in": "query",
            "description": "Pagination cursor from the previous page",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to return archived forms",
          },
          "formTypes": {
            "type": "string[]",
            "in": "query",
            "description":
              "Form types to include, such as hubspot, captured, flow, blog_comment, or all",
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "list_form_submissions",
      "name": "List Form Submissions",
      "description": "List recent submissions for a HubSpot form in reverse chronological order",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/form-integrations/v1/submissions/forms/{formGuid}",
        "params": {
          "formGuid": {
            "type": "string",
            "in": "path",
            "description": "HubSpot form GUID",
            "required": true,
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum submissions to return, from 1 to 50",
            "default": 20,
          },
          "after": {
            "type": "string",
            "in": "query",
            "description": "Pagination cursor from the previous page",
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "get_contact",
      "name": "Get Contact",
      "description": "Get a HubSpot contact by ID or email before scoring, dedupe, or updates",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/objects/contacts/{contactId}",
        "params": {
          "contactId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot contact ID, or email when idProperty is email",
            "required": true,
          },
          "properties": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated contact properties to return",
          },
          "associations": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated associated object types to include",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to include archived contacts",
            "default": false,
          },
          "idProperty": {
            "type": "string",
            "in": "query",
            "description": "Optional unique property used to identify the contact, such as email",
          },
        },
      },
    }, {
      "id": "search_contacts",
      "name": "Search Contacts",
      "description": "Search HubSpot contacts by filters for lead research and CRM lookup",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/contacts/search",
        "body": {
          "query": {
            "type": "string",
            "description": "Text query to match against contact properties",
          },
          "filterGroups": { "type": "array", "description": "HubSpot CRM search filter groups" },
          "sorts": { "type": "array", "description": "Sort expressions" },
          "properties": { "type": "array", "description": "Contact properties to return" },
          "limit": { "type": "number", "description": "Maximum contacts to return", "default": 10 },
          "after": { "type": "string", "description": "Pagination cursor from the previous page" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "create_contact",
      "name": "Create Contact",
      "description": "Create a HubSpot contact from form submission or researched lead data",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/contacts",
        "body": {
          "properties": {
            "type": "object",
            "description":
              "HubSpot contact properties, such as email, firstname, lastname, company, phone, website, and hubspotscore",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_contact",
      "name": "Update Contact",
      "description": "Update HubSpot contact properties, including lead score or research notes",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.hubapi.com/crm/v3/objects/contacts/{contactId}",
        "params": {
          "contactId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot contact record ID, or email when idProperty is email",
            "required": true,
          },
          "idProperty": {
            "type": "string",
            "in": "query",
            "description": "Optional unique property used to identify the contact, such as email",
          },
        },
        "body": {
          "properties": {
            "type": "object",
            "description": "HubSpot contact properties to update",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_lead",
      "name": "Get Lead",
      "description": "Get a HubSpot CRM lead before scoring, routing, or updates",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/objects/leads/{leadId}",
        "params": {
          "leadId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot lead record ID",
            "required": true,
          },
          "properties": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated lead properties to return",
          },
          "associations": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated associated object types to include",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to include archived leads",
            "default": false,
          },
        },
      },
    }, {
      "id": "list_leads",
      "name": "List Leads",
      "description":
        "List HubSpot CRM leads for scoring, spreadsheet updates, or research workflows",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/objects/leads",
        "params": {
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum leads to return",
            "default": 50,
          },
          "after": {
            "type": "string",
            "in": "query",
            "description": "Pagination cursor from the previous page",
          },
          "properties": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated lead properties to return",
          },
          "associations": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated associated object types to include",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to return archived leads",
            "default": false,
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "search_leads",
      "name": "Search Leads",
      "description": "Search HubSpot CRM leads for dedupe, scoring, and routing workflows",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/leads/search",
        "body": {
          "query": {
            "type": "string",
            "description": "Text query to match against lead properties",
          },
          "filterGroups": { "type": "array", "description": "HubSpot CRM search filter groups" },
          "sorts": { "type": "array", "description": "Sort expressions" },
          "properties": { "type": "array", "description": "Lead properties to return" },
          "limit": { "type": "number", "description": "Maximum leads to return", "default": 10 },
          "after": { "type": "string", "description": "Pagination cursor from the previous page" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "create_lead",
      "name": "Create Lead",
      "description": "Create a HubSpot CRM lead associated with an existing contact or company",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/leads",
        "body": {
          "properties": {
            "type": "object",
            "description":
              "Lead properties. Include hs_lead_name and any scoring or routing fields.",
            "required": true,
          },
          "associations": {
            "type": "array",
            "description": "Associations to existing contacts or companies",
          },
        },
      },
    }, {
      "id": "update_lead",
      "name": "Update Lead",
      "description":
        "Update a HubSpot CRM lead with score, qualification, owner, or research fields",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.hubapi.com/crm/v3/objects/leads/{leadId}",
        "params": {
          "leadId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot lead record ID",
            "required": true,
          },
        },
        "body": {
          "properties": {
            "type": "object",
            "description": "Lead properties to update",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_company",
      "name": "Get Company",
      "description": "Get a HubSpot company by ID or domain before lead research or association",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/objects/companies/{companyId}",
        "params": {
          "companyId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot company ID, or domain when idProperty is domain",
            "required": true,
          },
          "properties": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated company properties to return",
          },
          "associations": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated associated object types to include",
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to include archived companies",
            "default": false,
          },
          "idProperty": {
            "type": "string",
            "in": "query",
            "description": "Optional unique property used to identify the company, such as domain",
          },
        },
      },
    }, {
      "id": "search_companies",
      "name": "Search Companies",
      "description": "Search HubSpot companies by domain, name, or firmographic properties",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/companies/search",
        "body": {
          "query": {
            "type": "string",
            "description": "Text query to match against company properties",
          },
          "filterGroups": { "type": "array", "description": "HubSpot CRM search filter groups" },
          "sorts": { "type": "array", "description": "Sort expressions" },
          "properties": { "type": "array", "description": "Company properties to return" },
          "limit": {
            "type": "number",
            "description": "Maximum companies to return",
            "default": 10,
          },
          "after": { "type": "string", "description": "Pagination cursor from the previous page" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "create_company",
      "name": "Create Company",
      "description": "Create a HubSpot company for researched lead accounts",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.hubapi.com/crm/v3/objects/companies",
        "body": {
          "properties": {
            "type": "object",
            "description":
              "HubSpot company properties, such as name, domain, industry, city, and state",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_company",
      "name": "Update Company",
      "description": "Update HubSpot company properties with research or enrichment data",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.hubapi.com/crm/v3/objects/companies/{companyId}",
        "params": {
          "companyId": {
            "type": "string",
            "in": "path",
            "description": "HubSpot company ID, or domain when idProperty is domain",
            "required": true,
          },
          "idProperty": {
            "type": "string",
            "in": "query",
            "description": "Optional unique property used to identify the company, such as domain",
          },
        },
        "body": {
          "properties": {
            "type": "object",
            "description": "HubSpot company properties to update",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_properties",
      "name": "List Properties",
      "description":
        "List HubSpot CRM properties for contacts, leads, or companies before updating custom fields",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/properties/{objectType}",
        "params": {
          "objectType": {
            "type": "string",
            "in": "path",
            "description": "CRM object type, such as contacts, leads, or companies",
            "required": true,
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to return archived properties",
            "default": false,
          },
          "dataSensitivity": {
            "type": "string",
            "in": "query",
            "description":
              "Optional sensitivity filter supported by HubSpot accounts with sensitive data features",
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "list_owners",
      "name": "List Owners",
      "description": "List HubSpot owners so agents can assign or route contacts and leads",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v3/owners",
        "params": {
          "email": { "type": "string", "in": "query", "description": "Filter owners by email" },
          "after": {
            "type": "string",
            "in": "query",
            "description": "Pagination cursor from the previous page",
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum owners to return",
            "default": 100,
          },
          "archived": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to return archived owners",
            "default": false,
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "list_association_labels",
      "name": "List Association Labels",
      "description":
        "List HubSpot association labels between CRM object types before associating records",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.hubapi.com/crm/v4/associations/{fromObjectType}/{toObjectType}/labels",
        "params": {
          "fromObjectType": {
            "type": "string",
            "in": "path",
            "description": "Source CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "toObjectType": {
            "type": "string",
            "in": "path",
            "description": "Target CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "list_associations",
      "name": "List Associations",
      "description": "List records associated with a HubSpot CRM record",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://api.hubapi.com/crm/v4/objects/{objectType}/{objectId}/associations/{toObjectType}",
        "params": {
          "objectType": {
            "type": "string",
            "in": "path",
            "description": "Source CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "objectId": {
            "type": "string",
            "in": "path",
            "description": "Source CRM record ID",
            "required": true,
          },
          "toObjectType": {
            "type": "string",
            "in": "path",
            "description": "Associated CRM object type to list",
            "required": true,
          },
          "after": {
            "type": "string",
            "in": "query",
            "description": "Pagination cursor from the previous page",
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum associations to return",
            "default": 100,
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "associate_records",
      "name": "Associate Records",
      "description": "Create a default HubSpot association between two CRM records",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url":
          "https://api.hubapi.com/crm/v4/objects/{fromObjectType}/{fromObjectId}/associations/default/{toObjectType}/{toObjectId}",
        "params": {
          "fromObjectType": {
            "type": "string",
            "in": "path",
            "description": "Source CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "fromObjectId": {
            "type": "string",
            "in": "path",
            "description": "Source CRM record ID",
            "required": true,
          },
          "toObjectType": {
            "type": "string",
            "in": "path",
            "description": "Target CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "toObjectId": {
            "type": "string",
            "in": "path",
            "description": "Target CRM record ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "remove_association",
      "name": "Remove Association",
      "description": "Remove all HubSpot associations between two CRM records",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url":
          "https://api.hubapi.com/crm/v4/objects/{fromObjectType}/{fromObjectId}/associations/{toObjectType}/{toObjectId}",
        "params": {
          "fromObjectType": {
            "type": "string",
            "in": "path",
            "description": "Source CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "fromObjectId": {
            "type": "string",
            "in": "path",
            "description": "Source CRM record ID",
            "required": true,
          },
          "toObjectType": {
            "type": "string",
            "in": "path",
            "description": "Target CRM object type, such as contacts, companies, or leads",
            "required": true,
          },
          "toObjectId": {
            "type": "string",
            "in": "path",
            "description": "Target CRM record ID",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "review_submissions",
      "title": "Review form submissions",
      "prompt":
        "List recent HubSpot form submissions, identify the strongest leads, and summarize recommended follow-up.",
      "category": "sales",
      "icon": "search",
    }, {
      "id": "score_leads",
      "title": "Score leads",
      "prompt":
        "Research HubSpot contacts or leads, score them, and update the matching CRM records.",
      "category": "sales",
      "icon": "users",
    }],
    "suggestedWith": ["sheets", "gmail", "slack"],
    "category": "sales",
  },
  {
    "name": "jira",
    "displayName": "Jira",
    "icon": "jira.svg",
    "description": "Search, create, and manage Jira issues and projects",
    "auth": {
      "type": "oauth2",
      "provider": "atlassian",
      "authorizationUrl": "https://auth.atlassian.com/authorize",
      "tokenUrl": "https://auth.atlassian.com/oauth/token",
      "scopes": ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "Atlassian OAuth 2.0",
        "enableUrl": "https://developer.atlassian.com/console/myapps/",
      }],
      "additionalAuthParams": { "audience": "api.atlassian.com", "prompt": "consent" },
    },
    "envVars": [{
      "name": "ATLASSIAN_CLIENT_ID",
      "description": "Atlassian OAuth 2.0 Client ID (from your app)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://developer.atlassian.com/console/myapps/",
    }, {
      "name": "ATLASSIAN_CLIENT_SECRET",
      "description": "Atlassian OAuth 2.0 Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://developer.atlassian.com/console/myapps/",
    }],
    "tools": [{
      "id": "list_sites",
      "name": "List Atlassian Sites",
      "description":
        "List Atlassian cloud sites/resources the OAuth token can access; use the returned id as cloudId for Jira and Confluence tools",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/oauth/token/accessible-resources",
        "response": {
          "transform": "",
          "historicalSummary": {
            "collectionKeys": ["values", "sites", "data"],
            "collectionName": "sites",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "sites details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description": "List all accessible Jira projects",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/search",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "query": {
            "type": "string",
            "in": "query",
            "description": "Search text for project name or key",
          },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum projects to return",
            "default": 50,
          },
          "startAt": {
            "type": "number",
            "in": "query",
            "description": "Pagination offset",
            "default": 0,
          },
        },
        "response": {
          "transform": "values",
          "historicalSummary": {
            "collectionKeys": ["values", "projects", "data"],
            "collectionName": "projects",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "projects details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_project",
      "name": "Get Project",
      "description": "Get detailed information about a Jira project",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/project/{projectIdOrKey}",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from OAuth accessible resources",
            "required": true,
          },
          "projectIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira project ID or key",
            "required": true,
          },
        },
      },
    }, {
      "id": "search_issues",
      "name": "Search Issues",
      "description": "Search Jira issues using JQL (Jira Query Language)",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/search/jql",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "jql": {
            "type": "string",
            "in": "query",
            "description": "Jira Query Language search expression",
            "required": true,
          },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum issues to return",
            "default": 50,
          },
          "nextPageToken": {
            "type": "string",
            "in": "query",
            "description": "Pagination token from the previous Jira JQL search response",
          },
          "fields": { "type": "array", "in": "query", "description": "Issue fields to include" },
        },
        "response": {
          "transform": "issues",
          "historicalSummary": {
            "collectionKeys": ["issues", "data"],
            "collectionName": "issues",
            "itemFields": [
              { "name": "id" },
              { "name": "key" },
              { "name": "summary" },
              { "name": "status", "kind": "object" },
              { "name": "assignee", "kind": "contact" },
              { "name": "created" },
              { "name": "updated" },
            ],
            "outputFields": [{ "name": "total" }, { "name": "startAt" }, { "name": "maxResults" }],
            "omitted":
              "issue descriptions, comments, changelog, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_issue",
      "name": "Get Issue",
      "description": "Get detailed information about a specific Jira issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated issue fields to include",
          },
        },
      },
    }, {
      "id": "create_issue",
      "name": "Create Issue",
      "description": "Create a new Jira issue in a project",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
        },
        "body": {
          "fields": {
            "type": "object",
            "description":
              "Jira issue fields including project, issuetype, summary, and description",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_issue",
      "name": "Update Issue",
      "description": "Update an existing Jira issue (status, fields, etc.)",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from accessible-resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
        },
        "body": {
          "fields": { "type": "object", "description": "Jira fields to set" },
          "update": { "type": "object", "description": "Jira update operations" },
        },
      },
    }, {
      "id": "list_comments",
      "name": "List Comments",
      "description": "List comments on a Jira issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/comment",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from OAuth accessible resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
          "startAt": {
            "type": "number",
            "in": "query",
            "description": "Pagination offset",
            "default": 0,
          },
          "maxResults": {
            "type": "number",
            "in": "query",
            "description": "Maximum comments to return",
            "default": 50,
          },
        },
        "response": {
          "historicalSummary": {
            "collectionKeys": ["comments", "data"],
            "collectionName": "comments",
            "itemFields": [
              { "name": "id" },
              { "name": "body", "kind": "object" },
              { "name": "author", "kind": "contact" },
              { "name": "created" },
              { "name": "updated" },
            ],
            "outputFields": [{ "name": "total" }, { "name": "startAt" }, { "name": "maxResults" }],
            "omitted": "full comment payloads and provider-specific fields",
          },
        },
      },
    }, {
      "id": "add_comment",
      "name": "Add Comment",
      "description": "Add a comment to a Jira issue",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url":
          "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/comment",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from OAuth accessible resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
        },
        "body": {
          "body": {
            "type": "object",
            "description": "Comment body in Atlassian Document Format",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_transitions",
      "name": "Get Transitions",
      "description": "List available workflow transitions for a Jira issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/transitions",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from OAuth accessible resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
        },
      },
    }, {
      "id": "transition_issue",
      "name": "Transition Issue",
      "description":
        "Move a Jira issue to a new workflow status. First call get_transitions to get valid transition IDs, then pass the ID here.",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url":
          "https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/{issueIdOrKey}/transitions",
        "params": {
          "cloudId": {
            "type": "string",
            "in": "path",
            "description": "Atlassian cloud ID from OAuth accessible resources",
            "required": true,
          },
          "issueIdOrKey": {
            "type": "string",
            "in": "path",
            "description": "Jira issue ID or key",
            "required": true,
          },
        },
        "body": {
          "transition": {
            "type": "object",
            "description": 'Transition object with id field, e.g. {"id": "21"}',
            "required": true,
          },
          "fields": {
            "type": "object",
            "description": "Optional field updates to apply during the transition",
          },
          "comment": {
            "type": "object",
            "description":
              "Optional comment in Atlassian Document Format to add with the transition",
          },
        },
      },
    }],
    "prompts": [{
      "id": "find_bugs",
      "title": "Find open bugs",
      "prompt": "Search for all open bugs assigned to me or in my current sprint.",
      "category": "productivity",
      "icon": "bug",
    }, {
      "id": "create_task",
      "title": "Create a task",
      "prompt": "Create a new task in Jira with a title, description, and priority.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "sprint_summary",
      "title": "Sprint summary",
      "prompt": "Get a summary of all issues in the current sprint, organized by status.",
      "category": "productivity",
      "icon": "list",
    }, {
      "id": "update_status",
      "title": "Update issue status",
      "prompt": "Move an issue to a different status (To Do, In Progress, Done, etc.).",
      "category": "productivity",
      "icon": "check",
    }],
    "suggestedWith": ["github", "slack", "confluence"],
  },
  {
    "name": "linear",
    "displayName": "Linear",
    "icon": "linear.svg",
    "description": "Search, create, and manage Linear issues and projects",
    "auth": {
      "type": "oauth2",
      "provider": "linear",
      "authorizationUrl": "https://linear.app/oauth/authorize",
      "tokenUrl": "https://api.linear.app/oauth/token",
      "scopes": ["read", "write"],
      "tokenAuthMethod": "basic",
      "requiredApis": [{
        "name": "Linear OAuth Application",
        "enableUrl": "https://linear.app/settings/api",
      }],
    },
    "envVars": [{
      "name": "LINEAR_CLIENT_ID",
      "description": "Linear OAuth Client ID (from your OAuth application)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://linear.app/settings/api",
    }, {
      "name": "LINEAR_CLIENT_SECRET",
      "description": "Linear OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://linear.app/settings/api",
    }],
    "tools": [{
      "id": "search_issues",
      "name": "Search Issues",
      "description": "Search for Linear issues by title or description",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($query: String!, $first: Int) { searchIssues(term: $query, first: $first) { nodes { id identifier title description state { name } assignee { name } priority priorityLabel createdAt updatedAt } } }",
        "params": {
          "query": {
            "type": "string",
            "in": "body",
            "description": "Search query text",
            "required": true,
          },
          "first": { "type": "number", "in": "body", "description": "Max results", "default": 20 },
        },
        "response": {
          "transform": "searchIssues",
          "historicalSummary": {
            "collectionKeys": ["searchIssues", "issues", "nodes", "data"],
            "collectionName": "issues",
            "itemFields": [
              { "name": "id" },
              { "name": "identifier" },
              { "name": "title" },
              { "name": "state", "kind": "object" },
              { "name": "assignee", "kind": "contact" },
              { "name": "url" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
            ],
            "outputFields": [{ "name": "pageInfo", "kind": "object" }],
            "omitted": "issue descriptions, comments, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_issue",
      "name": "Get Issue",
      "description": "Get detailed information about a specific Linear issue",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($id: String!) { issue(id: $id) { id identifier title description state { name } assignee { name email } priority priorityLabel team { name } project { name } labels { nodes { name } } comments { nodes { body user { name } createdAt } } createdAt updatedAt } }",
        "params": {
          "id": {
            "type": "string",
            "in": "body",
            "description": "Issue ID or identifier (e.g. ENG-123)",
            "required": true,
          },
        },
        "response": { "transform": "issue" },
      },
    }, {
      "id": "create_issue",
      "name": "Create Issue",
      "description": "Create a new Linear issue in a team",
      "requiresWrite": true,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "mutation($teamId: String!, $title: String!, $description: String, $priority: Int) { issueCreate(input: { teamId: $teamId, title: $title, description: $description, priority: $priority }) { success issue { id identifier title url } } }",
        "params": {
          "teamId": { "type": "string", "in": "body", "description": "Team ID", "required": true },
          "title": {
            "type": "string",
            "in": "body",
            "description": "Issue title",
            "required": true,
          },
          "description": {
            "type": "string",
            "in": "body",
            "description": "Issue description (markdown)",
          },
          "priority": {
            "type": "number",
            "in": "body",
            "description": "Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)",
          },
        },
        "response": { "transform": "issueCreate" },
      },
    }, {
      "id": "update_issue",
      "name": "Update Issue",
      "description": "Update the status, assignee, or other properties of an issue",
      "requiresWrite": true,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "mutation($id: String!, $stateId: String, $assigneeId: String, $priority: Int) { issueUpdate(id: $id, input: { stateId: $stateId, assigneeId: $assigneeId, priority: $priority }) { success issue { id identifier title state { name } assignee { name } } } }",
        "params": {
          "id": { "type": "string", "in": "body", "description": "Issue ID", "required": true },
          "stateId": { "type": "string", "in": "body", "description": "New state ID" },
          "assigneeId": { "type": "string", "in": "body", "description": "New assignee user ID" },
          "priority": { "type": "number", "in": "body", "description": "New priority" },
        },
        "response": { "transform": "issueUpdate" },
      },
    }, {
      "id": "delete_issue",
      "name": "Delete Issue",
      "description":
        "Archive a Linear issue. By default this is non-permanent so canary-created issues do not remain active.",
      "requiresWrite": true,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "mutation($id: String!, $permanentlyDelete: Boolean) { issueDelete(id: $id, permanentlyDelete: $permanentlyDelete) { success } }",
        "params": {
          "id": { "type": "string", "in": "body", "description": "Issue ID", "required": true },
          "permanentlyDelete": {
            "type": "boolean",
            "in": "body",
            "description": "Whether to permanently delete the issue. Defaults to false (archive).",
            "default": false,
          },
        },
        "response": { "transform": "issueDelete" },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description": "List all projects in the workspace",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($first: Int) { projects(first: $first) { nodes { id name description state startDate targetDate lead { name } teams { nodes { name } } } } }",
        "params": {
          "first": { "type": "number", "in": "body", "description": "Max results", "default": 50 },
        },
        "response": {
          "transform": "projects",
          "historicalSummary": {
            "collectionKeys": ["projects", "nodes", "data"],
            "collectionName": "projects",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "projects details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_teams",
      "name": "List Teams",
      "description":
        "List Linear teams in the workspace so issues can be created in the right team",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($first: Int) { teams(first: $first) { nodes { id name key description private issueCount createdAt updatedAt } } }",
        "params": {
          "first": { "type": "number", "in": "body", "description": "Max results", "default": 50 },
        },
        "response": {
          "transform": "teams",
          "historicalSummary": {
            "collectionKeys": ["teams", "nodes", "data"],
            "collectionName": "teams",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "teams details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_workflow_states",
      "name": "List Workflow States",
      "description":
        "List workflow states for a Linear team so issues can be moved to the right status",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($teamId: String!) { team(id: $teamId) { id name states { nodes { id name type color position } } } }",
        "params": {
          "teamId": { "type": "string", "in": "body", "description": "Team ID", "required": true },
        },
        "response": {
          "transform": "team.states",
          "historicalSummary": {
            "collectionKeys": ["states", "nodes", "data"],
            "collectionName": "workflowStates",
            "itemFields": [
              { "name": "id" },
              { "name": "gid" },
              { "name": "key" },
              { "name": "node_id" },
              { "name": "name" },
              { "name": "title" },
              { "name": "summary" },
              { "name": "subject" },
              { "name": "number" },
              { "name": "state" },
              { "name": "status" },
              { "name": "url" },
              { "name": "html_url" },
              { "name": "created_at" },
              { "name": "updated_at" },
              { "name": "createdAt" },
              { "name": "updatedAt" },
              { "name": "user", "kind": "contact" },
              { "name": "author", "kind": "contact" },
              { "name": "created_by", "kind": "contact" },
              { "name": "assignee", "kind": "contact" },
              { "name": "owner", "kind": "contact" },
            ],
            "outputFields": [
              { "name": "nextPageToken" },
              { "name": "next_page" },
              { "name": "next" },
              { "name": "offset" },
              { "name": "total" },
              { "name": "per_page" },
              { "name": "page" },
            ],
            "omitted": "workflowStates details and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_users",
      "name": "List Users",
      "description":
        "List Linear users in the workspace so issues can be assigned to the right person",
      "requiresWrite": false,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "query($first: Int) { users(first: $first) { nodes { id name displayName email active avatarUrl } } }",
        "params": {
          "first": { "type": "number", "in": "body", "description": "Max results", "default": 50 },
        },
        "response": {
          "transform": "users",
          "historicalSummary": {
            "collectionKeys": ["users", "nodes", "data"],
            "collectionName": "users",
            "itemFields": [{ "name": "id" }, { "name": "name" }, { "name": "email" }, {
              "name": "active",
            }, { "name": "displayName" }],
            "outputFields": [{ "name": "pageInfo", "kind": "object" }],
            "omitted": "user avatars and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "add_comment",
      "name": "Add Comment",
      "description": "Add a comment to a Linear issue",
      "requiresWrite": true,
      "endpoint": {
        "type": "graphql",
        "method": "POST",
        "url": "https://api.linear.app/graphql",
        "query":
          "mutation($issueId: String!, $body: String!) { commentCreate(input: { issueId: $issueId, body: $body }) { success comment { id body createdAt user { id name } issue { id identifier title } } } }",
        "params": {
          "issueId": {
            "type": "string",
            "in": "body",
            "description": "Issue ID",
            "required": true,
          },
          "body": {
            "type": "string",
            "in": "body",
            "description": "Comment body in markdown",
            "required": true,
          },
        },
        "response": { "transform": "commentCreate" },
      },
    }],
    "prompts": [{
      "id": "find_issues",
      "title": "Find my issues",
      "prompt": "Search for Linear issues assigned to me or related to a specific topic.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "create_bug_report",
      "title": "Create bug report",
      "prompt": "Create a new bug report in Linear with title, description, and relevant labels.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "update_issue_status",
      "title": "Update issue status",
      "prompt": "Update the status of a Linear issue (e.g., mark as done, in progress, blocked).",
      "category": "productivity",
      "icon": "check",
    }, {
      "id": "project_overview",
      "title": "Project overview",
      "prompt": "Get an overview of all projects in Linear, including their status and key issues.",
      "category": "productivity",
      "icon": "list",
    }],
    "suggestedWith": ["github", "slack", "figma"],
  },
  {
    "name": "mixpanel",
    "displayName": "Mixpanel",
    "icon": "mixpanel.svg",
    "description":
      "Track events, analyze funnels, and understand user behavior with Mixpanel analytics",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Mixpanel API",
        "enableUrl": "https://mixpanel.com/settings/project",
      }],
      "keyName": "MIXPANEL_PROJECT_TOKEN",
    },
    "envVars": [{
      "name": "MIXPANEL_PROJECT_TOKEN",
      "description": "Mixpanel Project Token for event tracking",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://docs.mixpanel.com/docs/tracking-methods/id-management/authentication",
    }, {
      "name": "MIXPANEL_API_SECRET",
      "description": "Mixpanel API Secret for data export and query operations",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://developer.mixpanel.com/reference/authentication",
    }, {
      "name": "MIXPANEL_PROJECT_ID",
      "description": "Mixpanel Project ID (found in project settings)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.mixpanel.com/docs/admin/organizations-projects/manage-projects",
    }],
    "tools": [{
      "id": "track_event",
      "name": "Track Event",
      "description": "Track a custom event in Mixpanel with properties",
      "requiresWrite": true,
    }, {
      "id": "query_events",
      "name": "Query Events",
      "description": "Query and export event data from Mixpanel",
      "requiresWrite": false,
    }, {
      "id": "get_funnel",
      "name": "Get Funnel",
      "description": "Retrieve funnel analysis data to understand conversion rates",
      "requiresWrite": false,
    }, {
      "id": "get_retention",
      "name": "Get Retention",
      "description": "Analyze user retention cohorts over time",
      "requiresWrite": false,
    }, {
      "id": "list_cohorts",
      "name": "List Cohorts",
      "description": "List all user cohorts defined in your Mixpanel project",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "event_analysis",
      "title": "Event analysis",
      "prompt":
        "Show me the most important events tracked in my Mixpanel project over the last 7 days and their trends.",
      "category": "analytics",
      "icon": "chart",
    }, {
      "id": "funnel_performance",
      "title": "Funnel performance",
      "prompt": "Analyze my key conversion funnels and identify where users are dropping off.",
      "category": "analytics",
      "icon": "funnel",
    }, {
      "id": "retention_insights",
      "title": "Retention insights",
      "prompt": "Give me insights about user retention and cohort behavior over the past month.",
      "category": "analytics",
      "icon": "users",
    }],
    "suggestedWith": ["slack", "analytics", "monitoring"],
  },
  {
    "name": "neon",
    "displayName": "Neon",
    "icon": "neon.svg",
    "description": "Manage Neon Postgres projects, branches, and execute database queries",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Neon Management API",
        "enableUrl": "https://console.neon.tech/app/settings/api-keys",
      }],
      "tokenName": "API Key",
      "docsUrl": "https://neon.tech/docs/manage/api-keys",
    },
    "envVars": [{
      "name": "NEON_API_KEY",
      "description": "Neon API Key for Management API access",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://neon.tech/docs/manage/api-keys",
    }, {
      "name": "DATABASE_URL",
      "description": "PostgreSQL connection string for database queries",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://neon.tech/docs/connect/connect-from-any-app",
    }],
    "npmDependencies": { "pg": "^8.13.1" },
    "tools": [{
      "id": "list_projects",
      "name": "List Projects",
      "description": "List all Neon projects in your account",
      "requiresWrite": false,
    }, {
      "id": "list_branches",
      "name": "List Branches",
      "description": "List all branches for a specific project",
      "requiresWrite": false,
    }, {
      "id": "query_database",
      "name": "Query Database",
      "description": "Execute SQL queries against the connected database",
      "requiresWrite": false,
    }, {
      "id": "list_tables",
      "name": "List Tables",
      "description": "List all tables in the connected database",
      "requiresWrite": false,
    }, {
      "id": "describe_table",
      "name": "Describe Table",
      "description": "Get detailed schema information for a specific table",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "check_db_status",
      "title": "Check database status",
      "prompt": "Show me the status of my Neon projects and their branches.",
      "category": "database",
      "icon": "database",
    }, {
      "id": "explore_schema",
      "title": "Explore database schema",
      "prompt": "List all tables in my database and show me the schema for the main tables.",
      "category": "database",
      "icon": "table",
    }, {
      "id": "query_data",
      "title": "Query database",
      "prompt": "Help me query my database to find specific data.",
      "category": "database",
      "icon": "search",
    }],
    "suggestedWith": ["stripe", "clerk", "vercel"],
  },
  {
    "name": "notion",
    "displayName": "Notion",
    "icon": "notion.svg",
    "description": "Search, read, and create pages in Notion workspaces",
    "auth": {
      "type": "oauth2",
      "provider": "notion",
      "authorizationUrl": "https://api.notion.com/v1/oauth/authorize",
      "tokenUrl": "https://api.notion.com/v1/oauth/token",
      "scopes": [],
      "tokenAuthMethod": "basic",
      "requiredApis": [{
        "name": "Notion Integration",
        "enableUrl": "https://www.notion.so/my-integrations",
      }],
    },
    "envVars": [{
      "name": "NOTION_CLIENT_ID",
      "description": "Notion OAuth Client ID (from your integration)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://www.notion.so/my-integrations",
    }, {
      "name": "NOTION_CLIENT_SECRET",
      "description": "Notion OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://www.notion.so/my-integrations",
    }],
    "tools": [{
      "id": "search_notion",
      "name": "Search Notion",
      "description": "Search pages and databases in the workspace",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://api.notion.com/v1/search",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
        },
        "body": {
          "query": { "type": "string", "description": "Search query text" },
          "filter": { "type": "object", "description": "Optional Notion search filter" },
          "sort": { "type": "object", "description": "Optional Notion search sort" },
          "page_size": {
            "type": "number",
            "description": "Maximum results to return",
            "default": 10,
          },
          "start_cursor": { "type": "string", "description": "Pagination cursor" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "read_page",
      "name": "Read Page",
      "description": "Read the content of a Notion page",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.notion.com/v1/blocks/{pageId}/children",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "pageId": {
            "type": "string",
            "in": "path",
            "description": "Notion page ID",
            "required": true,
          },
          "page_size": {
            "type": "number",
            "in": "query",
            "description": "Maximum child blocks to return",
            "default": 100,
          },
          "start_cursor": { "type": "string", "in": "query", "description": "Pagination cursor" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "create_page",
      "name": "Create Page",
      "description": "Create a new page in a database or as a subpage",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.notion.com/v1/pages",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
        },
        "body": {
          "parent": {
            "type": "object",
            "description": "Notion parent object, e.g. database_id or page_id",
            "required": true,
          },
          "properties": { "type": "object", "description": "Page properties", "required": true },
          "children": { "type": "array", "description": "Optional child blocks" },
        },
      },
    }, {
      "id": "query_database",
      "name": "Query Database",
      "description": "Query a Notion database with filters and sorts",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://api.notion.com/v1/databases/{databaseId}/query",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "databaseId": {
            "type": "string",
            "in": "path",
            "description": "Notion database ID",
            "required": true,
          },
        },
        "body": {
          "filter": { "type": "object", "description": "Optional Notion database filter" },
          "sorts": { "type": "array", "description": "Optional Notion database sorts" },
          "page_size": {
            "type": "number",
            "description": "Maximum results to return",
            "default": 10,
          },
          "start_cursor": { "type": "string", "description": "Pagination cursor" },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "get_page",
      "name": "Get Page Metadata",
      "description":
        "Retrieve Notion page metadata and properties without fetching child block content",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.notion.com/v1/pages/{pageId}",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "pageId": {
            "type": "string",
            "in": "path",
            "description": "Notion page ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "get_database",
      "name": "Get Database",
      "description": "Retrieve Notion database metadata, title, and property schema",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.notion.com/v1/databases/{databaseId}",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "databaseId": {
            "type": "string",
            "in": "path",
            "description": "Notion database ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "append_blocks",
      "name": "Append Blocks",
      "description": "Append child blocks to a Notion page or block",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.notion.com/v1/blocks/{blockId}/children",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "blockId": {
            "type": "string",
            "in": "path",
            "description": "Page or block ID to append children to",
            "required": true,
          },
        },
        "body": {
          "children": {
            "type": "array",
            "description": "Notion block objects to append",
            "required": true,
          },
          "after": {
            "type": "string",
            "description": "Optional existing child block ID after which to append",
          },
        },
      },
    }, {
      "id": "update_page",
      "name": "Update Page",
      "description": "Update Notion page properties or archive/unarchive a page",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://api.notion.com/v1/pages/{pageId}",
        "params": {
          "Notion-Version": {
            "type": "string",
            "in": "header",
            "description": "Notion API version",
            "default": "2022-06-28",
          },
          "pageId": {
            "type": "string",
            "in": "path",
            "description": "Notion page ID",
            "required": true,
          },
        },
        "body": {
          "properties": { "type": "object", "description": "Page properties to update" },
          "archived": { "type": "boolean", "description": "Whether the page should be archived" },
          "icon": { "type": "object", "description": "Optional page icon" },
          "cover": { "type": "object", "description": "Optional page cover" },
        },
      },
    }],
    "prompts": [{
      "id": "search_docs",
      "title": "Search my docs",
      "prompt": "Search my Notion workspace for relevant documentation or notes about a topic.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "summarize_page",
      "title": "Summarize a page",
      "prompt":
        "Read and summarize a specific Notion page. Extract the key points and action items.",
      "category": "productivity",
      "icon": "document",
    }, {
      "id": "create_meeting_notes",
      "title": "Create meeting notes",
      "prompt":
        "Create a new meeting notes page with today's date, attendees, agenda, and action items sections.",
      "category": "productivity",
      "icon": "plus",
    }],
    "suggestedWith": ["gmail", "slack", "calendar"],
  },
  {
    "name": "onedrive",
    "displayName": "OneDrive",
    "icon": "onedrive.svg",
    "description": "Access and manage files in Microsoft OneDrive",
    "auth": {
      "type": "oauth2",
      "provider": "microsoft",
      "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "scopes": [
        "Files.Read",
        "Files.ReadWrite",
        "Files.Read.All",
        "Files.ReadWrite.All",
        "offline_access",
      ],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "Microsoft Graph API",
        "enableUrl":
          "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      }],
    },
    "envVars": [{
      "name": "MICROSOFT_CLIENT_ID",
      "description": "Microsoft Azure App Client ID (shared with Outlook/Teams/SharePoint)",
      "required": true,
      "sensitive": false,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }, {
      "name": "MICROSOFT_CLIENT_SECRET",
      "description": "Microsoft Azure App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }],
    "tools": [{
      "id": "list_files",
      "name": "List Files",
      "description": "List files and folders in a OneDrive folder",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/drive/root/children",
        "params": {
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of items to return",
            "default": 200,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated fields to return",
          },
        },
      },
    }, {
      "id": "search_files",
      "name": "Search Files",
      "description": "Search for files and folders in OneDrive by name or content",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/drive/root/search(q='{query}')",
        "params": {
          "query": {
            "type": "string",
            "in": "path",
            "description": "Search query",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of items to return",
            "default": 200,
          },
        },
      },
    }, {
      "id": "upload_file",
      "name": "Upload File",
      "description": "Upload or update a file in OneDrive",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url":
          "https://graph.microsoft.com/v1.0/me/drive/items/{parentFolderId}:/{fileName}:/content",
        "params": {
          "parentFolderId": {
            "type": "string",
            "in": "path",
            "description": "Parent folder item ID, or root",
            "default": "root",
          },
          "fileName": {
            "type": "string",
            "in": "path",
            "description": "Name of the file to upload",
            "required": true,
          },
        },
        "body": {
          "content": {
            "type": "string",
            "description": "File content to upload",
            "required": true,
          },
        },
        "contentType": "application/octet-stream",
      },
    }, {
      "id": "download_file",
      "name": "Download File",
      "description": "Download file content from OneDrive",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/drive/items/{itemId}/content",
        "params": {
          "itemId": {
            "type": "string",
            "in": "path",
            "description": "OneDrive file item ID",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "search_documents",
      "title": "Search documents",
      "prompt": "Search for documents in OneDrive and summarize their content.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "list_recent_files",
      "title": "List recent files",
      "prompt": "Show me the most recently modified files in my OneDrive.",
      "category": "productivity",
      "icon": "document",
    }, {
      "id": "organize_files",
      "title": "Organize files",
      "prompt": "Help me organize and manage files in my OneDrive storage.",
      "category": "productivity",
      "icon": "folder",
    }, {
      "id": "backup_file",
      "title": "Backup a file",
      "prompt": "Upload and backup a file to my OneDrive storage.",
      "category": "productivity",
      "icon": "upload",
    }],
    "suggestedWith": ["outlook", "teams", "sharepoint"],
  },
  {
    "name": "outlook",
    "displayName": "Microsoft Outlook",
    "icon": "outlook.svg",
    "description": "Read, send, schedule, and manage Outlook mail and calendars",
    "auth": {
      "type": "oauth2",
      "provider": "microsoft",
      "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "scopes": [
        "Mail.Read",
        "Mail.Send",
        "Mail.ReadWrite",
        "Calendars.Read",
        "Calendars.ReadWrite",
        "Group.Read.All",
        "Group-Conversation.Read.All",
        "offline_access",
      ],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "Microsoft Graph API",
        "enableUrl":
          "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      }],
    },
    "envVars": [{
      "name": "MICROSOFT_CLIENT_ID",
      "description": "Microsoft Azure App Client ID (Application ID)",
      "required": true,
      "sensitive": false,
      "docsUrl":
        "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }, {
      "name": "MICROSOFT_CLIENT_SECRET",
      "description": "Microsoft Azure App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl":
        "https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }],
    "tools": [{
      "id": "list_emails",
      "name": "List Emails",
      "description": "List recent emails from inbox or a specific folder",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}/messages",
        "params": {
          "folderId": {
            "type": "string",
            "in": "path",
            "description": "Mail folder ID or well-known folder name",
            "required": true,
            "default": "inbox",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "Sort expression",
            "default": "receivedDateTime desc",
          },
          "$filter": { "type": "string", "in": "query", "description": "OData filter expression" },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "get_email",
      "name": "Get Email",
      "description": "Get detailed information about a specific email",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft Graph message ID",
            "required": true,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,categories,isRead,importance,hasAttachments,webLink,flag",
          },
        },
      },
    }, {
      "id": "send_email",
      "name": "Send Email",
      "description": "Send a new email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/sendMail",
        "body": {
          "message": {
            "type": "object",
            "description":
              "Microsoft Graph message object with subject, body, toRecipients, and optional fields",
            "required": true,
          },
          "saveToSentItems": {
            "type": "boolean",
            "description": "Save sent message to Sent Items",
            "default": true,
          },
        },
      },
    }, {
      "id": "search_emails",
      "name": "Search Emails",
      "description": "Search emails by query, subject, sender, or date",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/messages",
        "params": {
          "query": {
            "type": "string",
            "in": "query",
            "description":
              "Microsoft Graph message search query. Gmail-style AQS terms such as from:marcus or subject:Finanzplan are accepted; the runtime quotes them for Graph $search.",
            "required": true,
            "queryName": "$search",
            "queryValueFormat": "microsoft-graph-search",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "list_folders",
      "name": "List Folders",
      "description": "List all mail folders in the mailbox",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders",
        "params": {
          "includeHiddenFolders": {
            "type": "boolean",
            "in": "query",
            "description": "Include hidden folders",
            "default": false,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum folders to return",
            "default": 100,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "folders", "data"],
            "collectionName": "folders",
            "itemFields": [
              { "name": "id" },
              { "name": "displayName" },
              { "name": "parentFolderId" },
              { "name": "childFolderCount" },
              { "name": "unreadItemCount" },
              { "name": "totalItemCount" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "folder provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_folder",
      "name": "Get Folder",
      "description": "Get metadata for a mail folder",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}",
        "params": {
          "folderId": {
            "type": "string",
            "in": "path",
            "description": "Mail folder ID or well-known folder name",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_folder",
      "name": "Create Folder",
      "description": "Create a mail folder",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders",
        "body": {
          "displayName": {
            "type": "string",
            "description": "Folder display name",
            "required": true,
          },
        },
      },
    }, {
      "id": "update_folder",
      "name": "Update Folder",
      "description": "Rename a mail folder",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}",
        "params": {
          "folderId": {
            "type": "string",
            "in": "path",
            "description": "Mail folder ID",
            "required": true,
          },
        },
        "body": {
          "displayName": {
            "type": "string",
            "description": "Folder display name",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_folder",
      "name": "Delete Folder",
      "description": "Delete a mail folder",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders/{folderId}",
        "params": {
          "folderId": {
            "type": "string",
            "in": "path",
            "description": "Mail folder ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "mark_email_read",
      "name": "Mark Email Read",
      "description": "Mark an email as read",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": { "isRead": { "type": "boolean", "description": "Read state", "default": true } },
      },
    }, {
      "id": "mark_email_unread",
      "name": "Mark Email Unread",
      "description": "Mark an email as unread",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": { "isRead": { "type": "boolean", "description": "Read state", "default": false } },
      },
    }, {
      "id": "delete_email",
      "name": "Delete Email",
      "description": "Delete an email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "move_email",
      "name": "Move Email",
      "description": "Move an email to another folder",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/move",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "destinationId": {
            "type": "string",
            "description": "Destination folder ID or well-known folder name",
            "required": true,
          },
        },
      },
    }, {
      "id": "archive_email",
      "name": "Archive Email",
      "description": "Move an email to the archive folder",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/move",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "destinationId": {
            "type": "string",
            "description": "Destination folder ID or well-known folder name",
            "default": "archive",
          },
        },
      },
    }, {
      "id": "flag_email",
      "name": "Flag Email",
      "description": "Set a follow-up flag on an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "flag": {
            "type": "object",
            "description": "Microsoft Graph followupFlag object",
            "required": true,
          },
        },
      },
    }, {
      "id": "clear_email_flag",
      "name": "Clear Email Flag",
      "description": "Clear the follow-up flag on an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "flag": {
            "type": "object",
            "description": "Microsoft Graph followupFlag object",
            "default": { "flagStatus": "notFlagged" },
          },
        },
      },
    }, {
      "id": "categorize_email",
      "name": "Categorize Email",
      "description": "Replace the categories on an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "categories": {
            "type": "array",
            "description": "Outlook category display names",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_categories",
      "name": "List Categories",
      "description": "List Outlook master categories",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "categories", "data"],
            "collectionName": "categories",
            "itemFields": [{ "name": "id" }, { "name": "displayName" }, { "name": "color" }],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "category provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "create_category",
      "name": "Create Category",
      "description": "Create an Outlook master category",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/outlook/masterCategories",
        "body": {
          "displayName": {
            "type": "string",
            "description": "Category display name",
            "required": true,
          },
          "color": { "type": "string", "description": "Preset category color" },
        },
      },
    }, {
      "id": "update_category",
      "name": "Update Category",
      "description": "Update an Outlook master category color",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/outlook/masterCategories/{categoryId}",
        "params": {
          "categoryId": {
            "type": "string",
            "in": "path",
            "description": "Category ID",
            "required": true,
          },
        },
        "body": {
          "color": { "type": "string", "description": "Preset category color", "required": true },
        },
      },
    }, {
      "id": "delete_category",
      "name": "Delete Category",
      "description": "Delete an Outlook master category",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/outlook/masterCategories/{categoryId}",
        "params": {
          "categoryId": {
            "type": "string",
            "in": "path",
            "description": "Category ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_draft",
      "name": "Create Draft",
      "description": "Create a draft email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages",
        "body": {
          "subject": { "type": "string", "description": "Message subject", "required": true },
          "body": {
            "type": "object",
            "description": "Microsoft Graph itemBody object, for example { contentType, content }",
            "required": true,
          },
          "toRecipients": {
            "type": "array",
            "description": "Microsoft Graph recipient array",
            "required": true,
          },
          "ccRecipients": { "type": "array", "description": "CC recipient array" },
          "bccRecipients": { "type": "array", "description": "BCC recipient array" },
          "replyTo": { "type": "array", "description": "Reply-to recipient array" },
          "importance": {
            "type": "string",
            "description": "Message importance: low, normal, or high",
          },
          "categories": { "type": "array", "description": "Outlook category names" },
        },
      },
    }, {
      "id": "list_drafts",
      "name": "List Drafts",
      "description": "List draft email messages",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/mailFolders/drafts/messages",
        "params": {
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum drafts to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "Sort expression",
            "default": "lastModifiedDateTime desc",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "get_draft",
      "name": "Get Draft",
      "description": "Get a draft message",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Draft message ID",
            "required": true,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,body,bodyPreview,from,sender,toRecipients,ccRecipients,bccRecipients,replyTo,receivedDateTime,sentDateTime,categories,isRead,importance,hasAttachments,webLink,flag",
          },
        },
      },
    }, {
      "id": "update_draft",
      "name": "Update Draft",
      "description": "Update a draft email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Draft message ID",
            "required": true,
          },
        },
        "body": {
          "subject": { "type": "string", "description": "Message subject" },
          "body": {
            "type": "object",
            "description": "Microsoft Graph itemBody object, for example { contentType, content }",
          },
          "toRecipients": { "type": "array", "description": "Microsoft Graph recipient array" },
          "ccRecipients": { "type": "array", "description": "CC recipient array" },
          "bccRecipients": { "type": "array", "description": "BCC recipient array" },
          "replyTo": { "type": "array", "description": "Reply-to recipient array" },
          "importance": {
            "type": "string",
            "description": "Message importance: low, normal, or high",
          },
          "categories": { "type": "array", "description": "Outlook category names" },
        },
      },
    }, {
      "id": "send_draft",
      "name": "Send Draft",
      "description": "Send a draft email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/send",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Draft message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_draft",
      "name": "Delete Draft",
      "description": "Delete a draft email message",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Draft message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "reply_email",
      "name": "Reply Email",
      "description": "Reply to an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/reply",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "comment": { "type": "string", "description": "Reply comment", "required": true },
        },
      },
    }, {
      "id": "reply_all_email",
      "name": "Reply All Email",
      "description": "Reply all to an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/replyAll",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "comment": { "type": "string", "description": "Reply-all comment", "required": true },
        },
      },
    }, {
      "id": "forward_email",
      "name": "Forward Email",
      "description": "Forward an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/forward",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "body": {
          "comment": { "type": "string", "description": "Forward comment" },
          "toRecipients": {
            "type": "array",
            "description": "Recipients to forward to",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_reply_draft",
      "name": "Create Reply Draft",
      "description": "Create a reply draft for an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/createReply",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_reply_all_draft",
      "name": "Create Reply All Draft",
      "description": "Create a reply-all draft for an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/createReplyAll",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_forward_draft",
      "name": "Create Forward Draft",
      "description": "Create a forward draft for an email",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/createForward",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_attachments",
      "name": "List Attachments",
      "description": "List attachments for an email message",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "attachments", "data"],
            "collectionName": "attachments",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "contentType" },
              { "name": "size" },
              { "name": "isInline" },
              { "name": "lastModifiedDateTime" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "attachment binary content and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_attachment",
      "name": "Get Attachment",
      "description": "Get metadata and content for an email attachment",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments/{attachmentId}",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Message ID",
            "required": true,
          },
          "attachmentId": {
            "type": "string",
            "in": "path",
            "description": "Attachment ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "add_attachment_to_message",
      "name": "Add Attachment To Message",
      "description": "Add a small attachment to a draft message",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/messages/{messageId}/attachments",
        "params": {
          "messageId": {
            "type": "string",
            "in": "path",
            "description": "Draft message ID",
            "required": true,
          },
        },
        "body": {
          "@odata.type": {
            "type": "string",
            "description": "Microsoft Graph attachment type",
            "default": "#microsoft.graph.fileAttachment",
          },
          "name": { "type": "string", "description": "Attachment filename", "required": true },
          "contentBytes": {
            "type": "string",
            "description": "Base64-encoded attachment content",
            "required": true,
          },
          "contentType": { "type": "string", "description": "Attachment MIME type" },
          "isInline": {
            "type": "boolean",
            "description": "Whether the attachment is inline",
            "default": false,
          },
        },
      },
    }, {
      "id": "list_conversation_messages",
      "name": "List Conversation Messages",
      "description": "List messages in an Outlook conversation",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq '{conversationId}'",
        "params": {
          "conversationId": {
            "type": "string",
            "in": "path",
            "description": "Conversation ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "list_shared_mailbox_emails",
      "name": "List Shared Mailbox Emails",
      "description":
        "List messages from a shared or delegated mailbox that the signed-in Microsoft account can access",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/users/{mailbox}/mailFolders/{folderId}/messages",
        "params": {
          "mailbox": {
            "type": "string",
            "in": "path",
            "description": "Mailbox user principal name or Microsoft Graph user ID",
            "required": true,
          },
          "folderId": {
            "type": "string",
            "in": "path",
            "description": "Mail folder ID or well-known folder name",
            "required": true,
            "default": "inbox",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "Sort expression",
            "default": "receivedDateTime desc",
          },
          "$filter": { "type": "string", "in": "query", "description": "OData filter expression" },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "search_shared_mailbox_emails",
      "name": "Search Shared Mailbox Emails",
      "description":
        "Search messages in a shared or delegated mailbox that the signed-in Microsoft account can access",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/users/{mailbox}/messages",
        "params": {
          "mailbox": {
            "type": "string",
            "in": "path",
            "description": "Mailbox user principal name or Microsoft Graph user ID",
            "required": true,
          },
          "query": {
            "type": "string",
            "in": "query",
            "description":
              "Microsoft Graph message search query. The runtime quotes the query for Graph $search.",
            "required": true,
            "queryName": "$search",
            "queryValueFormat": "microsoft-graph-search",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated message fields to return",
            "default":
              "id,conversationId,internetMessageId,subject,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,bodyPreview,categories,isRead,importance,hasAttachments,webLink,flag",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "messages"],
            "collectionName": "messages",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "internetMessageId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "toRecipients", "kind": "contact-array" },
              { "name": "ccRecipients", "kind": "contact-array" },
              { "name": "subject" },
              { "name": "receivedDateTime" },
              { "name": "sentDateTime" },
              { "name": "bodyPreview", "maxLength": 300 },
              { "name": "categories", "kind": "string-array" },
              { "name": "isRead" },
              { "name": "importance" },
              { "name": "hasAttachments" },
              { "name": "webLink" },
              { "name": "flag", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large email bodies and provider-specific message fields",
          },
        },
      },
    }, {
      "id": "find_group_by_mail",
      "name": "Find Group By Mail",
      "description":
        "Find a Microsoft 365 group by primary email address before reading its group inbox threads",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/groups?$filter=mail eq '{mailAddress}'",
        "params": {
          "mailAddress": {
            "type": "string",
            "in": "path",
            "description": "Microsoft 365 group primary email address",
            "required": true,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated group fields to return",
            "default": "id,displayName,mail,mailNickname,groupTypes,securityEnabled,mailEnabled",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum groups to return",
            "default": 5,
          },
        },
        "response": { "transform": "value" },
      },
    }, {
      "id": "list_group_threads",
      "name": "List Group Threads",
      "description": "List Microsoft 365 group inbox conversation threads",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/groups/{groupId}/threads",
        "params": {
          "groupId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft 365 group ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum threads to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated thread fields to return",
            "default":
              "id,topic,hasAttachments,lastDeliveredDateTime,uniqueSenders,preview,isLocked",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "threads"],
            "collectionName": "threads",
            "itemFields": [
              { "name": "id" },
              { "name": "topic" },
              { "name": "hasAttachments" },
              { "name": "lastDeliveredDateTime" },
              { "name": "uniqueSenders", "kind": "string-array" },
              { "name": "preview", "maxLength": 300 },
              { "name": "isLocked" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large group thread payload fields",
          },
        },
      },
    }, {
      "id": "list_group_thread_posts",
      "name": "List Group Thread Posts",
      "description": "List posts from a Microsoft 365 group inbox conversation thread",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/groups/{groupId}/threads/{threadId}/posts",
        "params": {
          "groupId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft 365 group ID",
            "required": true,
          },
          "threadId": {
            "type": "string",
            "in": "path",
            "description": "Conversation thread ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum posts to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated post fields to return",
            "default":
              "id,conversationId,conversationThreadId,from,sender,newParticipants,receivedDateTime,hasAttachments,body,importance",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "data", "posts"],
            "collectionName": "posts",
            "itemFields": [
              { "name": "id" },
              { "name": "conversationId" },
              { "name": "conversationThreadId" },
              { "name": "from", "kind": "contact" },
              { "name": "sender", "kind": "contact" },
              { "name": "newParticipants", "kind": "contact-array" },
              { "name": "receivedDateTime" },
              { "name": "hasAttachments" },
              { "name": "body", "kind": "object" },
              { "name": "importance" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "large group post bodies and provider-specific post fields",
          },
        },
      },
    }, {
      "id": "list_calendars",
      "name": "List Calendars",
      "description": "List Outlook calendars",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/calendars",
        "params": {
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum calendars to return",
            "default": 100,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "calendars", "data"],
            "collectionName": "calendars",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "color" },
              { "name": "isDefaultCalendar" },
              { "name": "canEdit" },
              { "name": "canShare" },
              { "name": "owner", "kind": "object" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "calendar provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_calendar",
      "name": "Get Calendar",
      "description": "Get metadata for an Outlook calendar",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/calendars/{calendarId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_calendar",
      "name": "Create Calendar",
      "description": "Create an Outlook calendar",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/calendars",
        "body": { "name": { "type": "string", "description": "Calendar name", "required": true } },
      },
    }, {
      "id": "update_calendar",
      "name": "Update Calendar",
      "description": "Update an Outlook calendar",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/calendars/{calendarId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
          },
        },
        "body": {
          "name": { "type": "string", "description": "Calendar name" },
          "color": { "type": "string", "description": "Calendar color" },
        },
      },
    }, {
      "id": "delete_calendar",
      "name": "Delete Calendar",
      "description": "Delete an Outlook calendar",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/calendars/{calendarId}",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_events",
      "name": "List Events",
      "description": "List events from a specific Outlook calendar",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/calendars/{calendarId}/events",
        "params": {
          "calendarId": {
            "type": "string",
            "in": "path",
            "description": "Calendar ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum events to return",
            "default": 25,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated event fields to return",
            "default":
              "id,subject,bodyPreview,organizer,attendees,start,end,location,locations,isOnlineMeeting,onlineMeetingProvider,webLink,showAs,responseStatus,categories,importance,hasAttachments,recurrence",
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "Sort expression",
            "default": "start/dateTime",
          },
          "$filter": { "type": "string", "in": "query", "description": "OData filter expression" },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "events", "data"],
            "collectionName": "events",
            "itemFields": [
              { "name": "id" },
              { "name": "subject" },
              { "name": "organizer", "kind": "contact" },
              { "name": "attendees", "kind": "contact-array" },
              { "name": "start", "kind": "object" },
              { "name": "end", "kind": "object" },
              { "name": "location", "kind": "object" },
              { "name": "showAs" },
              { "name": "responseStatus", "kind": "object" },
              { "name": "isOnlineMeeting" },
              { "name": "webLink" },
              { "name": "bodyPreview", "maxLength": 300 },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "full event bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_calendar_view",
      "name": "List Calendar View",
      "description": "List occurrences in a calendar time window",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/calendarView",
        "params": {
          "startDateTime": {
            "type": "string",
            "in": "query",
            "description": "Window start ISO date/time",
            "required": true,
          },
          "endDateTime": {
            "type": "string",
            "in": "query",
            "description": "Window end ISO date/time",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum events to return",
            "default": 50,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated event fields to return",
            "default":
              "id,subject,bodyPreview,organizer,attendees,start,end,location,locations,isOnlineMeeting,onlineMeetingProvider,webLink,showAs,responseStatus,categories,importance,hasAttachments,recurrence",
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "Sort expression",
            "default": "start/dateTime",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "events", "data"],
            "collectionName": "events",
            "itemFields": [
              { "name": "id" },
              { "name": "subject" },
              { "name": "organizer", "kind": "contact" },
              { "name": "attendees", "kind": "contact-array" },
              { "name": "start", "kind": "object" },
              { "name": "end", "kind": "object" },
              { "name": "location", "kind": "object" },
              { "name": "showAs" },
              { "name": "responseStatus", "kind": "object" },
              { "name": "isOnlineMeeting" },
              { "name": "webLink" },
              { "name": "bodyPreview", "maxLength": 300 },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "full event bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_event",
      "name": "Get Event",
      "description": "Get details for an Outlook event",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated event fields to return",
            "default":
              "id,subject,bodyPreview,organizer,attendees,start,end,location,locations,isOnlineMeeting,onlineMeetingProvider,webLink,showAs,responseStatus,categories,importance,hasAttachments,recurrence",
          },
        },
      },
    }, {
      "id": "create_event",
      "name": "Create Event",
      "description": "Create an Outlook calendar event",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/events",
        "body": {
          "subject": { "type": "string", "description": "Event subject", "required": true },
          "body": {
            "type": "object",
            "description": "Microsoft Graph itemBody object, for example { contentType, content }",
          },
          "start": {
            "type": "object",
            "description": "Start date/time object with dateTime and timeZone",
            "required": true,
          },
          "end": {
            "type": "object",
            "description": "End date/time object with dateTime and timeZone",
            "required": true,
          },
          "attendees": { "type": "array", "description": "Attendee array" },
          "location": { "type": "object", "description": "Primary event location" },
          "locations": { "type": "array", "description": "Additional event locations" },
          "categories": { "type": "array", "description": "Outlook category names" },
          "importance": {
            "type": "string",
            "description": "Event importance: low, normal, or high",
          },
          "showAs": {
            "type": "string",
            "description": "Free/busy status such as free, busy, tentative, or oof",
          },
          "isOnlineMeeting": {
            "type": "boolean",
            "description": "Whether to create an online meeting",
          },
          "onlineMeetingProvider": {
            "type": "string",
            "description": "Online meeting provider such as teamsForBusiness",
          },
          "recurrence": {
            "type": "object",
            "description": "Microsoft Graph patternedRecurrence object",
          },
        },
      },
    }, {
      "id": "update_event",
      "name": "Update Event",
      "description": "Update an Outlook calendar event",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
        },
        "body": {
          "subject": { "type": "string", "description": "Event subject" },
          "body": {
            "type": "object",
            "description": "Microsoft Graph itemBody object, for example { contentType, content }",
          },
          "start": {
            "type": "object",
            "description": "Start date/time object with dateTime and timeZone",
          },
          "end": {
            "type": "object",
            "description": "End date/time object with dateTime and timeZone",
          },
          "attendees": { "type": "array", "description": "Attendee array" },
          "location": { "type": "object", "description": "Primary event location" },
          "locations": { "type": "array", "description": "Additional event locations" },
          "categories": { "type": "array", "description": "Outlook category names" },
          "importance": {
            "type": "string",
            "description": "Event importance: low, normal, or high",
          },
          "showAs": {
            "type": "string",
            "description": "Free/busy status such as free, busy, tentative, or oof",
          },
          "isOnlineMeeting": {
            "type": "boolean",
            "description": "Whether to create an online meeting",
          },
          "onlineMeetingProvider": {
            "type": "string",
            "description": "Online meeting provider such as teamsForBusiness",
          },
          "recurrence": {
            "type": "object",
            "description": "Microsoft Graph patternedRecurrence object",
          },
        },
      },
    }, {
      "id": "delete_event",
      "name": "Delete Event",
      "description": "Delete an Outlook calendar event",
      "requiresWrite": true,
      "endpoint": {
        "method": "DELETE",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "respond_to_event",
      "name": "Respond To Event",
      "description": "Accept, tentatively accept, or decline an event invitation",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}/{responseAction}",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
          "responseAction": {
            "type": "string",
            "in": "path",
            "description": "Response action: accept, tentativelyAccept, or decline",
            "required": true,
          },
        },
        "body": {
          "comment": { "type": "string", "description": "Response comment" },
          "sendResponse": {
            "type": "boolean",
            "description": "Send a response to the organizer",
            "default": true,
          },
        },
      },
    }, {
      "id": "get_event_instances",
      "name": "Get Event Instances",
      "description": "List instances of a recurring event in a time window",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}/instances",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Recurring event ID",
            "required": true,
          },
          "startDateTime": {
            "type": "string",
            "in": "query",
            "description": "Window start ISO date/time",
            "required": true,
          },
          "endDateTime": {
            "type": "string",
            "in": "query",
            "description": "Window end ISO date/time",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum instances to return",
            "default": 50,
          },
          "$select": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated event fields to return",
            "default":
              "id,subject,bodyPreview,organizer,attendees,start,end,location,locations,isOnlineMeeting,onlineMeetingProvider,webLink,showAs,responseStatus,categories,importance,hasAttachments,recurrence",
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "events", "data"],
            "collectionName": "events",
            "itemFields": [
              { "name": "id" },
              { "name": "subject" },
              { "name": "organizer", "kind": "contact" },
              { "name": "attendees", "kind": "contact-array" },
              { "name": "start", "kind": "object" },
              { "name": "end", "kind": "object" },
              { "name": "location", "kind": "object" },
              { "name": "showAs" },
              { "name": "responseStatus", "kind": "object" },
              { "name": "isOnlineMeeting" },
              { "name": "webLink" },
              { "name": "bodyPreview", "maxLength": 300 },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "full event bodies and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "list_event_attachments",
      "name": "List Event Attachments",
      "description": "List attachments for an event",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}/attachments",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "attachments", "data"],
            "collectionName": "attachments",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "contentType" },
              { "name": "size" },
              { "name": "isInline" },
              { "name": "lastModifiedDateTime" },
            ],
            "outputFields": [{ "name": "@odata.nextLink" }, { "name": "@odata.count" }],
            "omitted": "attachment binary content and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "get_event_attachment",
      "name": "Get Event Attachment",
      "description": "Get metadata and content for an event attachment",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}/attachments/{attachmentId}",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
          "attachmentId": {
            "type": "string",
            "in": "path",
            "description": "Attachment ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "add_event_attachment",
      "name": "Add Event Attachment",
      "description": "Add a small attachment to an event",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/events/{eventId}/attachments",
        "params": {
          "eventId": {
            "type": "string",
            "in": "path",
            "description": "Event ID",
            "required": true,
          },
        },
        "body": {
          "@odata.type": {
            "type": "string",
            "description": "Microsoft Graph attachment type",
            "default": "#microsoft.graph.fileAttachment",
          },
          "name": { "type": "string", "description": "Attachment filename", "required": true },
          "contentBytes": {
            "type": "string",
            "description": "Base64-encoded attachment content",
            "required": true,
          },
          "contentType": { "type": "string", "description": "Attachment MIME type" },
          "isInline": {
            "type": "boolean",
            "description": "Whether the attachment is inline",
            "default": false,
          },
        },
      },
    }, {
      "id": "find_free_time",
      "name": "Find Free Time",
      "description": "Return free/busy schedule information for users or resources",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
        "body": {
          "schedules": {
            "type": "array",
            "description": "Email addresses or schedule IDs to query",
            "required": true,
          },
          "startTime": {
            "type": "object",
            "description": "Window start dateTimeTimeZone object",
            "required": true,
          },
          "endTime": {
            "type": "object",
            "description": "Window end dateTimeTimeZone object",
            "required": true,
          },
          "availabilityViewInterval": {
            "type": "number",
            "description": "Availability view interval in minutes",
            "default": 30,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "schedules", "data"],
            "collectionName": "schedules",
            "itemFields": [
              { "name": "scheduleId" },
              { "name": "availabilityView" },
              { "name": "scheduleItems", "kind": "object" },
              { "name": "workingHours", "kind": "object" },
              { "name": "error", "kind": "object" },
            ],
            "omitted":
              "provider-specific schedule diagnostics and expanded free/busy payload fields",
          },
        },
      },
    }, {
      "id": "get_schedule",
      "name": "Get Schedule",
      "description": "Get detailed free/busy schedule information",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/calendar/getSchedule",
        "body": {
          "schedules": {
            "type": "array",
            "description": "Email addresses or schedule IDs to query",
            "required": true,
          },
          "startTime": {
            "type": "object",
            "description": "Window start dateTimeTimeZone object",
            "required": true,
          },
          "endTime": {
            "type": "object",
            "description": "Window end dateTimeTimeZone object",
            "required": true,
          },
          "availabilityViewInterval": {
            "type": "number",
            "description": "Availability view interval in minutes",
            "default": 30,
          },
        },
        "response": {
          "transform": "value",
          "historicalSummary": {
            "collectionKeys": ["value", "schedules", "data"],
            "collectionName": "schedules",
            "itemFields": [
              { "name": "scheduleId" },
              { "name": "availabilityView" },
              { "name": "scheduleItems", "kind": "object" },
              { "name": "workingHours", "kind": "object" },
              { "name": "error", "kind": "object" },
            ],
            "omitted":
              "provider-specific schedule diagnostics and expanded free/busy payload fields",
          },
        },
      },
    }, {
      "id": "find_meeting_times",
      "name": "Find Meeting Times",
      "description": "Find meeting time suggestions from attendees and constraints",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/me/findMeetingTimes",
        "body": {
          "attendees": { "type": "array", "description": "Attendee array", "required": true },
          "timeConstraint": {
            "type": "object",
            "description": "Meeting time constraint object",
            "required": true,
          },
          "meetingDuration": {
            "type": "string",
            "description": "ISO 8601 meeting duration, for example PT1H",
          },
          "maxCandidates": {
            "type": "number",
            "description": "Maximum meeting suggestions to return",
            "default": 10,
          },
          "isOrganizerOptional": {
            "type": "boolean",
            "description": "Whether organizer attendance is optional",
          },
          "returnSuggestionReasons": {
            "type": "boolean",
            "description": "Return suggestion reason text",
            "default": true,
          },
          "minimumAttendeePercentage": {
            "type": "number",
            "description": "Minimum attendee availability percentage",
          },
        },
        "response": {
          "transform": "meetingTimeSuggestions",
          "historicalSummary": {
            "collectionKeys": ["meetingTimeSuggestions", "value", "data"],
            "collectionName": "meetingTimeSuggestions",
            "itemFields": [
              { "name": "confidence" },
              { "name": "organizerAvailability" },
              { "name": "attendeeAvailability", "kind": "object" },
              { "name": "meetingTimeSlot", "kind": "object" },
              { "name": "locations", "kind": "object" },
              { "name": "suggestionReason", "maxLength": 300 },
            ],
            "omitted": "provider-specific meeting suggestion diagnostics",
          },
        },
      },
    }],
    "prompts": [{
      "id": "check_emails",
      "title": "Check my emails",
      "prompt": "List my recent unread emails and summarize the most important ones.",
      "category": "productivity",
      "icon": "mail",
    }, {
      "id": "search_emails",
      "title": "Search my emails",
      "prompt": "Search my emails for specific topics, senders, or date ranges.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "draft_email",
      "title": "Draft an email",
      "prompt": "Help me draft a professional email with proper formatting and tone.",
      "category": "productivity",
      "icon": "compose",
    }],
    "suggestedWith": ["teams", "calendar", "gmail"],
  },
  {
    "name": "persona",
    "displayName": "Persona",
    "icon": "persona.svg",
    "description": "Run KYC onboarding, identity verification, and compliance reviews with Persona",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Persona API",
        "enableUrl": "https://docs.withpersona.com/api-reference",
      }],
      "keyName": "PERSONA_API_KEY",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "PERSONA_API_KEY",
      "description": "Persona API key",
      "required": true,
      "sensitive": true,
    }],
    "tools": [{
      "id": "list_inquiries",
      "name": "List Inquiries",
      "description": "List Persona inquiries for KYC and onboarding review",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.withpersona.com/api/v1/inquiries",
        "params": {
          "page[limit]": {
            "type": "number",
            "in": "query",
            "description": "Maximum inquiries to return",
            "default": 25,
          },
          "filter[status]": {
            "type": "string",
            "in": "query",
            "description": "Optional inquiry status filter",
          },
        },
      },
    }, {
      "id": "get_inquiry",
      "name": "Get Inquiry",
      "description": "Get a Persona inquiry by ID",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://api.withpersona.com/api/v1/inquiries/{inquiryId}",
        "params": {
          "inquiryId": {
            "type": "string",
            "in": "path",
            "description": "Persona inquiry ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "approve_inquiry",
      "name": "Approve Inquiry",
      "description": "Approve a Persona inquiry after compliance review",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.withpersona.com/api/v1/inquiries/{inquiryId}/approve",
        "params": {
          "inquiryId": {
            "type": "string",
            "in": "path",
            "description": "Persona inquiry ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "decline_inquiry",
      "name": "Decline Inquiry",
      "description": "Decline a Persona inquiry after compliance review",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://api.withpersona.com/api/v1/inquiries/{inquiryId}/decline",
        "params": {
          "inquiryId": {
            "type": "string",
            "in": "path",
            "description": "Persona inquiry ID",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "kyc_queue",
      "title": "Review KYC queue",
      "prompt":
        "Review Persona inquiries that need KYC action and prioritize cases with document or risk issues.",
      "category": "compliance",
    }, {
      "id": "regulatory_review",
      "title": "Regulatory review",
      "prompt":
        "Summarize Persona inquiry evidence and recommend the next regulatory review action.",
      "category": "compliance",
    }],
    "suggestedWith": ["sharepoint", "jira", "slack"],
    "category": "compliance",
  },
  {
    "name": "posthog",
    "displayName": "PostHog",
    "icon": "posthog.svg",
    "description": "Access analytics, feature flags, and user insights from PostHog",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "PostHog API",
        "enableUrl": "https://app.posthog.com/project/settings",
      }],
      "keyName": "POSTHOG_API_KEY",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "POSTHOG_API_KEY",
      "description": "PostHog Personal API Key",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://posthog.com/docs/api/overview",
    }, {
      "name": "POSTHOG_HOST",
      "description": "PostHog API host (defaults to https://app.posthog.com)",
      "required": false,
      "sensitive": false,
      "docsUrl": "https://posthog.com/docs/self-host",
    }],
    "tools": [{
      "id": "get_trends",
      "name": "Get Trends",
      "description": "Retrieve event trends and analytics data",
      "requiresWrite": false,
    }, {
      "id": "list_feature_flags",
      "name": "List Feature Flags",
      "description": "List all feature flags in your PostHog project",
      "requiresWrite": false,
    }, {
      "id": "list_persons",
      "name": "List Persons",
      "description": "List persons/users tracked in PostHog",
      "requiresWrite": false,
    }, {
      "id": "capture_event",
      "name": "Capture Event",
      "description": "Track a custom event in PostHog",
      "requiresWrite": true,
    }],
    "prompts": [{
      "id": "trend_analysis",
      "title": "Trend analysis",
      "prompt": "Show me the trends for key events in my PostHog project over the last 7 days.",
      "category": "analytics",
      "icon": "chart",
    }, {
      "id": "feature_flag_status",
      "title": "Feature flag status",
      "prompt": "List all active feature flags and their current rollout status.",
      "category": "analytics",
      "icon": "flag",
    }, {
      "id": "user_insights",
      "title": "User insights",
      "prompt": "Give me insights about recent user activity and top users in my PostHog project.",
      "category": "analytics",
      "icon": "users",
    }],
    "suggestedWith": ["slack", "analytics", "monitoring"],
  },
  {
    "name": "salesforce",
    "displayName": "Salesforce",
    "icon": "salesforce.svg",
    "description": "Manage accounts, contacts, opportunities, and leads in your Salesforce CRM",
    "auth": {
      "type": "oauth2",
      "provider": "salesforce",
      "authorizationUrl": "https://login.salesforce.com/services/oauth2/authorize",
      "tokenUrl": "https://login.salesforce.com/services/oauth2/token",
      "scopes": ["api", "refresh_token", "offline_access"],
      "tokenAuthMethod": "request_body",
      "requiredApis": [{
        "name": "Salesforce Connected App",
        "enableUrl": "https://login.salesforce.com/",
      }],
    },
    "envVars": [{
      "name": "SALESFORCE_CLIENT_ID",
      "description": "Salesforce OAuth Consumer Key (from your Connected App)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
    }, {
      "name": "SALESFORCE_CLIENT_SECRET",
      "description": "Salesforce OAuth Consumer Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm",
    }],
    "tools": [{
      "id": "list_accounts",
      "name": "List Accounts",
      "description": "List accounts from your Salesforce CRM",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "{{oauth.raw.instance_url}}/services/data/v61.0/query",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "SOQL query for accounts",
            "default":
              "SELECT Id, Name, Type, Industry, Phone, Website FROM Account ORDER BY LastModifiedDate DESC LIMIT 50",
          },
        },
        "response": { "transform": "records" },
      },
    }, {
      "id": "get_account",
      "name": "Get Account",
      "description": "Get detailed information about a specific account",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "{{oauth.raw.instance_url}}/services/data/v61.0/sobjects/Account/{accountId}",
        "params": {
          "accountId": {
            "type": "string",
            "in": "path",
            "description": "Salesforce Account ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_contacts",
      "name": "List Contacts",
      "description": "List contacts from your Salesforce CRM",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "{{oauth.raw.instance_url}}/services/data/v61.0/query",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "SOQL query for contacts",
            "default":
              "SELECT Id, FirstName, LastName, Email, Phone, AccountId FROM Contact ORDER BY LastModifiedDate DESC LIMIT 50",
          },
        },
        "response": { "transform": "records" },
      },
    }, {
      "id": "list_opportunities",
      "name": "List Opportunities",
      "description": "List sales opportunities from your Salesforce CRM",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "{{oauth.raw.instance_url}}/services/data/v61.0/query",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "SOQL query for opportunities",
            "default":
              "SELECT Id, Name, StageName, Amount, CloseDate, AccountId FROM Opportunity ORDER BY CloseDate DESC LIMIT 50",
          },
        },
        "response": { "transform": "records" },
      },
    }, {
      "id": "create_lead",
      "name": "Create Lead",
      "description": "Create a new lead in Salesforce CRM",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "{{oauth.raw.instance_url}}/services/data/v61.0/sobjects/Lead",
        "body": {
          "LastName": { "type": "string", "description": "Lead last name", "required": true },
          "Company": { "type": "string", "description": "Lead company", "required": true },
          "FirstName": { "type": "string", "description": "Lead first name" },
          "Email": { "type": "string", "description": "Lead email address" },
          "Phone": { "type": "string", "description": "Lead phone number" },
          "Status": { "type": "string", "description": "Lead status" },
        },
      },
    }],
    "prompts": [{
      "id": "find_accounts",
      "title": "Find accounts",
      "prompt": "Search for accounts in my Salesforce CRM and show me their key information.",
      "category": "crm",
      "icon": "search",
    }, {
      "id": "create_lead",
      "title": "Create a lead",
      "prompt": "Create a new lead in Salesforce CRM with the information I provide.",
      "category": "crm",
      "icon": "plus",
    }, {
      "id": "pipeline_summary",
      "title": "Pipeline summary",
      "prompt": "Show me a summary of my current sales opportunities and pipeline status.",
      "category": "crm",
      "icon": "chart",
    }, {
      "id": "contact_lookup",
      "title": "Contact lookup",
      "prompt": "Find and display information about specific contacts in my Salesforce CRM.",
      "category": "crm",
      "icon": "user",
    }],
    "suggestedWith": ["gmail", "slack", "calendar"],
  },
  {
    "name": "sap",
    "displayName": "SAP S/4HANA",
    "icon": "sap.svg",
    "description": "Manage supplier invoices and finance operations in SAP S/4HANA",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "SAP S/4HANA Supplier Invoice OData API",
        "enableUrl": "https://api.sap.com/package/SAPS4HANACloud",
      }],
      "keyName": "SAP_ACCESS_TOKEN",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "SAP_HOST",
      "description": "SAP S/4HANA host, for example mytenant-api.s4hana.cloud.sap",
      "required": true,
    }, {
      "name": "SAP_ACCESS_TOKEN",
      "description": "SAP S/4HANA API access token",
      "required": true,
      "sensitive": true,
    }],
    "tools": [{
      "id": "list_supplier_invoices",
      "name": "List Supplier Invoices",
      "description": "List supplier invoices from SAP S/4HANA with optional OData filters",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://{sapHost}/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice",
        "params": {
          "sapHost": {
            "type": "string",
            "in": "path",
            "description": "SAP S/4HANA host, for example mytenant-api.s4hana.cloud.sap",
            "required": true,
          },
          "$filter": { "type": "string", "in": "query", "description": "OData filter expression" },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum invoices to return",
            "default": 25,
          },
          "$orderby": {
            "type": "string",
            "in": "query",
            "description": "OData ordering expression",
            "default": "PostingDate desc",
          },
          "$format": {
            "type": "string",
            "in": "query",
            "description": "Response format",
            "default": "json",
          },
        },
      },
    }, {
      "id": "get_supplier_invoice",
      "name": "Get Supplier Invoice",
      "description": "Get a supplier invoice by invoice number and fiscal year",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url":
          "https://{sapHost}/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice(SupplierInvoice='{supplierInvoice}',FiscalYear='{fiscalYear}')",
        "params": {
          "sapHost": {
            "type": "string",
            "in": "path",
            "description": "SAP S/4HANA host, for example mytenant-api.s4hana.cloud.sap",
            "required": true,
          },
          "supplierInvoice": {
            "type": "string",
            "in": "path",
            "description": "SAP supplier invoice number",
            "required": true,
          },
          "fiscalYear": {
            "type": "string",
            "in": "path",
            "description": "Fiscal year",
            "required": true,
          },
          "$format": {
            "type": "string",
            "in": "query",
            "description": "Response format",
            "default": "json",
          },
        },
      },
    }, {
      "id": "release_supplier_invoice",
      "name": "Release Supplier Invoice",
      "description": "Release a blocked supplier invoice in SAP S/4HANA",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://{sapHost}/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/Release",
        "params": {
          "sapHost": {
            "type": "string",
            "in": "path",
            "description": "SAP S/4HANA host, for example mytenant-api.s4hana.cloud.sap",
            "required": true,
          },
          "SupplierInvoice": {
            "type": "string",
            "in": "query",
            "description": "SAP supplier invoice number",
            "required": true,
          },
          "FiscalYear": {
            "type": "string",
            "in": "query",
            "description": "Fiscal year",
            "required": true,
          },
          "DiscountDaysHaveToBeShifted": {
            "type": "boolean",
            "in": "query",
            "description": "Whether SAP should shift discount days during release",
          },
        },
      },
    }],
    "prompts": [{
      "id": "invoice_review",
      "title": "Review supplier invoices",
      "prompt":
        "Review recent SAP supplier invoices and flag blocked or unmatched invoices that need finance approval.",
      "category": "finance",
    }, {
      "id": "reconciliation",
      "title": "Reconcile invoices",
      "prompt":
        "Compare SAP supplier invoices against purchase order references and summarize reconciliation issues.",
      "category": "finance",
    }],
    "suggestedWith": ["sharepoint", "gmail", "slack"],
    "category": "finance",
  },
  {
    "name": "sentry",
    "displayName": "Sentry",
    "icon": "sentry.svg",
    "description": "Monitor errors, track issues, and manage Sentry projects",
    "auth": {
      "type": "oauth2",
      "provider": "sentry",
      "authorizationUrl": "https://sentry.io/oauth/authorize/",
      "tokenUrl": "https://sentry.io/oauth/token/",
      "scopes": ["org:read", "project:read", "event:read", "event:write"],
      "tokenAuthMethod": "none",
      "pkce": true,
      "supportsRefreshToken": true,
      "requiredApis": [{
        "name": "Sentry OAuth Application",
        "enableUrl": "https://sentry.io/settings/account/api/applications/",
      }],
    },
    "envVars": [{
      "name": "SENTRY_CLIENT_ID",
      "description": "Sentry OAuth Client ID from your public OAuth application",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.sentry.io/api/auth/",
    }, {
      "name": "SENTRY_ORG",
      "description": "Default Sentry organization slug for prompts that do not specify one",
      "required": false,
      "sensitive": false,
      "docsUrl": "https://docs.sentry.io/api/organizations/",
    }],
    "tools": [{
      "id": "list_organizations",
      "name": "List Organizations",
      "description":
        "List Sentry organizations available to the authenticated user so agents can discover organization slugs before project or issue calls",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sentry.io/api/0/organizations/",
        "params": {
          "owner": {
            "type": "boolean",
            "in": "query",
            "description":
              "Restrict results to organizations where the authenticated user is an owner",
          },
          "query": {
            "type": "string",
            "in": "query",
            "description": "Filter organizations by name, slug, status, id, email, or member id",
          },
          "cursor": { "type": "string", "in": "query", "description": "Pagination cursor" },
        },
      },
    }, {
      "id": "list_projects",
      "name": "List Projects",
      "description": "List Sentry projects for an organization",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sentry.io/api/0/organizations/{organizationSlug}/projects/",
        "params": {
          "organizationSlug": {
            "type": "string",
            "in": "path",
            "description": "Sentry organization slug",
            "required": true,
          },
          "cursor": { "type": "string", "in": "query", "description": "Pagination cursor" },
        },
      },
    }, {
      "id": "list_issues",
      "name": "List Issues",
      "description": "List Sentry issues for a project",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sentry.io/api/0/projects/{organizationSlug}/{projectSlug}/issues/",
        "params": {
          "organizationSlug": {
            "type": "string",
            "in": "path",
            "description": "Sentry organization slug",
            "required": true,
          },
          "projectSlug": {
            "type": "string",
            "in": "path",
            "description": "Sentry project slug",
            "required": true,
          },
          "query": {
            "type": "string",
            "in": "query",
            "description": "Sentry issue search query, for example is:unresolved",
          },
          "statsPeriod": {
            "type": "string",
            "in": "query",
            "description": "Stats period, for example 24h, 14d, or 30d",
          },
          "limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of issues to return",
          },
          "cursor": { "type": "string", "in": "query", "description": "Pagination cursor" },
        },
      },
    }, {
      "id": "get_issue",
      "name": "Get Issue",
      "description": "Get details for a Sentry issue",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sentry.io/api/0/organizations/{organizationSlug}/issues/{issueId}/",
        "params": {
          "organizationSlug": {
            "type": "string",
            "in": "path",
            "description": "Sentry organization slug",
            "required": true,
          },
          "issueId": {
            "type": "string",
            "in": "path",
            "description": "Sentry issue ID",
            "required": true,
          },
          "collapse": {
            "type": "string[]",
            "in": "query",
            "description": "Optional response sections to collapse",
          },
        },
      },
    }, {
      "id": "resolve_issue",
      "name": "Resolve Issue",
      "description": "Resolve a Sentry issue",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://sentry.io/api/0/organizations/{organizationSlug}/issues/{issueId}/",
        "params": {
          "organizationSlug": {
            "type": "string",
            "in": "path",
            "description": "Sentry organization slug",
            "required": true,
          },
          "issueId": {
            "type": "string",
            "in": "path",
            "description": "Sentry issue ID",
            "required": true,
          },
        },
        "body": {
          "status": { "type": "string", "description": "New issue status", "default": "resolved" },
          "statusDetails": { "type": "object", "description": "Optional Sentry status details" },
        },
      },
    }],
    "prompts": [{
      "id": "check_errors",
      "title": "Check recent errors",
      "prompt":
        "Show me recent errors and issues in my Sentry projects and help me prioritize which ones to fix.",
      "category": "development",
      "icon": "alert-triangle",
    }, {
      "id": "analyze_issue",
      "title": "Analyze an issue",
      "prompt":
        "Help me analyze a specific Sentry issue, understand its root cause, and suggest a fix.",
      "category": "development",
      "icon": "bug",
    }, {
      "id": "project_health",
      "title": "Project health check",
      "prompt":
        "Give me an overview of the health of my Sentry projects, including error rates and trending issues.",
      "category": "analytics",
      "icon": "activity",
    }],
    "suggestedWith": ["github", "slack", "linear"],
    "category": "development",
  },
  {
    "name": "servicenow",
    "displayName": "ServiceNow",
    "icon": "servicenow.svg",
    "description": "IT Service Management - incidents, changes, and service requests",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "ServiceNow Table API",
        "enableUrl": "https://developer.servicenow.com/dev.do",
      }],
      "keyName": "SERVICENOW_ACCESS_TOKEN",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "SERVICENOW_INSTANCE",
      "description": "ServiceNow instance URL (e.g. your-instance.service-now.com)",
      "required": true,
    }, {
      "name": "SERVICENOW_ACCESS_TOKEN",
      "description": "ServiceNow OAuth access token for the Table API",
      "required": true,
      "sensitive": true,
    }],
    "tools": [{
      "id": "list_incidents",
      "name": "List Incidents",
      "description": "List ServiceNow incidents with optional filters",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{instanceHost}/api/now/v1/table/incident",
        "params": {
          "instanceHost": {
            "type": "string",
            "in": "path",
            "description": "ServiceNow instance host, for example example.service-now.com",
            "required": true,
          },
          "sysparm_query": {
            "type": "string",
            "in": "query",
            "description": "Encoded ServiceNow query",
            "default": "active=true^ORDERBYDESCsys_updated_on",
          },
          "sysparm_limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum incidents to return",
            "default": 25,
          },
          "sysparm_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated incident fields to return",
            "default":
              "sys_id,number,short_description,description,state,impact,urgency,priority,assignment_group,assigned_to,opened_at,sys_updated_on",
          },
        },
        "response": { "transform": "result" },
      },
    }, {
      "id": "get_incident",
      "name": "Get Incident",
      "description": "Get details of a specific incident",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{instanceHost}/api/now/v1/table/incident/{sysId}",
        "params": {
          "instanceHost": {
            "type": "string",
            "in": "path",
            "description": "ServiceNow instance host, for example example.service-now.com",
            "required": true,
          },
          "sysId": {
            "type": "string",
            "in": "path",
            "description": "Incident sys_id",
            "required": true,
          },
          "sysparm_display_value": {
            "type": "string",
            "in": "query",
            "description": "Display value mode",
            "default": "all",
          },
        },
        "response": { "transform": "result" },
      },
    }, {
      "id": "create_incident",
      "name": "Create Incident",
      "description": "Create a new incident in ServiceNow",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://{instanceHost}/api/now/v1/table/incident",
        "params": {
          "instanceHost": {
            "type": "string",
            "in": "path",
            "description": "ServiceNow instance host, for example example.service-now.com",
            "required": true,
          },
        },
        "body": {
          "short_description": {
            "type": "string",
            "description": "Incident short description",
            "required": true,
          },
          "description": { "type": "string", "description": "Incident description" },
          "impact": { "type": "string", "description": "Business impact, typically 1, 2, or 3" },
          "urgency": { "type": "string", "description": "Incident urgency, typically 1, 2, or 3" },
          "category": { "type": "string", "description": "Incident category" },
          "assignment_group": {
            "type": "string",
            "description": "Assignment group sys_id or display value",
          },
        },
        "response": { "transform": "result" },
      },
    }, {
      "id": "update_incident",
      "name": "Update Incident",
      "description": "Update an existing incident",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://{instanceHost}/api/now/v1/table/incident/{sysId}",
        "params": {
          "instanceHost": {
            "type": "string",
            "in": "path",
            "description": "ServiceNow instance host, for example example.service-now.com",
            "required": true,
          },
          "sysId": {
            "type": "string",
            "in": "path",
            "description": "Incident sys_id",
            "required": true,
          },
        },
        "body": {
          "state": { "type": "string", "description": "Incident state" },
          "priority": { "type": "string", "description": "Incident priority" },
          "assignment_group": {
            "type": "string",
            "description": "Assignment group sys_id or display value",
          },
          "assigned_to": { "type": "string", "description": "Assignee sys_id or display value" },
          "work_notes": { "type": "string", "description": "Internal work notes" },
          "comments": { "type": "string", "description": "Customer-visible comments" },
        },
        "response": { "transform": "result" },
      },
    }, {
      "id": "search_knowledge",
      "name": "Search Knowledge Base",
      "description": "Search ServiceNow knowledge base articles",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{instanceHost}/api/now/v1/table/kb_knowledge",
        "params": {
          "instanceHost": {
            "type": "string",
            "in": "path",
            "description": "ServiceNow instance host, for example example.service-now.com",
            "required": true,
          },
          "sysparm_query": {
            "type": "string",
            "in": "query",
            "description": "Encoded query for knowledge articles",
            "required": true,
          },
          "sysparm_limit": {
            "type": "number",
            "in": "query",
            "description": "Maximum articles to return",
            "default": 10,
          },
          "sysparm_fields": {
            "type": "string",
            "in": "query",
            "description": "Comma-separated article fields",
            "default": "sys_id,number,short_description,text,workflow_state,sys_updated_on",
          },
        },
        "response": { "transform": "result" },
      },
    }],
    "prompts": [{
      "id": "check_ticket_status",
      "title": "Check ticket status",
      "prompt":
        "Check the status of my recent ServiceNow incidents and summarize any that need attention.",
      "category": "productivity",
    }, {
      "id": "create_incident_report",
      "title": "Create incident",
      "prompt":
        "Help me create a new incident in ServiceNow with the appropriate priority and category.",
      "category": "productivity",
    }, {
      "id": "search_kb",
      "title": "Search knowledge base",
      "prompt": "Search the ServiceNow knowledge base for solutions to common issues.",
      "category": "research",
    }],
    "suggestedWith": ["slack", "jira"],
    "category": "enterprise",
  },
  {
    "name": "sharepoint",
    "displayName": "SharePoint",
    "icon": "sharepoint.svg",
    "description": "Access and manage SharePoint sites, document libraries, and files",
    "auth": {
      "type": "oauth2",
      "provider": "microsoft",
      "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "scopes": [
        "Sites.Read.All",
        "Sites.ReadWrite.All",
        "Files.Read.All",
        "Files.ReadWrite.All",
        "offline_access",
      ],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "Microsoft Graph API",
        "enableUrl":
          "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      }],
    },
    "envVars": [{
      "name": "MICROSOFT_CLIENT_ID",
      "description": "Microsoft Azure App Client ID (shared with Outlook/Teams)",
      "required": true,
      "sensitive": false,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }, {
      "name": "MICROSOFT_CLIENT_SECRET",
      "description": "Microsoft Azure App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }],
    "tools": [{
      "id": "list_sites",
      "name": "List SharePoint Sites",
      "description": "List all SharePoint sites the user has access to",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/sites",
        "params": {
          "search": {
            "type": "string",
            "in": "query",
            "description": "Search term for SharePoint sites",
            "default": "*",
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of sites to return",
            "default": 200,
          },
        },
        "response": { "transform": "value" },
      },
    }, {
      "id": "get_site",
      "name": "Get Site Details",
      "description": "Get detailed information about a specific SharePoint site",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/sites/{siteId}",
        "params": {
          "siteId": {
            "type": "string",
            "in": "path",
            "description": "SharePoint site ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_files",
      "name": "List Files",
      "description": "List files and folders in a SharePoint document library",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/sites/{siteId}/drive/root/children",
        "params": {
          "siteId": {
            "type": "string",
            "in": "path",
            "description": "SharePoint site ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of items to return",
            "default": 200,
          },
        },
      },
    }, {
      "id": "get_file",
      "name": "Get File",
      "description": "Get file metadata and content from SharePoint",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/sites/{siteId}/drive/items/{itemId}",
        "params": {
          "siteId": {
            "type": "string",
            "in": "path",
            "description": "SharePoint site ID",
            "required": true,
          },
          "itemId": {
            "type": "string",
            "in": "path",
            "description": "Drive item ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "upload_file",
      "name": "Upload File",
      "description": "Upload a file to a SharePoint document library",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url":
          "https://graph.microsoft.com/v1.0/sites/{siteId}/drive/items/{parentFolderId}:/{fileName}:/content",
        "params": {
          "siteId": {
            "type": "string",
            "in": "path",
            "description": "SharePoint site ID",
            "required": true,
          },
          "parentFolderId": {
            "type": "string",
            "in": "path",
            "description": "Parent folder item ID, or root",
            "default": "root",
          },
          "fileName": {
            "type": "string",
            "in": "path",
            "description": "Name of the file to upload",
            "required": true,
          },
        },
        "body": {
          "content": {
            "type": "string",
            "description": "File content to upload",
            "required": true,
          },
        },
        "contentType": "application/octet-stream",
      },
    }],
    "prompts": [{
      "id": "search_documents",
      "title": "Search documents",
      "prompt": "Search for documents in SharePoint sites and summarize their content.",
      "category": "productivity",
      "icon": "search",
    }, {
      "id": "list_recent_files",
      "title": "List recent files",
      "prompt":
        "Show me the most recently modified files across all SharePoint sites I have access to.",
      "category": "productivity",
      "icon": "document",
    }, {
      "id": "organize_documents",
      "title": "Organize documents",
      "prompt": "Help me organize and categorize documents in a SharePoint library.",
      "category": "productivity",
      "icon": "folder",
    }],
    "suggestedWith": ["outlook", "teams", "onedrive"],
  },
  {
    "name": "sheets",
    "displayName": "Google Sheets",
    "icon": "sheets.svg",
    "description": "Read, write, and manage Google Sheets spreadsheets",
    "auth": {
      "type": "oauth2",
      "provider": "google",
      "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
      "tokenUrl": "https://oauth2.googleapis.com/token",
      "scopes": [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
      ],
      "requiredApis": [{
        "name": "Google Sheets API",
        "enableUrl": "https://console.cloud.google.com/apis/library/sheets.googleapis.com",
      }, {
        "name": "Google Drive API",
        "enableUrl": "https://console.cloud.google.com/apis/library/drive.googleapis.com",
      }],
    },
    "envVars": [{
      "name": "GOOGLE_CLIENT_ID",
      "description": "Google OAuth Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }, {
      "name": "GOOGLE_CLIENT_SECRET",
      "description": "Google OAuth Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.cloud.google.com/apis/credentials",
    }],
    "tools": [{
      "id": "list_spreadsheets",
      "name": "List Spreadsheets",
      "description": "List recent Google Sheets spreadsheets from Drive",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://www.googleapis.com/drive/v3/files",
        "params": {
          "q": {
            "type": "string",
            "in": "query",
            "description": "Drive query limited to Google Sheets spreadsheets",
            "default": "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
          },
          "pageSize": {
            "type": "number",
            "in": "query",
            "description": "Maximum number of spreadsheets to return",
            "default": 100,
          },
          "pageToken": { "type": "string", "in": "query", "description": "Pagination token" },
          "fields": {
            "type": "string",
            "in": "query",
            "description": "Partial response field selector",
            "default": "nextPageToken, files(id, name, webViewLink, modifiedTime)",
          },
        },
        "response": { "transform": "files" },
      },
    }, {
      "id": "get_spreadsheet",
      "name": "Get Spreadsheet",
      "description": "Get spreadsheet metadata including sheet names and properties",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
          "includeGridData": {
            "type": "boolean",
            "in": "query",
            "description": "Whether to include grid data",
            "default": false,
          },
          "ranges": {
            "type": "string[]",
            "in": "query",
            "description": "Ranges to include when includeGridData is true",
          },
        },
      },
    }, {
      "id": "read_range",
      "name": "Read Range",
      "description": "Read cell data from a spreadsheet range",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
          "range": {
            "type": "string",
            "in": "path",
            "description": "A1 notation range to read",
            "required": true,
          },
          "majorDimension": {
            "type": "string",
            "in": "query",
            "description": "Major dimension for returned values",
          },
          "valueRenderOption": {
            "type": "string",
            "in": "query",
            "description": "How values should be rendered",
          },
        },
      },
    }, {
      "id": "write_range",
      "name": "Write Range",
      "description": "Write data to a spreadsheet range",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
          "range": {
            "type": "string",
            "in": "path",
            "description": "A1 notation range to write",
            "required": true,
          },
          "valueInputOption": {
            "type": "string",
            "in": "query",
            "description": "How input values should be interpreted",
            "default": "USER_ENTERED",
          },
          "includeValuesInResponse": {
            "type": "boolean",
            "in": "query",
            "description": "Whether the response should include written values",
            "default": false,
          },
        },
        "body": {
          "values": {
            "type": "array",
            "description": "2D array of row values to write",
            "required": true,
          },
          "majorDimension": {
            "type": "string",
            "description": "Major dimension of provided values",
            "default": "ROWS",
          },
        },
      },
    }, {
      "id": "create_spreadsheet",
      "name": "Create Spreadsheet",
      "description": "Create a new spreadsheet with optional initial data",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets",
        "body": {
          "properties": {
            "type": "object",
            "description": "Spreadsheet properties such as title",
            "required": true,
          },
          "sheets": { "type": "array", "description": "Optional initial sheet definitions" },
        },
      },
    }, {
      "id": "append_rows",
      "name": "Append Rows",
      "description": "Append rows to a spreadsheet range",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url":
          "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}:append",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
          "range": {
            "type": "string",
            "in": "path",
            "description": "A1 notation range/table to append to",
            "required": true,
          },
          "valueInputOption": {
            "type": "string",
            "in": "query",
            "description": "How input values should be interpreted",
            "default": "USER_ENTERED",
          },
          "insertDataOption": {
            "type": "string",
            "in": "query",
            "description": "How inserted data should be handled",
            "default": "INSERT_ROWS",
          },
          "includeValuesInResponse": {
            "type": "boolean",
            "in": "query",
            "description": "Whether the response should include appended values",
            "default": false,
          },
        },
        "body": {
          "values": {
            "type": "array",
            "description": "2D array of row values to append",
            "required": true,
          },
          "majorDimension": {
            "type": "string",
            "description": "Major dimension of provided values",
            "default": "ROWS",
          },
        },
      },
    }, {
      "id": "clear_range",
      "name": "Clear Range",
      "description": "Clear values from a spreadsheet range",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}:clear",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
          "range": {
            "type": "string",
            "in": "path",
            "description": "A1 notation range to clear",
            "required": true,
          },
        },
        "body": {},
      },
    }, {
      "id": "batch_update",
      "name": "Batch Update",
      "description":
        "Run raw Google Sheets batchUpdate requests for formatting and structural changes",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "Google Sheets API batchUpdate request objects",
            "required": true,
          },
          "includeSpreadsheetInResponse": {
            "type": "boolean",
            "description": "Whether to include the updated spreadsheet in the response",
          },
        },
      },
    }, {
      "id": "add_sheet",
      "name": "Add Sheet",
      "description": "Add a new sheet/tab to a spreadsheet",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "A batchUpdate requests array containing an addSheet request",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_sheet",
      "name": "Delete Sheet",
      "description": "Delete a sheet/tab from a spreadsheet by sheet ID",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "A batchUpdate requests array containing a deleteSheet request",
            "required": true,
          },
        },
      },
    }, {
      "id": "rename_sheet",
      "name": "Rename Sheet",
      "description": "Rename a sheet/tab by sheet ID",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description":
              "A batchUpdate requests array containing an updateSheetProperties request",
            "required": true,
          },
        },
      },
    }, {
      "id": "delete_spreadsheet",
      "name": "Delete Spreadsheet",
      "description": "Move an app-accessible spreadsheet file to trash",
      "requiresWrite": true,
      "endpoint": {
        "method": "PATCH",
        "url": "https://www.googleapis.com/drive/v3/files/{spreadsheetId}",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID / Drive file ID",
            "required": true,
          },
        },
        "body": {
          "trashed": {
            "type": "boolean",
            "description": "Whether to move the spreadsheet file to trash",
            "default": true,
          },
        },
      },
    }, {
      "id": "find_replace",
      "name": "Find and Replace",
      "description": "Find and replace text in a spreadsheet or sheet",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "A batchUpdate requests array containing a findReplace request",
            "required": true,
          },
        },
      },
    }, {
      "id": "copy_sheet",
      "name": "Copy Sheet",
      "description": "Copy a sheet/tab to another spreadsheet",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url":
          "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/sheets/{sheetId}:copyTo",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Source spreadsheet ID",
            "required": true,
          },
          "sheetId": {
            "type": "number",
            "in": "path",
            "description": "Source sheet ID",
            "required": true,
          },
        },
        "body": {
          "destinationSpreadsheetId": {
            "type": "string",
            "description": "Destination spreadsheet ID",
            "required": true,
          },
        },
      },
    }, {
      "id": "create_chart",
      "name": "Create Chart",
      "description": "Create an embedded chart using a Sheets API chart specification",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "A batchUpdate requests array containing an addChart request",
            "required": true,
          },
        },
      },
    }, {
      "id": "set_data_validation",
      "name": "Set Data Validation",
      "description": "Set data validation rules on a sheet range",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}:batchUpdate",
        "params": {
          "spreadsheetId": {
            "type": "string",
            "in": "path",
            "description": "Google Sheets spreadsheet ID",
            "required": true,
          },
        },
        "body": {
          "requests": {
            "type": "array",
            "description": "A batchUpdate requests array containing a setDataValidation request",
            "required": true,
          },
        },
      },
    }],
    "prompts": [{
      "id": "analyze_data",
      "title": "Analyze spreadsheet data",
      "prompt":
        "Read and analyze data from a Google Sheets spreadsheet. Provide insights, trends, and statistics.",
      "category": "productivity",
      "icon": "chart",
    }, {
      "id": "create_report",
      "title": "Create a report spreadsheet",
      "prompt":
        "Create a new Google Sheets spreadsheet with formatted data, headers, and calculations.",
      "category": "productivity",
      "icon": "plus",
    }, {
      "id": "update_tracker",
      "title": "Update a tracker",
      "prompt":
        "Update a tracking spreadsheet with new data. Add rows, update values, or calculate totals.",
      "category": "productivity",
      "icon": "edit",
    }],
    "suggestedWith": ["gmail", "calendar", "notion"],
  },
  {
    "name": "shopify",
    "displayName": "Shopify",
    "icon": "shopify.svg",
    "description": "Manage products, orders, and customers in your Shopify store",
    "auth": {
      "type": "oauth2",
      "provider": "shopify",
      "authorizationUrl": "https://shop.myshopify.com/admin/oauth/authorize",
      "tokenUrl": "https://shop.myshopify.com/admin/oauth/access_token",
      "scopes": ["read_products", "write_products", "read_orders"],
      "requiredApis": [{
        "name": "Shopify Admin API",
        "enableUrl": "https://partners.shopify.com",
      }],
    },
    "envVars": [{
      "name": "SHOPIFY_CLIENT_ID",
      "description": "Shopify OAuth Client ID (API Key)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://shopify.dev/docs/apps/auth/oauth",
    }, {
      "name": "SHOPIFY_CLIENT_SECRET",
      "description": "Shopify OAuth Client Secret (API Secret Key)",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://shopify.dev/docs/apps/auth/oauth",
    }, {
      "name": "SHOPIFY_SHOP_DOMAIN",
      "description": "Your Shopify store domain (e.g., mystore.myshopify.com)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://shopify.dev/docs/apps/auth/oauth",
    }],
    "tools": [{
      "id": "list_products",
      "name": "List Products",
      "description": "List products in your Shopify store",
      "requiresWrite": false,
    }, {
      "id": "get_product",
      "name": "Get Product",
      "description": "Get details of a specific product",
      "requiresWrite": false,
    }, {
      "id": "list_orders",
      "name": "List Orders",
      "description": "List orders from your Shopify store",
      "requiresWrite": false,
    }, {
      "id": "get_order",
      "name": "Get Order",
      "description": "Get details of a specific order",
      "requiresWrite": false,
    }, {
      "id": "list_customers",
      "name": "List Customers",
      "description": "List customers in your Shopify store",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "list_products",
      "title": "Show my products",
      "prompt": "List all products in my Shopify store with their prices and inventory levels.",
      "category": "ecommerce",
      "icon": "shopping-bag",
    }, {
      "id": "recent_orders",
      "title": "Show recent orders",
      "prompt":
        "Show me the most recent orders from my Shopify store with customer details and order totals.",
      "category": "ecommerce",
      "icon": "receipt",
    }, {
      "id": "customer_list",
      "title": "Show my customers",
      "prompt":
        "List all customers in my Shopify store with their contact information and order history.",
      "category": "ecommerce",
      "icon": "users",
    }],
    "suggestedWith": ["stripe", "analytics"],
  },
  {
    "name": "slack",
    "displayName": "Slack",
    "icon": "slack.svg",
    "description": "Send messages, read channels, and manage Slack workspace",
    "auth": {
      "type": "oauth2",
      "provider": "slack",
      "authorizationUrl": "https://slack.com/oauth/v2/authorize",
      "tokenUrl": "https://slack.com/api/oauth.v2.access",
      "scopes": [
        "channels:history",
        "channels:read",
        "chat:write",
        "groups:history",
        "groups:read",
        "im:history",
        "im:read",
        "mpim:history",
        "mpim:read",
        "users:read",
      ],
    },
    "envVars": [{
      "name": "SLACK_CLIENT_ID",
      "description": "Slack App Client ID",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://api.slack.com/apps",
    }, {
      "name": "SLACK_CLIENT_SECRET",
      "description": "Slack App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://api.slack.com/apps",
    }],
    "tools": [{
      "id": "list_channels",
      "name": "List Channels",
      "description": "Get list of Slack channels",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://slack.com/api/conversations.list",
        "body": {
          "limit": { "type": "number", "description": "Max channels (1-1000)", "default": 100 },
          "exclude_archived": {
            "type": "boolean",
            "description": "Exclude archived channels",
            "default": true,
          },
          "types": {
            "type": "string",
            "description": "Channel types: public_channel, private_channel, mpim, im",
            "default": "public_channel",
          },
        },
        "response": {
          "transform": "channels",
          "historicalSummary": {
            "collectionKeys": ["channels", "data"],
            "collectionName": "channels",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "is_channel" },
              { "name": "is_group" },
              { "name": "is_im" },
              { "name": "is_private" },
              { "name": "is_archived" },
              { "name": "num_members" },
            ],
            "outputFields": [{ "name": "response_metadata", "kind": "object" }],
            "omitted": "channel topics, purposes, and provider-specific payload fields",
          },
        },
      },
    }, {
      "id": "send_message",
      "name": "Send Message",
      "description": "Send a message to a Slack channel",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://slack.com/api/chat.postMessage",
        "body": {
          "channel": { "type": "string", "description": "Channel ID to send to", "required": true },
          "text": {
            "type": "string",
            "description": "Message text (supports mrkdwn)",
            "required": true,
          },
          "thread_ts": { "type": "string", "description": "Thread timestamp to reply to" },
          "unfurl_links": { "type": "boolean", "description": "Unfurl URLs" },
        },
      },
    }, {
      "id": "get_messages",
      "name": "Get Messages",
      "description": "Get recent messages from a channel",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://slack.com/api/conversations.history",
        "body": {
          "channel": { "type": "string", "description": "Channel ID", "required": true },
          "limit": { "type": "number", "description": "Max messages (1-1000)", "default": 20 },
          "oldest": { "type": "string", "description": "Only messages after this timestamp" },
        },
        "response": { "transform": "messages" },
      },
    }, {
      "id": "get_thread",
      "name": "Get Thread",
      "description": "Get all replies in a Slack message thread",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://slack.com/api/conversations.replies",
        "body": {
          "channel": {
            "type": "string",
            "description": "Channel ID containing the thread",
            "required": true,
          },
          "ts": {
            "type": "string",
            "description": "Timestamp (ts) of the parent message",
            "required": true,
          },
          "limit": { "type": "number", "description": "Max replies (1-1000)", "default": 20 },
        },
        "response": { "transform": "messages" },
      },
    }, {
      "id": "list_users",
      "name": "List Users",
      "description": "List members of the Slack workspace",
      "requiresWrite": false,
      "endpoint": {
        "method": "POST",
        "url": "https://slack.com/api/users.list",
        "body": {
          "limit": { "type": "number", "description": "Max users (1-1000)", "default": 100 },
        },
        "response": {
          "transform": "members",
          "historicalSummary": {
            "collectionKeys": ["members", "users", "data"],
            "collectionName": "users",
            "itemFields": [
              { "name": "id" },
              { "name": "name" },
              { "name": "real_name" },
              { "name": "team_id" },
              { "name": "is_bot" },
              { "name": "deleted" },
            ],
            "outputFields": [{ "name": "response_metadata", "kind": "object" }],
            "omitted": "user profiles, avatars, and provider-specific payload fields",
          },
        },
      },
    }],
    "prompts": [{
      "id": "catch_up_slack",
      "title": "Catch up on Slack",
      "prompt":
        "Summarize the important messages from my Slack channels from today. Highlight any mentions or urgent items.",
      "category": "productivity",
      "icon": "slack",
    }, {
      "id": "post_update",
      "title": "Post team update",
      "prompt": "Help me write and post a team update to Slack about my current work progress.",
      "category": "productivity",
      "icon": "message",
    }],
    "suggestedWith": ["gmail", "calendar", "jira"],
  },
  {
    "name": "snowflake",
    "displayName": "Snowflake",
    "icon": "snowflake.svg",
    "description":
      "Query and manage your Snowflake data warehouse with SQL operations across databases, schemas, and tables",
    "auth": {
      "type": "api-key",
      "requiredApis": [{ "name": "Snowflake Account", "enableUrl": "https://app.snowflake.com/" }],
    },
    "envVars": [{
      "name": "SNOWFLAKE_ACCOUNT",
      "description": "Your Snowflake account identifier (e.g., xy12345.us-east-1)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/admin-account-identifier",
    }, {
      "name": "SNOWFLAKE_USERNAME",
      "description": "Snowflake username for authentication",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/admin-user-management",
    }, {
      "name": "SNOWFLAKE_PASSWORD",
      "description": "Snowflake password for authentication",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/admin-user-management",
    }, {
      "name": "SNOWFLAKE_WAREHOUSE",
      "description": "Default warehouse to use for queries (e.g., COMPUTE_WH)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/warehouses",
    }, {
      "name": "SNOWFLAKE_DATABASE",
      "description": "Default database to use for queries",
      "required": false,
      "sensitive": false,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/databases",
    }, {
      "name": "SNOWFLAKE_SCHEMA",
      "description": "Default schema to use for queries (defaults to PUBLIC)",
      "required": false,
      "sensitive": false,
      "docsUrl": "https://docs.snowflake.com/en/user-guide/schemas",
    }],
    "tools": [{
      "id": "run_query",
      "name": "Run Query",
      "description": "Execute a SQL query against your Snowflake data warehouse",
      "requiresWrite": false,
    }, {
      "id": "list_databases",
      "name": "List Databases",
      "description": "List all databases in your Snowflake account",
      "requiresWrite": false,
    }, {
      "id": "list_schemas",
      "name": "List Schemas",
      "description": "List all schemas in a Snowflake database",
      "requiresWrite": false,
    }, {
      "id": "list_tables",
      "name": "List Tables",
      "description": "List all tables in a Snowflake database schema",
      "requiresWrite": false,
    }, {
      "id": "describe_table",
      "name": "Describe Table",
      "description": "Get detailed column information for a specific table",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "query_data",
      "title": "Query my data warehouse",
      "prompt":
        "Help me query data from my Snowflake data warehouse. Show me specific records or analyze patterns.",
      "category": "data",
      "icon": "search",
    }, {
      "id": "analyze_tables",
      "title": "Analyze table structure",
      "prompt":
        "Show me the structure of tables in my Snowflake database and help me understand the schema.",
      "category": "data",
      "icon": "database",
    }, {
      "id": "data_insights",
      "title": "Generate insights",
      "prompt":
        "Analyze my Snowflake data and generate insights about trends, patterns, and anomalies.",
      "category": "analytics",
      "icon": "chart",
    }, {
      "id": "optimize_queries",
      "title": "Optimize queries",
      "prompt": "Help me optimize my SQL queries for better performance in Snowflake.",
      "category": "analytics",
      "icon": "lightning",
    }],
    "suggestedWith": ["github", "slack", "notion"],
  },
  {
    "name": "stripe",
    "displayName": "Stripe",
    "icon": "stripe.svg",
    "description": "Access Stripe payment data, customers, subscriptions, and balance information",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Stripe API",
        "enableUrl": "https://dashboard.stripe.com/apikeys",
      }],
      "keyName": "STRIPE_SECRET_KEY",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "STRIPE_SECRET_KEY",
      "description": "Stripe Secret Key (starts with sk_)",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://dashboard.stripe.com/apikeys",
    }, {
      "name": "STRIPE_WEBHOOK_SECRET",
      "description": "Stripe Webhook Secret (optional, for webhook verification)",
      "required": false,
      "sensitive": true,
      "docsUrl": "https://dashboard.stripe.com/webhooks",
    }],
    "tools": [{
      "id": "list_customers",
      "name": "List Customers",
      "description": "List Stripe customers with optional filtering",
      "requiresWrite": false,
    }, {
      "id": "get_customer",
      "name": "Get Customer",
      "description": "Retrieve detailed information about a specific customer",
      "requiresWrite": false,
    }, {
      "id": "list_payments",
      "name": "List Payments",
      "description": "List payment intents with optional status filtering",
      "requiresWrite": false,
    }, {
      "id": "get_balance",
      "name": "Get Balance",
      "description": "Retrieve the current account balance",
      "requiresWrite": false,
    }, {
      "id": "list_subscriptions",
      "name": "List Subscriptions",
      "description": "List subscriptions with optional status filtering",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "check_balance",
      "title": "Check account balance",
      "prompt":
        "Check my Stripe account balance and provide a summary of available and pending funds.",
      "category": "finance",
      "icon": "currency",
    }, {
      "id": "recent_payments",
      "title": "Recent payments",
      "prompt": "Show me the most recent successful payments in my Stripe account.",
      "category": "finance",
      "icon": "payment",
    }, {
      "id": "customer_overview",
      "title": "Customer overview",
      "prompt":
        "Give me an overview of my Stripe customers including total count and recent additions.",
      "category": "analytics",
      "icon": "users",
    }, {
      "id": "subscription_status",
      "title": "Subscription status",
      "prompt": "Show me the status of all active subscriptions and any that are expiring soon.",
      "category": "analytics",
      "icon": "repeat",
    }],
    "suggestedWith": ["slack", "email", "analytics"],
  },
  {
    "name": "supabase",
    "displayName": "Supabase",
    "icon": "supabase.svg",
    "description": "Query and manage your Supabase database with full CRUD operations",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Supabase Project",
        "enableUrl": "https://supabase.com/dashboard/projects",
      }],
    },
    "envVars": [{
      "name": "SUPABASE_URL",
      "description": "Your Supabase project URL (e.g., https://xxxxx.supabase.co)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://supabase.com/docs/guides/api#api-url-and-keys",
    }, {
      "name": "SUPABASE_ANON_KEY",
      "description": "Supabase anonymous/public API key for client-side operations",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://supabase.com/docs/guides/api#api-url-and-keys",
    }, {
      "name": "SUPABASE_SERVICE_KEY",
      "description": "Supabase service role key for server-side operations (bypasses RLS)",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://supabase.com/docs/guides/api#api-url-and-keys",
    }],
    "tools": [{
      "id": "list_tables",
      "name": "List Tables",
      "description": "List all tables in your Supabase database",
      "requiresWrite": false,
    }, {
      "id": "query_table",
      "name": "Query Table",
      "description": "Select rows from a table with optional filters and sorting",
      "requiresWrite": false,
    }, {
      "id": "insert_row",
      "name": "Insert Row",
      "description": "Insert a new row into a table",
      "requiresWrite": true,
    }, {
      "id": "update_row",
      "name": "Update Row",
      "description": "Update an existing row in a table",
      "requiresWrite": true,
    }, {
      "id": "delete_row",
      "name": "Delete Row",
      "description": "Delete a row from a table",
      "requiresWrite": true,
    }],
    "prompts": [{
      "id": "query_data",
      "title": "Query my database",
      "prompt":
        "Help me query data from my Supabase database. Show me specific records or analyze patterns.",
      "category": "data",
      "icon": "search",
    }, {
      "id": "create_record",
      "title": "Create a record",
      "prompt": "Create a new record in my Supabase database with the information I provide.",
      "category": "data",
      "icon": "plus",
    }, {
      "id": "update_records",
      "title": "Update records",
      "prompt": "Find and update records in my Supabase database based on specific criteria.",
      "category": "data",
      "icon": "edit",
    }, {
      "id": "database_stats",
      "title": "Database statistics",
      "prompt": "Show me statistics and insights about my Supabase database tables and data.",
      "category": "analytics",
      "icon": "chart",
    }],
    "suggestedWith": ["github", "slack", "linear"],
  },
  {
    "name": "teams",
    "displayName": "Microsoft Teams",
    "icon": "teams.svg",
    "description": "Send messages and manage Teams chats and channels",
    "auth": {
      "type": "oauth2",
      "provider": "microsoft",
      "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      "scopes": [
        "Chat.Read",
        "Chat.ReadWrite",
        "ChannelMessage.Send",
        "Channel.ReadBasic.All",
        "Team.ReadBasic.All",
        "offline_access",
      ],
      "tokenAuthMethod": "body",
      "requiredApis": [{
        "name": "Microsoft Graph API",
        "enableUrl":
          "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
      }],
    },
    "envVars": [{
      "name": "MICROSOFT_CLIENT_ID",
      "description": "Microsoft Azure App Client ID (Application ID)",
      "required": true,
      "sensitive": false,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }, {
      "name": "MICROSOFT_CLIENT_SECRET",
      "description": "Microsoft Azure App Client Secret",
      "required": true,
      "sensitive": true,
      "docsUrl":
        "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
    }],
    "tools": [{
      "id": "list_chats",
      "name": "List Chats",
      "description": "List recent Teams chats",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/chats",
        "params": {
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum chats to return",
            "default": 50,
          },
        },
        "response": { "transform": "value" },
      },
    }, {
      "id": "get_messages",
      "name": "Get Messages",
      "description": "Get messages from a specific chat",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/chats/{chatId}/messages",
        "params": {
          "chatId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft Teams chat ID",
            "required": true,
          },
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum messages to return",
            "default": 50,
          },
        },
        "response": { "transform": "value" },
      },
    }, {
      "id": "send_message",
      "name": "Send Channel Message",
      "description": "Send a message to a Teams channel",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/teams/{teamId}/channels/{channelId}/messages",
        "params": {
          "teamId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft Teams team ID",
            "required": true,
          },
          "channelId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft Teams channel ID",
            "required": true,
          },
        },
        "body": {
          "body": {
            "type": "object",
            "description":
              "Message body object with contentType ('text' or 'html') and content fields",
            "required": true,
          },
        },
      },
    }, {
      "id": "send_chat_message",
      "name": "Send Chat Message",
      "description": "Send a message to a Teams 1:1 or group chat",
      "requiresWrite": true,
      "endpoint": {
        "method": "POST",
        "url": "https://graph.microsoft.com/v1.0/chats/{chatId}/messages",
        "params": {
          "chatId": {
            "type": "string",
            "in": "path",
            "description": "Teams chat ID (from list_chats)",
            "required": true,
          },
        },
        "body": {
          "body": {
            "type": "object",
            "description":
              "Message body object with contentType ('text' or 'html') and content fields",
            "required": true,
          },
        },
      },
    }, {
      "id": "list_teams",
      "name": "List Teams",
      "description": "List all joined Teams",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/me/joinedTeams",
        "params": {
          "$top": {
            "type": "number",
            "in": "query",
            "description": "Maximum teams to return",
            "default": 50,
          },
        },
        "response": { "transform": "value" },
      },
    }, {
      "id": "list_channels",
      "name": "List Channels",
      "description": "List channels in a specific Team",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://graph.microsoft.com/v1.0/teams/{teamId}/channels",
        "params": {
          "teamId": {
            "type": "string",
            "in": "path",
            "description": "Microsoft Teams team ID",
            "required": true,
          },
        },
        "response": { "transform": "value" },
      },
    }],
    "prompts": [{
      "id": "check_messages",
      "title": "Check my messages",
      "prompt":
        "Check my recent Teams messages and summarize any important conversations or action items.",
      "category": "communication",
      "icon": "message",
    }, {
      "id": "send_update",
      "title": "Send team update",
      "prompt": "Send a status update message to a specific Teams channel about project progress.",
      "category": "communication",
      "icon": "send",
    }, {
      "id": "find_conversation",
      "title": "Find a conversation",
      "prompt": "Search through my Teams chats to find discussions about a specific topic.",
      "category": "communication",
      "icon": "search",
    }],
    "suggestedWith": ["outlook", "slack", "calendar"],
  },
  {
    "name": "trello",
    "displayName": "Trello",
    "icon": "trello.svg",
    "description": "Manage boards, lists, and cards in Trello",
    "auth": {
      "type": "oauth2",
      "provider": "trello",
      "authorizationUrl": "https://trello.com/1/authorize",
      "tokenUrl": "https://trello.com/1/OAuthGetAccessToken",
      "scopes": ["read", "write"],
      "requiredApis": [{
        "name": "Trello Developer Portal",
        "enableUrl": "https://trello.com/app-key",
      }],
    },
    "envVars": [{
      "name": "TRELLO_CLIENT_ID",
      "description": "Trello API Key",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/",
    }, {
      "name": "TRELLO_CLIENT_SECRET",
      "description": "Trello OAuth Secret",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://developer.atlassian.com/cloud/trello/guides/rest-api/authorization/",
    }],
    "tools": [{
      "id": "list_boards",
      "name": "List Boards",
      "description": "List all boards accessible to the user",
      "requiresWrite": false,
    }, {
      "id": "list_cards",
      "name": "List Cards",
      "description": "List cards in a board or list",
      "requiresWrite": false,
    }, {
      "id": "get_card",
      "name": "Get Card",
      "description": "Get details of a specific card",
      "requiresWrite": false,
    }, {
      "id": "create_card",
      "name": "Create Card",
      "description": "Create a new card in a list",
      "requiresWrite": true,
    }, {
      "id": "update_card",
      "name": "Update Card",
      "description": "Update an existing card",
      "requiresWrite": true,
    }],
    "prompts": [{
      "id": "my_boards",
      "title": "Show my boards",
      "prompt": "List all my Trello boards with their lists and card counts.",
      "category": "productivity",
      "icon": "grid",
    }, {
      "id": "create_card",
      "title": "Create a card",
      "prompt": "Create a new card with a title, description, and due date.",
      "category": "productivity",
      "icon": "plus",
    }],
    "suggestedWith": ["slack", "asana", "notion"],
  },
  {
    "name": "twilio",
    "displayName": "Twilio",
    "icon": "twilio.svg",
    "description": "Send SMS, WhatsApp messages, make calls, and manage communications with Twilio",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Twilio API",
        "enableUrl": "https://console.twilio.com/us1/develop/sms/overview",
      }],
      "keyName": "TWILIO_AUTH_TOKEN",
      "headerName": "Authorization",
      "headerPrefix": "Basic",
    },
    "envVars": [{
      "name": "TWILIO_ACCOUNT_SID",
      "description": "Twilio Account SID (starts with AC)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.twilio.com/",
    }, {
      "name": "TWILIO_AUTH_TOKEN",
      "description": "Twilio Auth Token",
      "required": true,
      "sensitive": true,
      "docsUrl": "https://console.twilio.com/",
    }, {
      "name": "TWILIO_PHONE_NUMBER",
      "description": "Your Twilio phone number (E.164 format: +1234567890)",
      "required": true,
      "sensitive": false,
      "docsUrl": "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
    }],
    "tools": [{
      "id": "send_sms",
      "name": "Send SMS",
      "description": "Send an SMS text message to a phone number",
      "requiresWrite": true,
    }, {
      "id": "send_whatsapp",
      "name": "Send WhatsApp Message",
      "description": "Send a WhatsApp message to a phone number",
      "requiresWrite": true,
    }, {
      "id": "list_messages",
      "name": "List Messages",
      "description": "List recent SMS and WhatsApp messages",
      "requiresWrite": false,
    }, {
      "id": "get_message",
      "name": "Get Message",
      "description": "Get details about a specific message",
      "requiresWrite": false,
    }, {
      "id": "list_calls",
      "name": "List Calls",
      "description": "List recent phone calls",
      "requiresWrite": false,
    }],
    "prompts": [{
      "id": "send_notification",
      "title": "Send SMS notification",
      "prompt": "Help me send an SMS notification to a customer about their order status.",
      "category": "communication",
      "icon": "message",
    }, {
      "id": "check_messages",
      "title": "Check recent messages",
      "prompt": "Show me the most recent SMS and WhatsApp messages from the last 24 hours.",
      "category": "communication",
      "icon": "inbox",
    }, {
      "id": "call_summary",
      "title": "Call summary",
      "prompt": "Give me a summary of recent calls including duration and status.",
      "category": "analytics",
      "icon": "phone",
    }, {
      "id": "whatsapp_outreach",
      "title": "WhatsApp outreach",
      "prompt": "Help me draft and send a WhatsApp message for customer outreach.",
      "category": "communication",
      "icon": "message",
    }],
    "suggestedWith": ["slack", "gmail", "calendar"],
  },
  {
    "name": "zendesk",
    "displayName": "Zendesk",
    "description": "Manage support tickets, claims, and customer operations in Zendesk",
    "auth": {
      "type": "api-key",
      "requiredApis": [{
        "name": "Zendesk Ticketing API",
        "enableUrl": "https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/",
      }],
      "keyName": "ZENDESK_ACCESS_TOKEN",
      "headerName": "Authorization",
      "headerPrefix": "Bearer",
    },
    "envVars": [{
      "name": "ZENDESK_SUBDOMAIN",
      "description": "Zendesk subdomain, for example example for example.zendesk.com",
      "required": true,
    }, {
      "name": "ZENDESK_ACCESS_TOKEN",
      "description": "Zendesk OAuth access token",
      "required": true,
      "sensitive": true,
    }],
    "tools": [{
      "id": "list_tickets",
      "name": "List Tickets",
      "description": "List Zendesk support tickets",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{subdomain}.zendesk.com/api/v2/tickets",
        "params": {
          "subdomain": {
            "type": "string",
            "in": "path",
            "description": "Zendesk subdomain, for example example for example.zendesk.com",
            "required": true,
          },
          "page[size]": {
            "type": "number",
            "in": "query",
            "description": "Maximum tickets to return",
            "default": 25,
          },
          "sort": {
            "type": "string",
            "in": "query",
            "description": "Cursor pagination sort expression",
            "default": "-updated_at",
          },
        },
        "response": { "transform": "tickets" },
      },
    }, {
      "id": "get_ticket",
      "name": "Get Ticket",
      "description": "Get a Zendesk ticket by ID",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{subdomain}.zendesk.com/api/v2/tickets/{ticketId}",
        "params": {
          "subdomain": {
            "type": "string",
            "in": "path",
            "description": "Zendesk subdomain, for example example for example.zendesk.com",
            "required": true,
          },
          "ticketId": {
            "type": "number",
            "in": "path",
            "description": "Zendesk ticket ID",
            "required": true,
          },
        },
        "response": { "transform": "ticket" },
      },
    }, {
      "id": "search_tickets",
      "name": "Search Tickets",
      "description": "Search Zendesk tickets with the Zendesk search API",
      "requiresWrite": false,
      "endpoint": {
        "method": "GET",
        "url": "https://{subdomain}.zendesk.com/api/v2/search",
        "params": {
          "subdomain": {
            "type": "string",
            "in": "path",
            "description": "Zendesk subdomain, for example example for example.zendesk.com",
            "required": true,
          },
          "query": {
            "type": "string",
            "in": "query",
            "description": "Zendesk search query, for example type:ticket status:open",
            "required": true,
          },
        },
        "response": { "transform": "results" },
      },
    }, {
      "id": "update_ticket",
      "name": "Update Ticket",
      "description": "Update a Zendesk ticket status, priority, tags, or comment",
      "requiresWrite": true,
      "endpoint": {
        "method": "PUT",
        "url": "https://{subdomain}.zendesk.com/api/v2/tickets/{ticketId}",
        "params": {
          "subdomain": {
            "type": "string",
            "in": "path",
            "description": "Zendesk subdomain, for example example for example.zendesk.com",
            "required": true,
          },
          "ticketId": {
            "type": "number",
            "in": "path",
            "description": "Zendesk ticket ID",
            "required": true,
          },
        },
        "body": {
          "ticket": {
            "type": "object",
            "description": "Zendesk ticket update payload",
            "required": true,
          },
        },
        "response": { "transform": "ticket" },
      },
    }],
    "prompts": [{
      "id": "claims_queue",
      "title": "Review claims tickets",
      "prompt":
        "Review open Zendesk claims tickets, identify missing customer information, and recommend next actions.",
      "category": "support",
    }, {
      "id": "support_resolution",
      "title": "Resolve support tickets",
      "prompt": "Summarize high-priority Zendesk support tickets and draft resolution updates.",
      "category": "support",
    }],
    "suggestedWith": ["salesforce", "slack", "teams"],
    "category": "support",
  },
];

export const icons: Record<string, string> = {
  "airtable":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_309)">\n<path d="M57.1183 11.8136L9.51971 31.5412C6.88172 32.6882 6.88172 36.3584 9.51971 37.5054L57.3477 56.5448C61.5914 58.1505 66.1792 58.1505 70.4229 56.5448L118.366 37.5054C121.004 36.3584 121.118 32.6882 118.366 31.5412L70.767 11.8136C66.4086 9.97849 61.4767 9.97849 57.1183 11.8136Z" fill="#FCB400"/>\n<path d="M68.2437 66.8674V114.351C68.2437 116.645 70.5376 118.251 72.6022 117.333L126.05 96.6882C127.312 96.2294 128 95.0824 128 93.7061V46.2222C128 43.9283 125.706 42.3226 123.642 43.2401L70.1936 63.8853C68.9319 64.3441 68.2437 65.491 68.2437 66.8674Z" fill="#18BFFF"/>\n<path d="M0 46.3369V90.9534C0 93.362 2.75269 94.853 4.8172 93.8208L38.1936 77.7634L39.7993 76.9606L1.03226 44.1577C0.458781 44.7312 0 45.4193 0 46.3369Z" fill="#F82B60"/>\n<path d="M55.5125 63.5412L4.7025 43.3548C3.67024 43.0108 2.63799 43.1254 1.83512 43.5842C1.60573 43.6989 1.26164 43.9283 0.917557 44.1577L39.7993 76.9606L55.6272 69.3907C58.2652 68.129 58.0358 64.4588 55.5125 63.5412Z" fill="#BA1E45"/>\n</g>\n<defs>\n<clipPath id="clip0_0_309">\n<rect width="128" height="107.125" fill="white" transform="translate(0 10.4373)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "anthropic":
    '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Anthropic</title><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>',
  "asana":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<mask id="mask0_60_20503" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="4" width="128" height="120">\n<path d="M91.8356 32.7671C91.8356 48.1096 79.3425 60.6027 64 60.6027C48.6575 60.6027 36.1644 48.1096 36.1644 32.7671C36.1644 17.4246 48.6575 4.93149 64 4.93149C79.5616 4.93149 91.8356 17.2055 91.8356 32.7671ZM27.8356 67.3972C12.4931 67.3972 0 79.8904 0 95.2328C0 110.575 12.4931 123.068 27.8356 123.068C43.1781 123.068 55.6712 110.575 55.6712 95.2328C55.6712 79.8904 43.3973 67.3972 27.8356 67.3972ZM100.164 67.3972C84.8219 67.3972 72.3288 79.8904 72.3288 95.2328C72.3288 110.575 84.8219 123.068 100.164 123.068C115.507 123.068 128 110.575 128 95.2328C128 79.8904 115.726 67.3972 100.164 67.3972Z" fill="white"/>\n</mask>\n<g mask="url(#mask0_60_20503)">\n<path d="M64.0003 3.61646C102.795 3.61646 134.137 34.9589 134.137 73.7534C134.137 112.548 102.795 143.89 64.0003 143.89C25.2057 143.89 -6.13672 112.548 -6.13672 73.7534C-5.91754 34.9589 25.4249 3.61646 64.0003 3.61646Z" fill="url(#paint0_radial_60_20503)"/>\n</g>\n<defs>\n<radialGradient id="paint0_radial_60_20503" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(64.0834 73.692) rotate(-90) scale(70.1091)">\n<stop stop-color="#FFB900"/>\n<stop offset="0.6" stop-color="#F95D8F"/>\n<stop offset="0.9991" stop-color="#F95353"/>\n</radialGradient>\n</defs>\n</svg>\n',
  "aws":
    '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Amazon AWS</title><path d="M6.763 10.036c0 .296.032.535.088.71.064.176.144.368.256.576.04.063.056.127.056.183 0 .08-.048.16-.152.24l-.503.335a.383.383 0 0 1-.208.072c-.08 0-.16-.04-.239-.112a2.47 2.47 0 0 1-.287-.375 6.18 6.18 0 0 1-.248-.471c-.622.734-1.405 1.101-2.347 1.101-.67 0-1.205-.191-1.596-.574-.391-.384-.59-.894-.59-1.533 0-.678.239-1.23.726-1.644.487-.415 1.133-.623 1.955-.623.272 0 .551.024.846.064.296.04.6.104.918.176v-.583c0-.607-.127-1.03-.375-1.277-.255-.248-.686-.367-1.3-.367-.28 0-.568.031-.863.103-.295.072-.583.16-.862.272a2.287 2.287 0 0 1-.28.104.488.488 0 0 1-.127.023c-.112 0-.168-.08-.168-.247v-.391c0-.128.016-.224.056-.28a.597.597 0 0 1 .224-.167c.279-.144.614-.264 1.005-.36a4.84 4.84 0 0 1 1.246-.151c.95 0 1.644.216 2.091.647.439.43.662 1.085.662 1.963v2.586zm-3.24 1.214c.263 0 .534-.048.822-.144.287-.096.543-.271.758-.51.128-.152.224-.32.272-.512.047-.191.08-.423.08-.694v-.335a6.66 6.66 0 0 0-.735-.136 6.02 6.02 0 0 0-.75-.048c-.535 0-.926.104-1.19.32-.263.215-.39.518-.39.917 0 .375.095.655.295.846.191.2.47.296.838.296zm6.41.862c-.144 0-.24-.024-.304-.08-.064-.048-.12-.16-.168-.311L7.586 5.55a1.398 1.398 0 0 1-.072-.32c0-.128.064-.2.191-.2h.783c.151 0 .255.025.31.08.065.048.113.16.16.312l1.342 5.284 1.245-5.284c.04-.16.088-.264.151-.312a.549.549 0 0 1 .32-.08h.638c.152 0 .256.025.32.08.063.048.12.16.151.312l1.261 5.348 1.381-5.348c.048-.16.104-.264.16-.312a.52.52 0 0 1 .311-.08h.743c.127 0 .2.065.2.2 0 .04-.009.08-.017.128a1.137 1.137 0 0 1-.056.2l-1.923 6.17c-.048.16-.104.263-.168.311a.51.51 0 0 1-.303.08h-.687c-.151 0-.255-.024-.32-.08-.063-.056-.119-.16-.15-.32l-1.238-5.148-1.23 5.14c-.04.16-.087.264-.15.32-.065.056-.177.08-.32.08zm10.256.215c-.415 0-.83-.048-1.229-.143-.399-.096-.71-.2-.918-.32-.128-.071-.215-.151-.247-.223a.563.563 0 0 1-.048-.224v-.407c0-.167.064-.247.183-.247.048 0 .096.008.144.024.048.016.12.048.2.08.271.12.566.215.878.279.319.064.63.096.95.096.502 0 .894-.088 1.165-.264a.86.86 0 0 0 .415-.758.777.777 0 0 0-.215-.559c-.144-.151-.416-.287-.807-.415l-1.157-.36c-.583-.183-1.014-.454-1.277-.813a1.902 1.902 0 0 1-.4-1.158c0-.335.073-.63.216-.886.144-.255.335-.479.575-.654.24-.184.51-.32.83-.415.32-.096.655-.136 1.006-.136.175 0 .359.008.535.032.183.024.35.056.518.088.16.04.312.08.455.127.144.048.256.096.336.144a.69.69 0 0 1 .24.2.43.43 0 0 1 .071.263v.375c0 .168-.064.256-.184.256a.83.83 0 0 1-.303-.096 3.652 3.652 0 0 0-1.532-.311c-.455 0-.815.071-1.062.223-.248.152-.375.383-.375.71 0 .224.08.416.24.567.159.152.454.304.877.44l1.134.358c.574.184.99.44 1.237.767.247.327.367.702.367 1.117 0 .343-.072.655-.207.926-.144.272-.336.511-.583.703-.248.2-.543.343-.886.447-.36.111-.734.167-1.142.167zM21.698 16.207c-2.626 1.94-6.442 2.969-9.722 2.969-4.598 0-8.74-1.7-11.87-4.526-.247-.223-.024-.527.272-.351 3.384 1.963 7.559 3.153 11.877 3.153 2.914 0 6.114-.607 9.06-1.852.439-.2.814.287.383.607zM22.792 14.961c-.336-.43-2.22-.207-3.074-.103-.255.032-.295-.192-.063-.36 1.5-1.053 3.967-.75 4.254-.399.287.36-.08 2.826-1.485 4.007-.215.184-.423.088-.327-.151.32-.79 1.03-2.57.695-2.994z"/></svg>',
  "bitbucket":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M4.15271 6.00034C3.55438 5.99262 2.96162 6.11597 2.41604 6.36173C1.87046 6.60748 1.38528 6.96967 0.994579 7.42289C0.603876 7.8761 0.317116 8.40935 0.154432 8.98519C-0.00825225 9.56102 -0.0429162 10.1655 0.0528736 10.7561L17.4567 116.409C17.6735 117.702 18.339 118.877 19.3362 119.728C20.3334 120.579 21.5985 121.051 22.9094 121.062H106.403C107.385 121.075 108.34 120.734 109.092 120.102C109.845 119.47 110.345 118.588 110.502 117.618L127.947 10.7971C128.043 10.2065 128.008 9.60202 127.846 9.02618C127.683 8.45035 127.396 7.9171 127.005 7.46389C126.615 7.01067 126.13 6.64848 125.584 6.40272C125.038 6.15697 124.446 6.03362 123.847 6.04134L4.15271 6.00034ZM77.4372 82.3597H50.7883L43.5726 44.6822H83.8944L77.4372 82.3597Z" fill="#2684FF"/>\n<path d="M122.371 44.6822H83.8944L77.4371 82.3597H50.7882L19.322 119.73C20.3194 120.592 21.5909 121.072 22.9094 121.083H106.423C107.406 121.095 108.36 120.754 109.113 120.122C109.865 119.49 110.366 118.609 110.523 117.639L122.371 44.6822Z" fill="url(#paint0_linear_0_425)"/>\n<defs>\n<linearGradient id="paint0_linear_0_425" x1="131.268" y1="55.2188" x2="67.6795" y2="104.868" gradientUnits="userSpaceOnUse">\n<stop offset="0.18" stop-color="#0052CC"/>\n<stop offset="1" stop-color="#2684FF"/>\n</linearGradient>\n</defs>\n</svg>\n',
  "calendar":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_64)">\n<g clip-path="url(#clip1_0_64)">\n<path d="M97.6844 30.3155L67.3689 26.9472L30.3161 30.3155L26.9471 64L30.3155 97.6845L63.9999 101.895L97.6844 97.6845L101.053 63.1584L97.6844 30.3155Z" fill="white"/>\n<path d="M44.135 82.5766C41.6173 80.8755 39.8739 78.3917 38.9222 75.1072L44.7667 72.6989C45.2973 74.72 46.2234 76.2861 47.5456 77.3978C48.8595 78.5094 50.4595 79.0566 52.329 79.0566C54.2406 79.0566 55.8829 78.4755 57.255 77.3133C58.6272 76.151 59.3184 74.6688 59.3184 72.8755C59.3184 71.04 58.5939 69.5405 57.1456 68.3789C55.6973 67.2173 53.8784 66.6355 51.7056 66.6355H48.329V60.8506H51.36C53.2294 60.8506 54.8045 60.3456 56.0845 59.335C57.3645 58.3245 58.0045 56.9434 58.0045 55.1834C58.0045 53.6173 57.4317 52.3706 56.2867 51.4362C55.1418 50.5018 53.6928 50.0301 51.9328 50.0301C50.215 50.0301 48.8506 50.4851 47.84 51.4029C46.8294 52.3206 46.0966 53.449 45.6339 54.7795L39.849 52.3712C40.615 50.1984 42.0218 48.2784 44.0845 46.6195C46.1478 44.9606 48.7834 44.1267 51.9834 44.1267C54.3494 44.1267 56.48 44.5818 58.3667 45.4995C60.2528 46.4173 61.735 47.689 62.8045 49.3056C63.8739 50.9306 64.4045 52.7501 64.4045 54.7706C64.4045 56.8339 63.9078 58.5766 62.9139 60.0083C61.92 61.44 60.6989 62.5344 59.2506 63.3011V63.6461C61.1622 64.4461 62.72 65.6672 63.9494 67.3094C65.1706 68.9517 65.785 70.9139 65.785 73.2045C65.785 75.495 65.2038 77.5411 64.0416 79.335C62.8794 81.129 61.271 82.5434 59.2333 83.5706C57.1872 84.5978 54.8883 85.12 52.3366 85.12C49.3811 85.1283 46.6528 84.2778 44.135 82.5766Z" fill="#1A73E8"/>\n<path d="M80 53.575L73.6166 58.215L70.4083 53.3478L81.92 45.0445H86.3328V84.2106H80V53.575Z" fill="#1A73E8"/>\n<path d="M97.6844 128L128 97.6845L112.842 90.9478L97.6844 97.6845L90.9478 112.842L97.6844 128Z" fill="#EA4335"/>\n<path d="M23.5789 112.842L30.3155 128H97.6838V97.6845H30.3155L23.5789 112.842Z" fill="#34A853"/>\n<path d="M10.105 0C4.52224 0 0 4.52224 0 10.105V97.6838L15.1578 104.42L30.3155 97.6838V30.3155H97.6838L104.42 15.1578L97.6845 0H10.105Z" fill="#4285F4"/>\n<path d="M0 97.6845V117.895C0 123.478 4.52224 128 10.105 128H30.3155V97.6845H0Z" fill="#188038"/>\n<path d="M97.6844 30.3155V97.6838H128V30.3155L112.842 23.5789L97.6844 30.3155Z" fill="#FBBC04"/>\n<path d="M128 30.3155V10.105C128 4.5216 123.478 0 117.895 0H97.6844V30.3155H128Z" fill="#1967D2"/>\n</g>\n</g>\n<defs>\n<clipPath id="clip0_0_64">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_0_64">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "confluence":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_240_6563)">\n<g clip-path="url(#clip1_240_6563)">\n<path d="M38.0146 59.1266C36.0729 56.9907 33.1606 57.1849 31.8012 59.7093L0.344616 122.622C-0.820405 125.147 0.927179 128.059 3.64561 128.059H47.3352C48.6948 128.059 50.0538 127.283 50.6365 125.923C60.1508 106.506 54.5199 76.7967 38.0146 59.1266Z" fill="url(#paint0_linear_240_6563)"/>\n<path d="M60.9302 2.03887C43.4544 29.8061 44.6197 60.6804 56.0757 83.7872C67.7264 106.894 76.4643 124.758 77.2412 125.924C77.8239 127.283 79.1829 128.059 80.542 128.059H124.232C126.95 128.059 128.892 125.147 127.533 122.622C127.533 122.622 68.6975 4.95152 67.1437 2.03887C65.9789 -0.679622 62.6777 -0.679622 60.9302 2.03887Z" fill="#2684FF"/>\n</g>\n</g>\n<defs>\n<linearGradient id="paint0_linear_240_6563" x1="55.1799" y1="68.8586" x2="22.028" y2="126.28" gradientUnits="userSpaceOnUse">\n<stop stop-color="#0052CC"/>\n<stop offset="0.9228" stop-color="#2684FF"/>\n</linearGradient>\n<clipPath id="clip0_240_6563">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_240_6563">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "docs-google":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_239)">\n<mask id="mask0_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask0_0_239)">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L90.3077 20.3636L75.8462 0Z" fill="#4285F4"/>\n</g>\n<mask id="mask1_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask1_0_239)">\n<path d="M78.3848 32.3564L110.554 64.7055V34.9091L78.3848 32.3564Z" fill="url(#paint0_linear_0_239)"/>\n</g>\n<mask id="mask2_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask2_0_239)">\n<path d="M41.1382 93.0909H87.4151V87.2727H41.1382V93.0909ZM41.1382 104.727H75.8459V98.9091H41.1382V104.727ZM41.1382 64V69.8182H87.4151V64H41.1382ZM41.1382 81.4545H87.4151V75.6364H41.1382V81.4545Z" fill="#F1F1F1"/>\n</g>\n<mask id="mask3_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask3_0_239)">\n<path d="M75.8462 0V26.1818C75.8462 31.0036 79.7291 34.9091 84.5231 34.9091H110.554L75.8462 0Z" fill="#A1C2FA"/>\n</g>\n<mask id="mask4_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask4_0_239)">\n<path d="M26.6769 0C21.9046 0 18 3.92727 18 8.72727V9.45455C18 4.65455 21.9046 0.727273 26.6769 0.727273H75.8462V0H26.6769Z" fill="white" fill-opacity="0.2"/>\n</g>\n<mask id="mask5_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask5_0_239)">\n<path d="M101.877 127.273H26.6769C21.9046 127.273 18 123.345 18 118.545V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V118.545C110.554 123.345 106.649 127.273 101.877 127.273Z" fill="#1A237E" fill-opacity="0.2"/>\n</g>\n<mask id="mask6_0_239" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="18" y="0" width="93" height="128">\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="white"/>\n</mask>\n<g mask="url(#mask6_0_239)">\n<path d="M84.5231 34.9091C79.7291 34.9091 75.8462 31.0036 75.8462 26.1818V26.9091C75.8462 31.7309 79.7291 35.6364 84.5231 35.6364H110.554V34.9091H84.5231Z" fill="#1A237E" fill-opacity="0.1"/>\n</g>\n<path d="M75.8462 0H26.6769C21.9046 0 18 3.92727 18 8.72727V119.273C18 124.073 21.9046 128 26.6769 128H101.877C106.649 128 110.554 124.073 110.554 119.273V34.9091L75.8462 0Z" fill="url(#paint1_radial_0_239)"/>\n</g>\n<defs>\n<linearGradient id="paint0_linear_0_239" x1="1687.04" y1="310.109" x2="1687.04" y2="3267.72" gradientUnits="userSpaceOnUse">\n<stop stop-color="#1A237E" stop-opacity="0.2"/>\n<stop offset="1" stop-color="#1A237E" stop-opacity="0.02"/>\n</linearGradient>\n<radialGradient id="paint1_radial_0_239" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(311.215 251.525) scale(14924.2 14924.2)">\n<stop stop-color="white" stop-opacity="0.1"/>\n<stop offset="1" stop-color="white" stop-opacity="0"/>\n</radialGradient>\n<clipPath id="clip0_0_239">\n<rect width="92.5538" height="128" fill="white" transform="translate(18)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "drive":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_185)">\n<g clip-path="url(#clip1_0_185)">\n<path d="M9.32688 104.834L14.9718 114.584C16.1447 116.637 17.8309 118.25 19.8103 119.423L39.9706 84.5269H-0.350098C-0.350098 86.7995 0.236386 89.0722 1.40935 91.1249L9.32688 104.834Z" fill="#0066DA"/>\n<path d="M63.6499 43.4731L43.4895 8.57732C41.5102 9.75029 39.824 11.3631 38.651 13.4158L1.40935 77.929C0.257958 79.9374 -0.348565 82.2119 -0.350098 84.5269H39.9706L63.6499 43.4731Z" fill="#00AC47"/>\n<path d="M107.489 119.423C109.469 118.25 111.155 116.637 112.328 114.584L114.674 110.552L125.89 91.1249C127.063 89.0722 127.65 86.7995 127.65 84.5269H87.3262L95.9064 101.388L107.489 119.423Z" fill="#EA4335"/>\n<path d="M63.6496 43.4731L83.81 8.57732C81.8306 7.40435 79.558 6.81787 77.2121 6.81787H50.0872C47.7413 6.81787 45.4686 7.47767 43.4893 8.57732L63.6496 43.4731Z" fill="#00832D"/>\n<path d="M87.3294 84.5269H39.9709L19.8105 119.423C21.7899 120.596 24.0626 121.182 26.4085 121.182H100.892C103.238 121.182 105.51 120.522 107.49 119.423L87.3294 84.5269Z" fill="#2684FC"/>\n<path d="M107.27 45.6724L88.6488 13.4158C87.4758 11.3631 85.7896 9.75029 83.8103 8.57732L63.6499 43.4731L87.3292 84.5269H127.577C127.577 82.2543 126.99 79.9817 125.817 77.929L107.27 45.6724Z" fill="#FFBA00"/>\n</g>\n</g>\n<defs>\n<clipPath id="clip0_0_185">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_0_185">\n<rect width="128" height="114.364" fill="white" transform="translate(-0.350098 6.81787)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "figma":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_460)">\n<path d="M64 64C64 52.3381 73.4539 42.8839 85.1161 42.8839C96.7781 42.8839 106.232 52.3381 106.232 64C106.232 75.6622 96.7781 85.1161 85.1161 85.1161C73.4539 85.1161 64 75.6622 64 64Z" fill="#1ABCFE"/>\n<path d="M21.7681 106.232C21.7681 94.5704 31.2221 85.1161 42.8842 85.1161H64.0004V106.232C64.0004 117.895 54.5464 127.348 42.8842 127.348C31.2221 127.348 21.7681 117.895 21.7681 106.232Z" fill="#0ACF83"/>\n<path d="M64 0.651688V42.8838H85.1161C96.7784 42.8838 106.232 33.4299 106.232 21.7678C106.232 10.1057 96.7784 0.651688 85.1161 0.651688H64Z" fill="#FF7262"/>\n<path d="M21.7681 21.7678C21.7681 33.4299 31.2221 42.8838 42.8842 42.8838H64.0004V0.651672H42.8842C31.2221 0.651672 21.7681 10.1057 21.7681 21.7678Z" fill="#F24E1E"/>\n<path d="M21.7681 64C21.7681 75.6622 31.2221 85.1161 42.8842 85.1161H64.0004V42.8839H42.8842C31.2221 42.8839 21.7681 52.3381 21.7681 64Z" fill="#A259FF"/>\n</g>\n<defs>\n<clipPath id="clip0_0_460">\n<rect width="85.3333" height="128" fill="white" transform="translate(21.3335)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "github":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_48)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M63.8093 1.30612C28.5244 1.30612 0 30.0408 0 65.5895C0 94.0055 18.2766 118.059 43.631 126.572C46.801 127.212 47.9621 125.189 47.9621 123.487C47.9621 121.997 47.8576 116.889 47.8576 111.566C30.1074 115.399 26.4111 103.903 26.4111 103.903C23.5585 96.4532 19.3319 94.5384 19.3319 94.5384C13.5223 90.6005 19.7551 90.6005 19.7551 90.6005C26.1995 91.0263 29.5811 97.199 29.5811 97.199C35.2849 106.99 44.4761 104.223 48.1737 102.52C48.7014 98.3693 50.3928 95.4958 52.1887 93.8997C38.0317 92.4095 23.1367 86.8754 23.1367 62.1832C23.1367 55.1589 25.6705 49.4119 29.6856 44.9424C29.0521 43.3463 26.833 36.7464 30.3203 27.9131C30.3203 27.9131 35.7081 26.21 47.8563 34.5117C53.0574 33.1045 58.4212 32.3887 63.8093 32.3827C69.1971 32.3827 74.6893 33.1285 79.761 34.5117C91.9105 26.21 97.2983 27.9131 97.2983 27.9131C100.786 36.7464 98.5652 43.3463 97.9318 44.9424C102.053 49.4119 104.482 55.1589 104.482 62.1832C104.482 86.8754 89.5869 92.3024 75.3241 93.8997C77.649 95.9216 79.6552 99.7525 79.6552 105.819C79.6552 114.44 79.5507 121.358 79.5507 123.486C79.5507 125.189 80.7132 127.212 83.8818 126.574C109.236 118.058 127.513 94.0055 127.513 65.5895C127.617 30.0408 98.9884 1.30612 63.8093 1.30612Z" fill="#24292F"/>\n</g>\n<defs>\n<clipPath id="clip0_0_48">\n<rect width="128" height="125.388" fill="white" transform="translate(0 1.30612)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "gitlab":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_240_6238)">\n<g clip-path="url(#clip1_240_6238)">\n<path d="M125.848 51.1162L125.668 50.6562L108.268 5.25622C107.915 4.3644 107.289 3.60698 106.48 3.09222C105.665 2.57734 104.711 2.32811 103.749 2.37899C102.786 2.42986 101.864 2.77832 101.108 3.37622C100.36 3.97622 99.82 4.80022 99.564 5.72422L87.804 41.7282H40.204L28.44 5.72822C28.1887 4.79778 27.6485 3.97111 26.8973 3.36729C26.1462 2.76346 25.2227 2.41365 24.26 2.36822C23.3004 2.3176 22.3491 2.56794 21.5387 3.08427C20.7283 3.6006 20.0995 4.35714 19.74 5.24822L2.31598 50.7202L2.13598 51.1722C-0.364414 57.7204 -0.671054 64.9035 1.26218 71.6409C3.19542 78.3784 7.264 84.306 12.856 88.5322L12.92 88.5802L13.072 88.7002L39.612 108.568L52.732 118.504L60.708 124.544C61.6452 125.252 62.7876 125.635 63.962 125.635C65.1364 125.635 66.2788 125.252 67.216 124.544L75.192 118.504L88.32 108.568L115.012 88.5802L115.084 88.5282C120.694 84.3053 124.778 78.3718 126.719 71.6235C128.66 64.8752 128.353 57.6786 125.844 51.1202L125.848 51.1162Z" fill="#E24329"/>\n<path d="M125.848 51.1158L125.668 50.6558C117.181 52.4047 109.183 56.002 102.244 61.1918L64.032 90.1518C72.1526 96.2905 80.2752 102.427 88.4 108.56L115.092 88.5718L115.168 88.5198C120.763 84.2854 124.831 78.3471 126.757 71.5998C128.683 64.8525 128.364 57.662 125.848 51.1118V51.1158Z" fill="#FC6D26"/>\n<path d="M39.632 108.56L52.732 118.5L60.708 124.54C61.6452 125.248 62.7876 125.63 63.962 125.63C65.1364 125.63 66.2788 125.248 67.216 124.54L75.192 118.5L88.32 108.564C88.32 108.564 76.98 100.004 63.952 90.1519L39.632 108.564V108.56Z" fill="#FCA326"/>\n<path d="M25.74 61.22C18.8038 56.0281 10.8068 52.4318 2.32001 50.688L2.14001 51.14C-0.367146 57.6918 -0.677348 64.8809 1.25614 71.6242C3.18962 78.3676 7.26208 84.3001 12.86 88.528L12.924 88.576L13.076 88.696L39.616 108.564L64.036 90.152L25.74 61.22Z" fill="#FC6D26"/>\n</g>\n</g>\n<defs>\n<clipPath id="clip0_240_6238">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_240_6238">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "gmail":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_12)">\n<path d="M8.7275 113.854H29.091V64.4L0 42.5817V105.127C0 109.949 3.9055 113.855 8.7275 113.855V113.854Z" fill="#4285F4"/>\n<path d="M98.909 113.854H119.273C124.095 113.854 128 109.949 128 105.127V42.5817L98.909 64.4V113.854Z" fill="#34A853"/>\n<path d="M98.909 26.5817V64.4L128 42.5817V30.9455C128 20.16 115.687 14 107.054 20.4727L98.909 26.5817Z" fill="#FBBC04"/>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M29.091 64.4V26.5817L64 52.7638L98.909 26.5817V64.4L64 90.5817L29.091 64.4Z" fill="#EA4335"/>\n<path d="M0 30.9455V42.5817L29.091 64.4V26.5817L20.9455 20.4727C12.3125 14 0 20.16 0 30.945V30.9455Z" fill="#C5221F"/>\n</g>\n<defs>\n<clipPath id="clip0_0_12">\n<rect width="128" height="99.855" fill="white" transform="translate(0 14)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "harvest":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="50" fill="#FA5B35"/>\n  <path d="M24 28h10v18h24V28h10v44H58V54H34v18H24V28z" fill="#fff"/>\n</svg>\n',
  "hubspot":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <rect width="128" height="128" rx="20" fill="#FF5C35"/>\n  <path d="M86 51.5V39.2C91.7 37.2 95.8 31.8 95.8 25.4C95.8 17.3 89.3 10.8 81.2 10.8C73.1 10.8 66.6 17.3 66.6 25.4C66.6 31.8 70.7 37.2 76.4 39.2V51.5C70.8 52.4 65.9 55.2 62.1 59.2L39.3 41.4C40.2 39.5 40.7 37.4 40.7 35.2C40.7 27.1 34.2 20.6 26.1 20.6C18 20.6 11.5 27.1 11.5 35.2C11.5 43.3 18 49.8 26.1 49.8C28.9 49.8 31.5 49 33.7 47.7L56.2 65.3C54.7 68.4 53.8 71.9 53.8 75.6C53.8 77.9 54.1 80.1 54.8 82.2L38.2 92.6C35.5 90.2 32 88.7 28.1 88.7C20 88.7 13.5 95.2 13.5 103.3C13.5 111.4 20 117.9 28.1 117.9C36.2 117.9 42.7 111.4 42.7 103.3C42.7 102 42.5 100.8 42.2 99.6L58.9 89.1C63.4 95.4 70.7 99.5 79 99.5C92.7 99.5 103.8 88.4 103.8 74.7C103.8 62.2 94.7 52 86 51.5ZM79 89.2C71 89.2 64.5 82.7 64.5 74.7C64.5 66.7 71 60.2 79 60.2C87 60.2 93.5 66.7 93.5 74.7C93.5 82.7 87 89.2 79 89.2Z" fill="white"/>\n</svg>\n',
  "jira":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_328)">\n<path d="M44.5144 60.3244C43.0588 58.7232 40.8756 58.8688 39.8565 60.7612L16.275 107.924C15.4016 109.816 16.7117 112 18.7496 112H51.5016C52.5208 112 53.5396 111.418 53.9764 110.399C61.1088 95.8424 56.8876 73.5708 44.5144 60.3244Z" fill="url(#paint0_linear_0_328)"/>\n<path d="M61.6932 17.5284C48.5924 38.3442 49.466 61.4892 58.054 78.8112C66.788 96.1336 73.3384 109.525 73.9208 110.399C74.3576 111.418 75.3764 112 76.3952 112H109.148C111.185 112 112.641 109.816 111.622 107.924C111.622 107.924 67.516 19.7119 66.3512 17.5284C65.478 15.4905 63.0032 15.4905 61.6932 17.5284Z" fill="#2684FF"/>\n</g>\n<defs>\n<linearGradient id="paint0_linear_0_328" x1="57.3824" y1="67.62" x2="32.53" y2="110.666" gradientUnits="userSpaceOnUse">\n<stop stop-color="#0052CC"/>\n<stop offset="0.9228" stop-color="#2684FF"/>\n</linearGradient>\n<clipPath id="clip0_0_328">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "linear":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_298)">\n<g clip-path="url(#clip1_0_298)">\n<path d="M1.56852 78.7492C1.28372 77.5351 2.7301 76.7704 3.61189 77.6522L50.3478 124.388C51.2296 125.27 50.4649 126.716 49.2508 126.431C25.6659 120.899 7.10117 102.334 1.56852 78.7492ZM0.00242092 60.018C-0.0201631 60.3806 0.116177 60.7347 0.373073 60.9916L67.0084 127.627C67.2653 127.884 67.6193 128.02 67.9819 127.998C71.0145 127.809 73.99 127.409 76.8938 126.812C77.8724 126.611 78.2123 125.409 77.5059 124.703L3.29722 50.4941C2.59084 49.7876 1.38852 50.1276 1.18755 51.1062C0.591182 54.01 0.191304 56.9854 0.00242092 60.018ZM5.38999 38.0229C5.17688 38.5014 5.28543 39.0605 5.65578 39.4309L88.5691 122.344C88.9395 122.715 89.4986 122.823 89.9771 122.61C92.2633 121.592 94.479 120.443 96.6145 119.174C97.3212 118.755 97.4303 117.784 96.849 117.202L10.7976 31.151C10.2164 30.5697 9.24538 30.6788 8.8255 31.3855C7.55661 33.521 6.40831 35.7367 5.38999 38.0229ZM16.2031 23.1347C15.7294 22.661 15.7001 21.9012 16.1464 21.4015C27.8778 8.26791 44.9426 0 63.9384 0C99.3187 0 128 28.6813 128 64.0615C128 83.0574 119.732 100.122 106.599 111.854C106.099 112.3 105.339 112.271 104.865 111.797L16.2031 23.1347Z" fill="#222326"/>\n</g>\n</g>\n<defs>\n<clipPath id="clip0_0_298">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_0_298">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "mixpanel":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_993)">\n<path d="M37.1571 53.3247H53.4279C49.3537 50.772 47.8324 47.2135 45.7953 40.6124L39.6841 17.9726C36.8993 7.78728 34.6044 2.93958 23.4134 2.93958H0.0257857V9.05078H3.35214C10.2111 9.05078 10.9847 11.6036 13.0218 19.2361L18.3594 39.0911C21.1442 48.7349 25.4762 53.3247 37.1571 53.3247ZM74.8042 53.3247H91.0749C102.782 53.3247 106.83 48.7349 109.641 39.0911L114.978 19.2361C117.015 11.6036 118.021 9.05078 124.648 9.05078H127.974V2.93958H104.819C93.3699 2.93958 91.075 7.52942 88.5222 17.9468L82.411 40.5866C80.4255 47.4456 78.8783 50.772 74.8042 53.3247ZM53.4279 74.6753H74.8042V53.299H53.4279V74.6753ZM0.0257857 125.06H23.4134C34.6044 125.06 36.8993 120.213 39.6841 110.053L45.7953 87.4134C47.8324 80.8123 49.3537 77.2281 53.4279 74.7011H37.1571C25.4504 74.7011 21.1185 79.2909 18.3336 88.9347L12.996 108.79C10.9331 116.396 10.1853 118.949 3.32635 118.949H0L0.0257857 125.06ZM104.819 125.06H127.974V118.949H124.648C118.047 118.949 117.015 116.396 114.978 108.764L109.641 88.909C106.856 79.2393 102.782 74.6753 91.0749 74.6753H74.83C78.9041 77.2281 80.3739 80.5286 82.411 87.3876L88.5222 110.027C91.0492 120.471 93.3441 125.06 104.819 125.06Z" fill="#1B0B3B"/>\n</g>\n<defs>\n<clipPath id="clip0_0_993">\n<rect width="128" height="122.121" fill="white" transform="translate(0 2.93958)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "neon":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_760)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M0 23.231C0 11.3138 9.71034 1.60345 21.8483 1.60345H105.048C116.966 1.60345 126.897 11.3138 126.897 23.231V93.4103C126.897 105.769 111.007 111.066 103.283 101.355L79.4483 70.6793V107.976C79.4483 118.569 70.6207 127.397 59.5862 127.397H21.8483C9.71034 127.397 0 117.686 0 105.769L0 23.231ZM21.8483 18.8172C19.4207 18.8172 17.4345 20.8035 17.4345 23.231V105.548C17.4345 107.976 19.4207 109.962 21.8483 109.962H60.2483C61.5724 109.962 61.7931 108.859 61.7931 107.755V58.1C61.7931 45.5207 77.6828 40.2241 85.4069 49.9345L109.241 80.6104V23.231C109.241 20.8035 109.462 18.8172 107.034 18.8172H21.8483Z" fill="#32C0ED"/>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M0 23.231C0 11.3138 9.71034 1.60345 21.8483 1.60345H105.048C116.966 1.60345 126.897 11.3138 126.897 23.231V93.4103C126.897 105.769 111.007 111.066 103.283 101.355L79.4483 70.6793V107.976C79.4483 118.569 70.6207 127.397 59.5862 127.397H21.8483C9.71034 127.397 0 117.686 0 105.769L0 23.231ZM21.8483 18.8172C19.4207 18.8172 17.4345 20.8035 17.4345 23.231V105.548C17.4345 107.976 19.4207 109.962 21.8483 109.962H60.2483C61.5724 109.962 61.7931 108.859 61.7931 107.755V58.1C61.7931 45.5207 77.6828 40.2241 85.4069 49.9345L109.241 80.6104V23.231C109.241 20.8035 109.462 18.8172 107.034 18.8172H21.8483Z" fill="url(#paint0_linear_0_760)"/>\n<path opacity="0.3" fill-rule="evenodd" clip-rule="evenodd" d="M0 23.231C0 11.3138 9.71034 1.60345 21.8483 1.60345H105.048C116.966 1.60345 126.897 11.3138 126.897 23.231V93.4103C126.897 105.769 111.007 111.066 103.283 101.355L79.4483 70.6793V107.976C79.4483 118.569 70.6207 127.397 59.5862 127.397H21.8483C9.71034 127.397 0 117.686 0 105.769L0 23.231ZM21.8483 18.8172C19.4207 18.8172 17.4345 20.8035 17.4345 23.231V105.548C17.4345 107.976 19.4207 109.962 21.8483 109.962H60.2483C61.5724 109.962 61.7931 108.859 61.7931 107.755V58.1C61.7931 45.5207 77.6828 40.2241 85.4069 49.9345L109.241 80.6104V23.231C109.241 20.8035 109.462 18.8172 107.034 18.8172H21.8483Z" fill="url(#paint1_linear_0_760)"/>\n<path d="M105.048 1.60345C116.965 1.60345 126.897 11.3138 126.897 23.231V93.4103C126.897 105.769 111.007 111.066 103.283 101.355L79.4483 70.6793V107.976C79.4483 118.569 70.6207 127.397 59.5862 127.397C60.9103 127.397 61.7931 126.514 61.7931 125.19V58.1C61.7931 45.7414 77.6827 40.4448 85.4069 50.1552L109.241 80.831V6.01725C109.241 3.58966 107.255 1.60345 105.048 1.60345Z" fill="#63F655"/>\n</g>\n<defs>\n<linearGradient id="paint0_linear_0_760" x1="127.091" y1="127.397" x2="16.675" y2="0.164846" gradientUnits="userSpaceOnUse">\n<stop stop-color="#2EF51C"/>\n<stop offset="1" stop-color="#2EF51C" stop-opacity="0"/>\n</linearGradient>\n<linearGradient id="paint1_linear_0_760" x1="126.81" y1="127.322" x2="51.7518" y2="97.7401" gradientUnits="userSpaceOnUse">\n<stop stop-opacity="0.9"/>\n<stop offset="1" stop-color="#1A1A1A" stop-opacity="0"/>\n</linearGradient>\n<clipPath id="clip0_0_760">\n<rect width="128" height="125.793" fill="white" transform="translate(0 1.60345)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "notion":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_82)">\n<path d="M10.5303 5.52077L81.278 0.204473C89.8658 -0.613419 92.115 0 97.6358 3.88498L120.332 19.8339C124.013 22.492 125.24 23.3099 125.24 26.377V113.687C125.24 119.208 123.195 122.479 116.243 122.888L34.0447 127.796C28.7284 128 26.2748 127.387 23.6166 123.911L7.05431 102.441C3.98721 98.3514 2.76038 95.4888 2.76038 92.0128V14.3131C2.76038 9.8147 4.8051 5.92971 10.5303 5.52077Z" fill="white"/>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M81.278 0.204473L10.5303 5.52077C4.8051 5.92971 2.76038 9.8147 2.76038 14.3131V92.0128C2.76038 95.4888 3.98721 98.5559 7.05431 102.441L23.6166 124.115C26.2748 127.591 28.9329 128.409 34.0447 128L116.243 123.093C123.195 122.684 125.24 119.412 125.24 113.891V26.377C125.24 23.5144 124.217 22.6965 120.741 20.2428C120.537 20.0383 120.332 20.0383 120.128 19.8339L97.6358 4.08946C92.3195 1.19209e-07 90.0703 -0.408946 81.278 0.204473ZM35.885 24.9457C29.1374 25.3546 27.7061 25.5591 23.8211 22.2875L14.2109 14.722C13.1885 13.6997 13.5974 12.4728 16.2556 12.2684L84.345 7.36102C90.0703 6.95208 92.9329 8.79233 95.1821 10.6326L106.837 19.016C107.45 19.2204 108.677 20.6518 107.042 20.6518L36.7029 24.9457H35.885ZM28.115 113.073V38.8498C28.115 35.5783 29.1374 34.147 32 33.9425L112.767 29.2396C115.425 29.0351 116.652 30.6709 116.652 33.9425V107.553C116.652 110.824 116.038 113.482 111.744 113.687L34.4537 118.185C30.1597 118.594 28.115 116.958 28.115 113.073ZM104.383 42.9393C104.792 45.1885 104.383 47.4377 102.134 47.6422L98.4537 48.4601V103.259C95.1821 105.099 92.3195 105.917 89.8658 105.917C85.9808 105.917 84.9585 104.69 81.8914 101.01L57.3546 62.5687V99.5783L65.1246 101.419C65.1246 101.419 65.1246 105.917 58.9904 105.917L41.8147 106.939C41.4057 105.917 41.8147 103.463 43.4505 103.054L47.9489 101.827V52.754L41.8147 52.1406C41.4057 49.8914 42.6326 46.6198 46.1086 46.4153L64.5112 45.1885L89.8658 84.0383V49.6869L83.3227 48.869C82.9137 46.2109 84.754 44.1661 87.2077 43.9617L104.383 42.9393Z" fill="black"/>\n</g>\n<defs>\n<clipPath id="clip0_0_82">\n<rect width="122.479" height="128" fill="white" transform="translate(2.76038)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "onedrive":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_168_637)">\n<path d="M48.8105 45.7717L48.8117 45.7673L75.6823 61.8624L91.694 55.1244C94.9477 53.7178 98.456 52.9965 102.001 53C102.591 53 103.175 53.0268 103.756 53.0656C101.831 45.5592 97.7669 38.7736 92.0581 33.5333C86.3493 28.293 79.2414 24.8236 71.5981 23.5468C63.9547 22.2699 56.1051 23.2406 49.003 26.3408C41.9009 29.441 35.8522 34.5373 31.5918 41.0103C31.7287 41.0086 31.8635 41 32.0007 41C37.9393 40.9919 43.7618 42.6447 48.8105 45.7717Z" fill="#0364B8"/>\n<path d="M48.811 45.7673L48.8098 45.7717C43.7611 42.6448 37.9386 40.992 32 41C31.8628 41 31.7278 41.0086 31.5911 41.0103C25.7787 41.0823 20.0958 42.7368 15.153 45.7959C10.2103 48.8551 6.1946 53.2033 3.53748 58.3733C0.880366 63.5433 -0.317721 69.3396 0.0719724 75.1394C0.461666 80.9391 2.42441 86.5231 5.74928 91.2911L29.4453 81.3194L39.979 76.8867L63.4331 67.0168L75.6816 61.8625L48.811 45.7673Z" fill="#0078D4"/>\n<path d="M103.755 53.0656C103.174 53.0268 102.591 53 102 53C98.4553 52.9966 94.9477 53.7205 91.6941 55.1271L75.6816 61.8625L80.3247 64.6436L95.5444 73.76L102.185 77.7375L124.89 91.3378C126.953 87.5079 128.022 83.2215 128 78.8713C127.977 74.521 126.863 70.246 124.76 66.4379C122.657 62.6297 119.632 59.41 115.962 57.0738C112.293 54.7375 108.095 53.3594 103.755 53.0656Z" fill="#1490DF"/>\n<path d="M102.185 77.7374L95.5451 73.7599L80.3254 64.6435L75.6823 61.8624L63.4338 67.0167L39.9797 76.8866L29.446 81.3193L5.75 91.291C8.69466 95.5247 12.6202 98.9828 17.1914 101.37C21.7626 103.757 26.8437 105.003 32.0007 105H102.001C106.694 105.001 111.3 103.732 115.33 101.327C119.361 98.9211 122.664 95.4694 124.891 91.3377L102.185 77.7374Z" fill="#28A8EA"/>\n</g>\n<defs>\n<clipPath id="clip0_168_637">\n<rect width="128" height="82" fill="white" transform="translate(0 23)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "outlook":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_142)">\n<g clip-path="url(#clip1_0_142)">\n<path d="M127.542 66.6442C127.549 65.6433 127.032 64.7117 126.179 64.1884H126.164L126.11 64.1586L81.7569 37.9037C81.5653 37.7743 81.3666 37.6561 81.1615 37.5495C79.449 36.666 77.4147 36.666 75.7021 37.5495C75.4971 37.6561 75.2983 37.7743 75.1068 37.9037L30.7534 64.1586L30.6999 64.1884C29.3443 65.0313 28.9287 66.8137 29.7717 68.1693C30.0201 68.5687 30.3622 68.9014 30.7683 69.1387L75.1218 95.3936C75.314 95.5218 75.5127 95.6401 75.7172 95.7478C77.4297 96.6313 79.464 96.6313 81.1765 95.7478C81.381 95.6401 81.5797 95.5219 81.7719 95.3936L126.125 69.1387C127.011 68.6221 127.552 67.6699 127.542 66.6442Z" fill="#0A2767"/>\n<path d="M35.924 49.1141H65.0306V75.7947H35.924V49.1141ZM121.589 21.993V9.78838C121.659 6.73693 119.243 4.20571 116.192 4.13259H40.6601C37.6086 4.20571 35.1933 6.73693 35.2632 9.78838V21.993L79.9143 33.9L121.589 21.993Z" fill="#0364B8"/>\n<path d="M35.2634 21.993H65.0308V48.7837H35.2634V21.993Z" fill="#0078D4"/>\n<path d="M94.7982 21.993H65.0308V48.7837L94.7982 75.5744H121.589V48.7837L94.7982 21.993Z" fill="#28A8EA"/>\n<path d="M65.0308 48.7837H94.7982V75.5744H65.0308V48.7837Z" fill="#0078D4"/>\n<path d="M65.0308 75.5744H94.7982V102.365H65.0308V75.5744Z" fill="#0364B8"/>\n<path d="M35.9243 75.7947H65.0309V100.049H35.9243V75.7947Z" fill="#14447D"/>\n<path d="M94.7983 75.5744H121.589V102.365H94.7983V75.5744Z" fill="#0078D4"/>\n<path d="M126.179 68.975L126.122 69.0047L81.7687 93.9498C81.5752 94.0689 81.3788 94.182 81.1733 94.2832C80.42 94.6419 79.6018 94.8444 78.7681 94.8786L76.345 93.4616C76.1403 93.3589 75.9415 93.2446 75.7497 93.1193L30.8009 67.4657H30.7801L29.3096 66.6442V117.142C29.3325 120.511 32.0815 123.224 35.4506 123.202H121.496C121.547 123.202 121.592 123.178 121.645 123.178C122.357 123.133 123.058 122.987 123.729 122.744C124.019 122.621 124.298 122.476 124.565 122.309C124.765 122.196 125.107 121.949 125.107 121.949C126.632 120.821 127.534 119.039 127.542 117.142V66.6442C127.541 67.61 127.02 68.5006 126.179 68.975Z" fill="url(#paint0_linear_0_142)"/>\n<path opacity="0.5" d="M125.161 66.4447V69.5406L78.7832 101.472L30.7683 67.4866C30.7683 67.4702 30.755 67.4568 30.7386 67.4568L26.333 64.8075V62.5749L28.1488 62.5451L31.9888 64.748L32.0781 64.7777L32.4055 64.9861C32.4055 64.9861 77.5329 90.7349 77.652 90.7944L79.3785 91.8065C79.5273 91.747 79.6761 91.6875 79.8547 91.6279C79.9441 91.5683 124.655 66.4149 124.655 66.4149L125.161 66.4447Z" fill="#0A2767"/>\n<path d="M126.179 68.975L126.123 69.0077L81.7691 93.9528C81.5756 94.0718 81.3792 94.1849 81.1737 94.2861C79.4512 95.1276 77.4369 95.1276 75.7144 94.2861C75.5104 94.1851 75.3117 94.0738 75.119 93.9528L30.7657 69.0077L30.7121 68.975C29.8558 68.5107 29.3189 67.6182 29.3101 66.6442V117.142C29.3314 120.51 32.0794 123.224 35.4478 123.202C35.4478 123.202 35.448 123.202 35.4481 123.202H121.404C124.773 123.224 127.521 120.51 127.543 117.142C127.543 117.142 127.543 117.142 127.543 117.142V66.6442C127.541 67.61 127.02 68.5006 126.179 68.975Z" fill="#1490DF"/>\n<path opacity="0.1" d="M82.4148 93.5837L81.751 93.9558C81.5586 94.0782 81.3599 94.1906 81.1556 94.2921C80.4243 94.6511 79.629 94.8616 78.8159 94.9113L95.6911 114.867L125.128 121.961C125.935 121.352 126.576 120.55 126.995 119.63L82.4148 93.5837Z" fill="black"/>\n<path opacity="0.05" d="M85.4213 91.8929L81.751 93.9558C81.5586 94.0782 81.3599 94.1906 81.1556 94.2921C80.4243 94.6511 79.629 94.8616 78.8159 94.9113L86.7221 116.71L125.137 121.952C126.65 120.816 127.541 119.034 127.542 117.142V116.49L85.4213 91.8929Z" fill="black"/>\n<path d="M35.5314 123.202H121.396C122.717 123.209 124.005 122.792 125.072 122.012L76.3425 93.4676C76.1378 93.3649 75.939 93.2506 75.7472 93.1253L30.7984 67.4717H30.7776L29.3101 66.6442V116.969C29.3067 120.408 32.0921 123.199 35.5314 123.202Z" fill="#28A8EA"/>\n<path opacity="0.1" d="M70.984 33.4029V96.8968C70.9787 99.123 69.625 101.124 67.5607 101.957C66.9212 102.232 66.2325 102.374 65.5365 102.374H29.3096V30.9233H35.2631V27.9465H65.5366C68.5438 27.9579 70.9775 30.3956 70.984 33.4029Z" fill="black"/>\n<path opacity="0.2" d="M68.0073 36.3796V99.8735C68.0147 100.593 67.8623 101.304 67.5607 101.957C66.734 103.995 64.7588 105.332 62.5598 105.342H29.3096V30.9233H62.5598C63.4235 30.9146 64.2747 31.13 65.0305 31.5484C66.8552 32.4677 68.0066 34.3364 68.0073 36.3796Z" fill="black"/>\n<path opacity="0.2" d="M68.0073 36.3796V93.92C67.9927 96.9259 65.5657 99.3623 62.5599 99.3883H29.3096V30.9233H62.5598C63.4235 30.9146 64.2747 31.13 65.0305 31.5484C66.8552 32.4677 68.0066 34.3364 68.0073 36.3796Z" fill="black"/>\n<path opacity="0.2" d="M65.0305 36.3796V93.92C65.0273 96.9306 62.5935 99.3736 59.5831 99.3883H29.3096V30.9233H59.583C62.5932 30.9249 65.0321 33.3665 65.0304 36.3767C65.0305 36.3777 65.0305 36.3786 65.0305 36.3796Z" fill="black"/>\n<path d="M4.99883 30.9233H59.5744C62.5879 30.9233 65.0308 33.3662 65.0308 36.3796V90.9552C65.0308 93.9687 62.5879 96.4116 59.5744 96.4116H4.99883C1.98534 96.4116 -0.45752 93.9686 -0.45752 90.9552V36.3796C-0.45752 33.3662 1.98541 30.9233 4.99883 30.9233Z" fill="url(#paint1_linear_0_142)"/>\n<path d="M16.5963 53.8085C17.9411 50.9433 20.1118 48.5455 22.8296 46.9233C25.8395 45.2001 29.2665 44.341 32.7333 44.4406C35.9464 44.371 39.117 45.1855 41.8987 46.7952C44.5141 48.3549 46.6205 50.6402 47.9623 53.3738C49.4235 56.386 50.1518 59.701 50.0877 63.0482C50.1585 66.5464 49.4092 70.0126 47.8998 73.1691C46.526 76.0005 44.3528 78.3672 41.6486 79.9769C38.7597 81.636 35.4714 82.4719 32.1409 82.3941C28.8591 82.4733 25.6187 81.6495 22.7731 80.0127C20.1351 78.4509 18.0022 76.163 16.6291 73.4221C15.1592 70.4535 14.4222 67.1759 14.4799 63.8638C14.4187 60.3954 15.1422 56.958 16.5963 53.8085ZM23.2404 69.9721C23.9574 71.7835 25.1733 73.3544 26.747 74.5028C28.3499 75.623 30.2692 76.201 32.2242 76.1519C34.3061 76.2342 36.3583 75.6365 38.0705 74.4491C39.6243 73.3045 40.8082 71.7293 41.4759 69.9185C42.2222 67.8964 42.5906 65.7542 42.5624 63.5989C42.5855 61.423 42.2392 59.259 41.5384 57.199C40.9194 55.339 39.7736 53.6989 38.2402 52.4779C36.5709 51.2343 34.5242 50.6035 32.4444 50.6918C30.4471 50.6401 28.4848 51.2226 26.8393 52.3558C25.239 53.5089 24 55.0938 23.2672 56.9251C21.6416 61.1227 21.6331 65.7746 23.2433 69.9781L23.2404 69.9721Z" fill="white"/>\n<path d="M94.7983 21.993H121.589V48.7837H94.7983V21.993Z" fill="#50D9FF"/>\n</g>\n</g>\n<defs>\n<linearGradient id="paint0_linear_0_142" x1="78.4258" y1="66.6442" x2="78.4258" y2="123.202" gradientUnits="userSpaceOnUse">\n<stop stop-color="#35B8F1"/>\n<stop offset="1" stop-color="#28A8EA"/>\n</linearGradient>\n<linearGradient id="paint1_linear_0_142" x1="10.9191" y1="26.6598" x2="53.6542" y2="100.675" gradientUnits="userSpaceOnUse">\n<stop stop-color="#1784D9"/>\n<stop offset="0.5" stop-color="#107AD5"/>\n<stop offset="1" stop-color="#0A63C9"/>\n</linearGradient>\n<clipPath id="clip0_0_142">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_0_142">\n<rect width="128" height="119.07" fill="white" transform="translate(-0.45752 4.13259)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "persona":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <rect width="128" height="128" rx="24" fill="#141417"/>\n  <circle cx="64" cy="64" r="42" fill="#F6F1E8"/>\n  <path d="M50 88V40H69C80 40 87 47 87 57C87 68 79 75 68 75H60V88H50ZM60 65H68C74 65 77 62 77 57C77 52 74 49 68 49H60V65Z" fill="#141417"/>\n  <path d="M37 95C43 101 52 105 64 105C76 105 85 101 91 95" stroke="#7C5CFF" stroke-width="8" stroke-linecap="round"/>\n</svg>\n',
  "posthog":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path d="M27.8824 69.6467C26.939 71.5336 24.2464 71.5336 23.3029 69.6467L21.0466 65.1342C20.6863 64.4135 20.6863 63.5651 21.0466 62.8445L23.3029 58.332C24.2464 56.445 26.939 56.445 27.8824 58.332L30.1387 62.8445C30.4989 63.5651 30.4989 64.4135 30.1387 65.1342L27.8824 69.6467ZM27.8824 95.2392C26.939 97.126 24.2464 97.126 23.3029 95.2392L21.0466 90.7265C20.6863 90.0058 20.6863 89.1575 21.0466 88.4368L23.3029 83.9243C24.2464 82.0373 26.939 82.0373 27.8824 83.9243L30.1387 88.4368C30.4989 89.1575 30.4989 90.0058 30.1387 90.7265L27.8824 95.2392Z" fill="#1D4AFF"/>\n<path d="M0 85.5251C0 83.2444 2.75748 82.1021 4.3702 83.7149L16.1037 95.4484C17.7164 97.0612 16.5742 99.8186 14.2935 99.8186H2.56C1.14615 99.8186 0 98.6725 0 97.2586V85.5251ZM0 73.1659C0 73.8448 0.269714 74.4961 0.749806 74.9761L24.8425 99.0687C25.3226 99.5488 25.9738 99.8186 26.6527 99.8186H39.8858C42.1665 99.8186 43.3088 97.0612 41.696 95.4484L4.3702 58.1226C2.75748 56.5098 0 57.6521 0 59.9328V73.1659ZM0 47.5736C0 48.2525 0.269714 48.9037 0.749806 49.3837L50.4348 99.0687C50.9148 99.5488 51.5661 99.8186 52.245 99.8186H65.4781C67.7589 99.8186 68.9011 97.0612 67.2883 95.4484L4.3702 32.5303C2.7575 30.9176 0 32.0598 0 34.3405V47.5736ZM25.5923 47.5736C25.5923 48.2525 25.8621 48.9037 26.3421 49.3837L72.4068 95.4484C74.0196 97.0612 76.777 95.9189 76.777 93.6382V80.4051C76.777 79.7262 76.5071 79.0749 76.0271 78.5949L29.9625 32.5303C28.3497 30.9176 25.5923 32.0598 25.5923 34.3405V47.5736ZM55.5548 32.5303C53.942 30.9176 51.1846 32.0598 51.1846 34.3405V47.5736C51.1846 48.2525 51.4545 48.9037 51.9345 49.3837L72.4068 69.8561C74.0196 71.4689 76.777 70.3266 76.777 68.0459V54.8128C76.777 54.1338 76.5071 53.4826 76.0271 53.0026L55.5548 32.5303Z" fill="#F9BD2B"/>\n<path d="M108.863 85.8389L84.7667 61.7423C83.1539 60.1295 80.3965 61.2718 80.3965 63.5525V97.2585C80.3965 98.6724 81.5426 99.8185 82.9565 99.8185H120.283C121.697 99.8185 122.843 98.6724 122.843 97.2585V94.1891C122.843 92.7752 121.692 91.646 120.29 91.4634C115.987 90.9033 111.963 88.9382 108.863 85.8389ZM92.6806 91.6291C90.4204 91.6291 88.5859 89.7946 88.5859 87.5341C88.5859 85.2739 90.4204 83.4394 92.6806 83.4394C94.9411 83.4394 96.7756 85.2739 96.7756 87.5341C96.7756 89.7946 94.9411 91.6291 92.6806 91.6291Z" fill="black"/>\n<path d="M0 97.2586C0 98.6725 1.14615 99.8186 2.56 99.8186H14.2935C16.5742 99.8186 17.7164 97.0612 16.1037 95.4484L4.3702 83.7149C2.75748 82.1021 0 83.2444 0 85.5251V97.2586ZM25.5923 53.7524L4.3702 32.5303C2.75748 30.9176 0 32.0597 0 34.3405V47.5736C0 48.2525 0.269714 48.9037 0.749806 49.3837L25.5923 74.2262V53.7524ZM4.3702 58.1226C2.75748 56.5098 0 57.652 0 59.9327V73.1659C0 73.8448 0.269714 74.4961 0.749806 74.9761L25.5923 99.8186V79.3447L4.3702 58.1226Z" fill="#1D4AFF"/>\n<path d="M51.1846 54.8127C51.1846 54.1338 50.915 53.4826 50.4348 53.0026L29.9624 32.5303C28.3499 30.9176 25.5923 32.0597 25.5923 34.3405V47.5736C25.5923 48.2525 25.8621 48.9037 26.3421 49.3837L51.1846 74.2262V54.8127ZM25.5923 99.8186H39.8858C42.1665 99.8186 43.3087 97.0612 41.6959 95.4484L25.5923 79.3447V99.8186ZM25.5923 53.7524V73.1659C25.5923 73.8448 25.8621 74.4961 26.3421 74.9761L51.1846 99.8186V80.4051C51.1846 79.7262 50.915 79.0749 50.4348 78.5949L25.5923 53.7524Z" fill="#F54E00"/>\n</svg>\n',
  "salesforce":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_60_20651)">\n<mask id="mask0_60_20651" style="mask-type:luminance" maskUnits="userSpaceOnUse" x="0" y="19" width="128" height="90">\n<path d="M0.0281372 19.4579H127.608V108.748H0.0281372V19.4579Z" fill="white"/>\n</mask>\n<g mask="url(#mask0_60_20651)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M53.1027 29.1995C57.2179 24.9122 62.9479 22.2518 69.2846 22.2518C77.7077 22.2518 85.0576 26.9489 88.9703 33.9228C92.4712 32.3585 96.2634 31.5522 100.098 31.5569C115.291 31.5569 127.608 43.9814 127.608 59.3086C127.608 74.6357 115.291 87.0606 100.098 87.0606C98.2426 87.0606 96.4309 86.874 94.6783 86.5205C91.2326 92.6669 84.6638 96.8205 77.1263 96.8205C74.0776 96.8247 71.0682 96.1321 68.3281 94.7955C64.8351 103.014 56.6937 108.777 47.2081 108.777C37.3277 108.777 28.9069 102.526 25.6769 93.7588C24.2373 94.0626 22.7699 94.2153 21.2986 94.2146C9.5353 94.2146 0 84.5794 0 72.6942C0 64.7282 4.28355 57.7735 10.6503 54.0531C9.30134 50.9469 8.6072 47.5961 8.61116 44.2097C8.61116 30.54 19.7078 19.4579 33.3958 19.4579C41.4321 19.4579 48.5744 23.2782 53.1027 29.1995Z" fill="#00A1E0"/>\n</g>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M18.4826 65.7765C18.4024 65.9856 18.5112 66.0292 18.537 66.0663C18.7766 66.2398 19.0199 66.3654 19.2656 66.5065C20.5667 67.1953 21.7965 67.3974 23.0812 67.3974C25.6989 67.3974 27.3249 66.0058 27.3249 63.7646V63.7206C27.3249 61.6482 25.4893 60.8952 23.7691 60.3518L23.5445 60.2791C22.2471 59.858 21.1275 59.4937 21.1275 58.639V58.5954C21.1275 57.8635 21.782 57.3257 22.7962 57.3257C23.9238 57.3257 25.26 57.7003 26.1218 58.1762C26.1218 58.1762 26.3759 58.3403 26.4683 58.0951C26.5185 57.9624 26.9541 56.7893 27.0005 56.6623C27.0502 56.5249 26.963 56.4213 26.8734 56.3678C25.8893 55.7681 24.53 55.3602 23.123 55.3602L22.8618 55.3612C20.4659 55.3612 18.793 56.81 18.793 58.8833V58.9278C18.793 61.1127 20.6385 61.8231 22.3672 62.3168L22.6447 62.403C23.9036 62.7894 24.9909 63.1232 24.9909 64.0089V64.053C24.9909 64.8641 24.2843 65.4666 23.1464 65.4666C22.7052 65.4666 21.2967 65.4591 19.7748 64.4965C19.5905 64.3892 19.4855 64.3118 19.3434 64.2251C19.2684 64.1796 19.0809 64.0975 18.9993 64.3432L18.4826 65.7765ZM56.8029 65.7765C56.7227 65.9856 56.8315 66.0292 56.8582 66.0663C57.0969 66.2398 57.3407 66.3654 57.5859 66.5065C58.8875 67.1953 60.1173 67.3974 61.4015 67.3974C64.0192 67.3974 65.6457 66.0058 65.6457 63.7646V63.7206C65.6457 61.6482 63.8105 60.8952 62.0898 60.3518L61.8652 60.2791C60.5679 59.858 59.4478 59.4937 59.4478 58.639V58.5954C59.4478 57.8635 60.1028 57.3257 61.1174 57.3257C62.2445 57.3257 63.5803 57.7003 64.4421 58.1762C64.4421 58.1762 64.6962 58.3403 64.7891 58.0951C64.8388 57.9624 65.2748 56.7893 65.3208 56.6623C65.3709 56.5249 65.2833 56.4213 65.1942 56.3678C64.2096 55.7681 62.8508 55.3602 61.4437 55.3602L61.1821 55.3612C58.7867 55.3612 57.1138 56.81 57.1138 58.8833V58.9278C57.1138 61.1127 58.9587 61.8231 60.6879 62.3168L60.965 62.403C62.2244 62.7894 63.3117 63.1232 63.3117 64.0089V64.053C63.3117 64.8641 62.6046 65.4666 61.4676 65.4666C61.0255 65.4666 59.617 65.4591 58.0956 64.4965C57.9113 64.3892 57.8035 64.3151 57.6637 64.2251C57.6164 64.195 57.3955 64.1088 57.3201 64.3432L56.8029 65.7765ZM82.9632 61.3861C82.9632 62.652 82.7269 63.6516 82.2627 64.3563C81.8013 65.0549 81.1051 65.3949 80.1341 65.3949C79.163 65.3949 78.4705 65.0554 78.0167 64.3573C77.5586 63.6521 77.326 62.652 77.326 61.3861C77.326 60.1211 77.5586 59.1247 78.0167 58.4271C78.4705 57.7355 79.163 57.3998 80.1341 57.3998C81.1051 57.3998 81.8013 57.736 82.2627 58.4275C82.7278 59.1247 82.9632 60.1211 82.9632 61.3861ZM85.149 59.0385C84.9338 58.3122 84.5995 57.6731 84.1546 57.14C83.7087 56.6055 83.1446 56.1756 82.476 55.8643C81.8084 55.5525 81.0207 55.3945 80.1341 55.3945C79.2474 55.3945 78.4593 55.5525 77.7911 55.8643C77.1235 56.1756 76.559 56.6055 76.1131 57.141C75.6686 57.675 75.3334 58.3131 75.1191 59.0385C74.9058 59.7591 74.7975 60.5492 74.7975 61.3861C74.7975 62.2235 74.9058 63.014 75.1191 63.7337C75.3334 64.4585 75.6677 65.0971 76.1136 65.6321C76.5594 66.1676 77.1254 66.5938 77.7921 66.8976C78.4607 67.2014 79.2484 67.3561 80.1341 67.3561C81.0202 67.3561 81.807 67.2014 82.4751 66.8976C83.1428 66.5938 83.7077 66.1676 84.1546 65.6321C84.5995 65.099 84.9338 64.4595 85.149 63.7337C85.3619 63.0126 85.4702 62.2225 85.4702 61.3861C85.4702 60.5501 85.3619 59.7596 85.149 59.0385ZM103.091 65.0559C103.019 64.8435 102.812 64.9237 102.812 64.9237C102.495 65.0451 102.157 65.1576 101.796 65.2139C101.432 65.2711 101.029 65.2997 100.599 65.2997C99.5422 65.2997 98.7006 64.9851 98.1 64.3634C97.4966 63.7412 97.1576 62.7359 97.1613 61.3762C97.1646 60.1403 97.4638 59.2091 98.0001 58.4993C98.5318 57.7941 99.3439 57.4321 100.424 57.4321C101.325 57.4321 102.013 57.5367 102.734 57.7627C102.734 57.7627 102.905 57.8372 102.987 57.6117C103.179 57.0805 103.32 56.7026 103.525 56.1189C103.583 55.9524 103.44 55.8821 103.388 55.8619C103.105 55.7513 102.436 55.5698 101.931 55.4934C101.459 55.4212 100.907 55.3837 100.291 55.3837C99.3739 55.3837 98.5557 55.5407 97.8562 55.8521C97.1581 56.1629 96.5659 56.5924 96.0965 57.1264C95.6272 57.6614 95.2699 58.3005 95.0336 59.0253C94.7969 59.7465 94.6773 60.5379 94.6773 61.3772C94.6773 63.1893 95.1663 64.6536 96.1308 65.7264C97.0985 66.8029 98.5501 67.3496 100.445 67.3496C101.564 67.3496 102.712 67.1231 103.539 66.7977C103.539 66.7977 103.697 66.7218 103.628 66.538L103.091 65.0559ZM106.914 60.1722C107.019 59.4684 107.211 58.8837 107.512 58.4271C107.965 57.7355 108.656 57.3543 109.627 57.3543C110.598 57.3543 111.238 57.736 111.699 58.4275C112.004 58.8847 112.137 59.4937 112.189 60.1731L106.914 60.1722ZM114.27 58.6263C114.084 57.9259 113.626 57.2183 113.324 56.8948C112.848 56.3819 112.382 56.0227 111.919 55.8244C111.25 55.5398 110.529 55.3935 109.801 55.3945C108.878 55.3945 108.039 55.5506 107.359 55.8694C106.678 56.1892 106.105 56.6262 105.657 57.1691C105.207 57.7116 104.87 58.3572 104.655 59.0896C104.439 59.8177 104.33 60.6115 104.33 61.4498C104.33 62.3022 104.443 63.097 104.666 63.8115C104.89 64.5322 105.251 65.1647 105.737 65.6912C106.224 66.2196 106.849 66.6341 107.597 66.9229C108.341 67.2113 109.245 67.3608 110.282 67.3575C112.419 67.3505 113.543 66.8741 114.007 66.6177C114.089 66.5717 114.167 66.4925 114.07 66.2641L113.586 64.9101C113.512 64.708 113.308 64.7811 113.308 64.7811C112.777 64.979 112.027 65.332 110.271 65.3283C109.124 65.3264 108.275 64.9874 107.741 64.4581C107.195 63.9165 106.926 63.1213 106.881 61.9979L114.276 62.0036C114.276 62.0036 114.471 62.0017 114.491 61.8113C114.499 61.7326 114.745 60.2922 114.27 58.6263ZM47.6783 60.1722C47.7829 59.4684 47.9761 58.8837 48.2761 58.4271C48.73 57.7355 49.4192 57.3543 50.3912 57.3543C51.3627 57.3543 52.0027 57.736 52.464 58.4275C52.7683 58.8847 52.9015 59.4937 52.9535 60.1731L47.6783 60.1722ZM55.0343 58.6263C54.8487 57.9259 54.3897 57.2183 54.0886 56.8948C53.6127 56.3819 53.1472 56.0227 52.6839 55.8244C52.0141 55.5399 51.2938 55.3937 50.5661 55.3945C49.6429 55.3945 48.8041 55.5506 48.1238 55.8694C47.4425 56.1892 46.87 56.6262 46.4204 57.1691C45.9717 57.7116 45.6346 58.3572 45.4184 59.0896C45.2032 59.8177 45.0949 60.6115 45.0949 61.4498C45.0949 62.3022 45.2069 63.097 45.4306 63.8115C45.6547 64.5322 46.0157 65.1647 46.5015 65.6912C46.9882 66.2196 47.6136 66.6341 48.3615 66.9229C49.106 67.2113 50.0091 67.3608 51.0467 67.3575C53.1833 67.3505 54.3076 66.8741 54.7718 66.6177C54.8534 66.5717 54.9312 66.4925 54.8341 66.2641L54.3507 64.9101C54.2762 64.708 54.0718 64.7811 54.0718 64.7811C53.5419 64.979 52.7913 65.332 51.0354 65.3283C49.889 65.3264 49.039 64.9874 48.5049 64.4581C47.9592 63.9165 47.6905 63.1213 47.645 61.9979L55.0404 62.0036C55.0404 62.0036 55.2355 62.0017 55.2556 61.8113C55.2636 61.7326 55.5093 60.2922 55.0343 58.6263ZM31.6915 65.0156C31.4012 64.7839 31.3609 64.7272 31.2648 64.5767C31.118 64.3502 31.043 64.0277 31.043 63.6146C31.043 62.9652 31.2587 62.4973 31.7032 62.1831C31.6985 62.1841 32.3408 61.6289 33.8482 61.6486C34.5207 61.6606 35.1916 61.7178 35.8564 61.8198V65.1815H35.8573C35.8573 65.1815 34.9172 65.3836 33.859 65.4474C32.3549 65.5379 31.6868 65.0142 31.6915 65.0156ZM34.6345 59.8177C34.3345 59.7957 33.9458 59.7849 33.4797 59.7849C32.8463 59.7849 32.2335 59.8637 31.6582 60.0184C31.0805 60.1741 30.561 60.4151 30.1142 60.7344C29.6677 61.0534 29.3004 61.4708 29.041 61.9543C28.7789 62.4424 28.6452 63.0159 28.6452 63.6587C28.6452 64.3146 28.7592 64.8829 28.9842 65.347C29.2044 65.8073 29.5359 66.2053 29.9487 66.5051C30.3599 66.8043 30.8672 67.0237 31.4556 67.1578C32.0365 67.2905 32.6948 67.3575 33.4141 67.3575C34.1736 67.3575 34.929 67.2938 35.6609 67.1705C36.2843 67.063 36.9054 66.9424 37.5237 66.8085C37.7703 66.7518 38.0422 66.6772 38.0422 66.6772C38.2251 66.6308 38.211 66.4353 38.211 66.4353L38.2068 59.6714C38.2068 58.188 37.8111 57.0889 37.0314 56.4063C36.2554 55.7269 35.1128 55.3837 33.6344 55.3837C33.0793 55.3837 32.1875 55.4587 31.6521 55.5661C31.6521 55.5661 30.0373 55.8793 29.3725 56.4002C29.3725 56.4002 29.2262 56.4902 29.3059 56.6941L29.8296 58.1007C29.8948 58.2831 30.0725 58.2208 30.0725 58.2208C30.0725 58.2208 30.1283 58.1987 30.1939 58.1598C31.6164 57.3862 33.4164 57.4092 33.4164 57.4092C34.2154 57.4092 34.831 57.5709 35.2445 57.8874C35.6482 58.1973 35.8531 58.6638 35.8531 59.6499V59.9626C35.2187 59.8707 34.6345 59.8177 34.6345 59.8177ZM94.2905 56.0073C94.3011 55.9825 94.3067 55.9559 94.3069 55.929C94.307 55.9021 94.3018 55.8754 94.2914 55.8505C94.281 55.8257 94.2658 55.8032 94.2465 55.7844C94.2273 55.7655 94.2044 55.7508 94.1794 55.7409C94.0532 55.6931 93.4245 55.5604 92.9397 55.5304C92.0099 55.4723 91.4947 55.6289 91.0323 55.8371C90.5738 56.0438 90.066 56.3781 89.7828 56.7593L89.7819 55.8572C89.7819 55.7334 89.6942 55.6336 89.5695 55.6336H87.6734C87.5506 55.6336 87.4615 55.7334 87.4615 55.8572V66.8905C87.4616 66.9501 87.4853 67.0071 87.5274 67.0492C87.5695 67.0913 87.6265 67.115 87.6861 67.1151H89.6295C89.689 67.115 89.746 67.0913 89.788 67.0492C89.83 67.0071 89.8536 66.95 89.8536 66.8905V61.379C89.8536 60.6387 89.9352 59.9012 90.0979 59.4375C90.2583 58.9785 90.4763 58.6127 90.7463 58.3497C91.0022 58.0958 91.3155 57.9074 91.6597 57.8002C91.9823 57.7076 92.3162 57.6606 92.6518 57.6605C93.0386 57.6605 93.4643 57.7599 93.4643 57.7599C93.6069 57.7758 93.6861 57.6886 93.7344 57.5601C93.8615 57.2221 94.2216 56.2089 94.2905 56.0073Z" fill="#FFFFFE"/>\n<path fill-rule="evenodd" clip-rule="evenodd" d="M76.0503 50.8943C75.8104 50.8218 75.5663 50.7638 75.3193 50.7208C74.9872 50.6654 74.6508 50.6393 74.3141 50.643C72.9764 50.643 71.9219 51.0209 71.1816 51.7673C70.4464 52.5081 69.9461 53.6367 69.6953 55.1216L69.6048 55.6228H67.9258C67.9258 55.6228 67.7209 55.6143 67.6778 55.838L67.4021 57.3759C67.3829 57.5231 67.4462 57.615 67.6431 57.6141H69.2775L67.6192 66.8708C67.4893 67.6163 67.3407 68.2296 67.1761 68.6943C67.0139 69.1528 66.8554 69.4965 66.6603 69.7459C66.4714 69.9874 66.2923 70.1651 65.9833 70.2687C65.7282 70.3545 65.4347 70.3939 65.1131 70.3939C64.934 70.3939 64.6958 70.3639 64.52 70.3287C64.3441 70.294 64.2527 70.2546 64.121 70.1993C64.121 70.1993 63.9292 70.1262 63.8537 70.3184C63.7923 70.4755 63.3567 71.6734 63.3051 71.8216C63.2526 71.9679 63.3262 72.0832 63.4191 72.1165C63.6366 72.1943 63.7984 72.244 64.0947 72.3139C64.5064 72.4109 64.8533 72.417 65.1783 72.417C65.859 72.417 66.4794 72.3214 66.9937 72.1357C67.5113 71.9486 67.9619 71.6228 68.3604 71.1816C68.7913 70.7057 69.0623 70.2073 69.3216 69.5274C69.5781 68.8537 69.7966 68.0172 69.9715 67.0424L71.6378 57.6141H74.074C74.074 57.6141 74.2794 57.6216 74.3221 57.3988L74.5977 55.861C74.617 55.7137 74.5541 55.6218 74.3563 55.6228H71.9918C72.0035 55.5693 72.1109 54.7376 72.3824 53.9546C72.4982 53.6203 72.7162 53.3507 72.9009 53.1655C73.0734 52.9891 73.2859 52.8569 73.5203 52.7801C73.7773 52.7006 74.0451 52.662 74.3141 52.6657C74.5368 52.6657 74.7553 52.6924 74.9217 52.7271C75.151 52.7758 75.2401 52.8016 75.3001 52.8194C75.5411 52.8931 75.5735 52.8218 75.6208 52.705L76.1863 51.1522C76.2444 50.9852 76.1028 50.9149 76.0503 50.8943ZM43.0075 66.8905C43.0075 67.0143 42.9194 67.1151 42.7956 67.1151H40.8343C40.7101 67.1151 40.6219 67.0143 40.6219 66.8905V51.1048C40.6219 50.9815 40.7101 50.8816 40.8343 50.8816H42.7956C42.9194 50.8816 43.0075 50.9815 43.0075 51.1048V66.8905Z" fill="#FFFFFE"/>\n</g>\n<defs>\n<clipPath id="clip0_60_20651">\n<rect width="128" height="89.5531" fill="white" transform="translate(0 19.2234)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "sap":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n  <rect width="128" height="128" rx="24" fill="#0A6ED1"/>\n  <path d="M24 34H104L88 94H24V34Z" fill="#FFFFFF"/>\n  <path d="M33 80L40 48H50C56 48 60 51 60 56C60 60 57 64 52 65C56 66 58 69 58 73C58 78 54 80 48 80H33ZM43 61H48C51 61 53 59 53 56C53 54 51 53 48 53H45L43 61ZM40 75H47C50 75 52 73 52 70C52 68 50 66 47 66H42L40 75Z" fill="#0A6ED1"/>\n  <path d="M60 80L67 48H78C85 48 89 52 89 58C89 66 83 70 75 70H70L68 80H60ZM72 64H76C80 64 82 62 82 58C82 55 80 53 76 53H73L72 64Z" fill="#0A6ED1"/>\n  <path d="M88 80L95 48H102L95 80H88Z" fill="#0A6ED1"/>\n</svg>\n',
  "sentry":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_240_7110)">\n<path d="M74.2302 13.7912C73.1656 12.0243 71.6623 10.5626 69.8663 9.54791C68.0702 8.53321 66.0424 8 63.9795 8C61.9167 8 59.8889 8.53321 58.0928 9.54791C56.2968 10.5626 54.7935 12.0243 53.7289 13.7912L36.8665 42.6725C49.7487 49.104 60.7244 58.7933 68.7039 70.7783C76.6835 82.7634 81.3892 96.6272 82.3539 110.993H70.5144C69.5514 98.6788 65.3897 86.8294 58.4408 76.6174C51.492 66.4054 41.997 58.1849 30.8955 52.7694L15.2888 79.7543C21.5298 82.5533 26.9669 86.8764 31.1001 92.3262C35.2333 97.7759 37.93 104.177 38.9423 110.942H11.7524C11.4299 110.919 11.1182 110.816 10.8453 110.643C10.5725 110.47 10.3471 110.231 10.1894 109.949C10.0318 109.667 9.94687 109.35 9.94235 109.026C9.93782 108.703 10.0138 108.384 10.1635 108.097L17.6978 95.2841C15.1452 93.1544 12.2279 91.5047 9.08718 90.415L1.62982 103.228C0.85347 104.56 0.34947 106.033 0.147096 107.561C-0.055277 109.089 0.0480115 110.642 0.450962 112.13C0.853912 113.617 1.54849 115.01 2.49435 116.227C3.4402 117.445 4.61848 118.462 5.96073 119.219C7.72922 120.216 9.72251 120.745 11.7524 120.757H48.9879C49.6795 112.223 48.1556 103.656 44.5638 95.8843C40.9721 88.1126 35.4342 81.4002 28.4866 76.3972L34.4064 66.1465C43.1744 72.1686 50.2205 80.3729 54.8494 89.9498C59.4783 99.5267 61.5299 110.145 60.8018 120.757H92.3483C93.0829 104.681 89.5857 88.6944 82.206 74.3938C74.8264 60.0932 63.8228 47.9798 50.2949 39.2641L62.2626 18.7628C62.5292 18.316 62.9616 17.9926 63.4655 17.863C63.9695 17.7334 64.5042 17.8081 64.9534 18.0709C66.3116 18.814 116.95 107.175 117.898 108.2C118.065 108.499 118.15 108.838 118.144 109.181C118.139 109.524 118.043 109.859 117.866 110.153C117.689 110.447 117.438 110.689 117.137 110.854C116.837 111.02 116.498 111.103 116.155 111.096H103.957C104.111 114.359 104.111 117.613 103.957 120.86H116.207C117.762 120.87 119.304 120.571 120.744 119.981C122.183 119.392 123.491 118.522 124.592 117.424C125.693 116.325 126.566 115.019 127.158 113.581C127.751 112.142 128.053 110.601 128.046 109.046C128.048 106.991 127.499 104.974 126.457 103.203L74.2302 13.7912Z" fill="#362D59"/>\n</g>\n<defs>\n<clipPath id="clip0_240_7110">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "servicenow":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_240_7254)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M64.8496 6.4716C51.9773 6.44474 39.3938 10.2854 28.7303 17.4956C18.0669 24.7058 9.81525 34.9531 5.04525 46.909C0.275257 58.865 -0.79315 71.9781 1.97853 84.5485C4.75021 97.1189 11.2341 108.567 20.5898 117.408C22.7842 119.498 25.6541 120.733 28.6802 120.89C31.7063 121.047 34.6886 120.116 37.0876 118.265C45.0028 112.374 54.6063 109.193 64.4727 109.193C74.3391 109.193 83.9426 112.374 91.8577 118.265C94.2798 120.12 97.288 121.043 100.334 120.865C103.379 120.688 106.26 119.421 108.45 117.297C117.732 108.488 124.173 97.1083 126.945 84.6157C129.718 72.1232 128.697 59.0872 124.013 47.1787C119.328 35.2703 111.195 25.0321 100.654 17.7764C90.113 10.5208 77.6456 6.57836 64.8496 6.45447M64.4727 102.76C60.242 102.875 56.0323 102.126 52.1006 100.56C48.1688 98.9933 44.5974 96.6422 41.6043 93.65C38.6113 90.6577 36.2593 87.087 34.6919 83.1556C33.1245 79.2243 32.3745 75.0148 32.4877 70.7841C32.4877 62.3012 35.8576 54.1657 41.8559 48.1673C47.8543 42.169 55.9898 38.7992 64.4727 38.7992C72.9556 38.7992 81.0911 42.169 87.0894 48.1673C93.0878 54.1657 96.4576 62.3012 96.4576 70.7841C96.5709 75.0148 95.8209 79.2243 94.2535 83.1556C92.6861 87.087 90.3341 90.6577 87.341 93.65C84.348 96.6422 80.7765 98.9933 76.8448 100.56C72.913 102.126 68.7034 102.875 64.4727 102.76Z" fill="#62D84E"/>\n</g>\n<defs>\n<clipPath id="clip0_240_7254">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "sharepoint":
    '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Microsoft SharePoint</title><path d="M24 13.5q0 1.242-.475 2.332-.474 1.09-1.289 1.904-.814.815-1.904 1.29-1.09.474-2.332.474-.762 0-1.523-.2-.106.997-.557 1.858-.451.862-1.154 1.494-.704.633-1.606.99-.902.358-1.91.358-1.09 0-2.045-.416-.955-.416-1.664-1.125-.709-.709-1.125-1.664Q6 19.84 6 18.75q0-.188.018-.375.017-.188.04-.375H.997q-.41 0-.703-.293T0 17.004V6.996q0-.41.293-.703T.996 6h3.54q.14-1.277.726-2.373.586-1.096 1.488-1.904Q7.652.914 8.807.457 9.96 0 11.25 0q1.395 0 2.625.533T16.02 1.98q.914.915 1.447 2.145T18 6.75q0 .188-.012.375-.011.188-.035.375 1.242 0 2.344.469 1.101.468 1.928 1.277.826.809 1.3 1.904Q24 12.246 24 13.5zm-12.75-12q-.973 0-1.857.34-.885.34-1.577.943-.691.604-1.154 1.43Q6.2 5.039 6.06 6h4.945q.41 0 .703.293t.293.703v4.945l.21-.035q.212-.75.61-1.424.399-.673.944-1.218.545-.545 1.213-.944.668-.398 1.43-.61.093-.503.093-.96 0-1.09-.416-2.045-.416-.955-1.125-1.664-.709-.709-1.664-1.125Q12.34 1.5 11.25 1.5zM6.117 15.902q.54 0 1.06-.111.522-.111.932-.37.41-.257.662-.679.252-.422.252-1.055 0-.632-.263-1.054-.264-.422-.662-.703-.399-.282-.856-.463l-.855-.34q-.399-.158-.662-.334-.264-.176-.264-.445 0-.2.14-.323.141-.123.335-.193.193-.07.404-.094.21-.023.351-.023.598 0 1.055.152.457.153.95.457V8.543q-.282-.082-.522-.14-.24-.06-.475-.1-.234-.041-.486-.059-.252-.017-.557-.017-.515 0-1.054.117-.54.117-.979.375-.44.258-.715.68-.275.421-.275 1.03 0 .598.263.997.264.398.663.68.398.28.855.474l.856.363q.398.17.662.358.263.187.263.457 0 .222-.123.351-.123.13-.31.2-.188.07-.393.087-.205.018-.369.018-.703 0-1.248-.234-.545-.235-1.107-.621v1.875q1.195.468 2.472.468zM11.25 22.5q.773 0 1.453-.293t1.19-.803q.51-.51.808-1.195.299-.686.299-1.459 0-.668-.223-1.277-.222-.61-.62-1.096-.4-.486-.95-.826-.55-.34-1.207-.48v1.933q0 .41-.293.703t-.703.293H7.57q-.07.375-.07.75 0 .773.293 1.459t.803 1.195q.51.51 1.195.803.686.293 1.459.293zM18 18q.926 0 1.746-.352.82-.351 1.436-.966.615-.616.966-1.43.352-.815.352-1.752 0-.926-.352-1.746-.351-.82-.966-1.436-.616-.615-1.436-.966Q18.926 9 18 9t-1.74.357q-.815.358-1.43.973t-.973 1.43q-.357.814-.357 1.74 0 .129.006.258t.017.258q.551.27 1.02.65t.838.855q.369.475.627 1.026.258.55.387 1.148Q17.18 18 18 18Z"/></svg>',
  "sheets":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_93)">\n<path d="M78.091 0L110.091 32L94.091 34.9091L78.091 32L75.1819 16L78.091 0Z" fill="#188038"/>\n<path d="M78.0909 32V0H25.7273C20.9055 0 17 3.90545 17 8.72727V119.273C17 124.095 20.9055 128 25.7273 128H101.364C106.185 128 110.091 124.095 110.091 119.273V32H78.0909Z" fill="#34A853"/>\n<path d="M34.4546 49.4545V91.6364H92.6364V49.4545H34.4546ZM59.9091 84.3636H41.7273V74.1818H59.9091V84.3636ZM59.9091 66.9091H41.7273V56.7273H59.9091V66.9091ZM85.3637 84.3636H67.1819V74.1818H85.3637V84.3636ZM85.3637 66.9091H67.1819V56.7273H85.3637V66.9091Z" fill="white"/>\n</g>\n<defs>\n<clipPath id="clip0_0_93">\n<rect width="93.0909" height="128" fill="white" transform="translate(17)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "shopify":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M87.0912 125.74L86.8059 16.0619C86.0672 15.3232 84.6263 15.5463 84.0631 15.7109L80.3108 16.8738C79.8477 15.3497 79.2466 13.871 78.5152 12.456C75.8528 7.37257 71.9616 4.68457 67.2512 4.67725H67.2366C66.922 4.67725 66.6112 4.70651 66.2967 4.73211L66.2601 4.73577C66.1239 4.56799 65.9824 4.40455 65.8359 4.24571C63.7879 2.05143 61.1547 0.979883 58.0023 1.07131C51.9241 1.24685 45.8715 5.64274 40.96 13.4507C37.504 18.9474 34.8818 25.8485 34.1321 31.1915L22.1623 34.9035C18.6404 36.0117 18.5307 36.1214 18.0663 39.4457C17.7188 41.9618 8.49918 113.346 8.49918 113.346L85.7673 126.723L87.0912 125.74ZM61.7764 6.08525C60.7488 5.40868 59.5456 5.09417 58.1193 5.12343C48.7351 5.39405 40.5504 20.0702 38.4621 29.8494L47.4514 27.0626L49.0569 26.5653C50.2345 20.3554 53.1895 13.9115 57.0551 9.76434C58.4067 8.27828 60.0022 7.03403 61.7728 6.08525H61.7764ZM53.5003 25.1865L66.4027 21.1856C66.4429 17.821 66.0772 12.8473 64.395 9.33645C62.603 10.0752 61.0962 11.3698 60.0137 12.5291C57.1136 15.6487 54.7474 20.4066 53.504 25.1865H53.5003ZM70.4439 19.9349L76.4416 18.0734C75.4834 14.9575 73.2087 9.73508 68.597 8.85737C70.0306 12.5621 70.4 16.8519 70.4439 19.9349Z" fill="#95BF47"/>\n<path d="M104.404 24.2214C103.943 24.1848 95.0126 24.0459 95.0126 24.0459C95.0126 24.0459 87.541 16.7828 86.8023 16.0404C86.5163 15.7764 86.1539 15.6099 85.7673 15.5649V126.706L119.248 118.371C119.248 118.371 105.585 25.8781 105.498 25.2454C105.455 24.9767 105.324 24.7299 105.125 24.5443C104.927 24.3587 104.675 24.2451 104.404 24.2214Z" fill="#5E8E3E"/>\n<path d="M67.211 41.4794L63.3198 56.0494C63.3198 56.0494 58.9824 54.0709 53.8368 54.3964C46.2957 54.8718 46.2153 59.6371 46.2921 60.833C46.7017 67.3427 63.8208 68.769 64.7826 84.0302C65.5396 96.0366 58.4228 104.254 48.1682 104.898C35.8619 105.677 29.0852 98.4065 29.0852 98.4065L31.6928 87.2961C31.6928 87.2961 38.5133 92.449 43.9698 92.1016C47.5392 91.8785 48.8119 88.9747 48.6839 86.9194C48.1463 78.4238 34.2052 78.9212 33.3239 64.9582C32.5851 53.2005 40.2907 41.2965 57.3001 40.2213C63.8537 39.8044 67.211 41.483 67.211 41.483" fill="white"/>\n</svg>\n',
  "slack":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_113)">\n<g clip-path="url(#clip1_0_113)">\n<path d="M26.8925 80.886C26.8925 88.2866 20.8469 94.3323 13.4463 94.3323C6.04561 94.3323 0 88.2866 0 80.886C0 73.4853 6.04561 67.4397 13.4463 67.4397H26.8925V80.886Z" fill="#E01E5A"/>\n<path d="M33.6675 80.886C33.6675 73.4853 39.7131 67.4397 47.1137 67.4397C54.5144 67.4397 60.56 73.4853 60.56 80.886V114.554C60.56 121.954 54.5144 128 47.1137 128C39.7131 128 33.6675 121.954 33.6675 114.554V80.886Z" fill="#E01E5A"/>\n<path d="M47.1137 26.8925C39.7131 26.8925 33.6675 20.8469 33.6675 13.4463C33.6675 6.0456 39.7131 -3.8147e-06 47.1137 -3.8147e-06C54.5144 -3.8147e-06 60.56 6.0456 60.56 13.4463V26.8925H47.1137Z" fill="#36C5F0"/>\n<path d="M47.114 33.6678C54.5147 33.6678 60.5603 39.7134 60.5603 47.114C60.5603 54.5147 54.5147 60.5603 47.114 60.5603H13.4463C6.0456 60.5603 0 54.5147 0 47.114C0 39.7134 6.0456 33.6678 13.4463 33.6678H47.114Z" fill="#36C5F0"/>\n<path d="M101.107 47.114C101.107 39.7134 107.153 33.6678 114.554 33.6678C121.954 33.6678 128 39.7134 128 47.114C128 54.5147 121.954 60.5603 114.554 60.5603H101.107V47.114Z" fill="#2EB67D"/>\n<path d="M94.3322 47.114C94.3322 54.5147 88.2866 60.5603 80.8859 60.5603C73.4853 60.5603 67.4397 54.5147 67.4397 47.114V13.4463C67.4397 6.0456 73.4853 -3.8147e-06 80.8859 -3.8147e-06C88.2866 -3.8147e-06 94.3322 6.0456 94.3322 13.4463V47.114Z" fill="#2EB67D"/>\n<path d="M80.8859 101.107C88.2866 101.107 94.3322 107.153 94.3322 114.554C94.3322 121.954 88.2866 128 80.8859 128C73.4853 128 67.4397 121.954 67.4397 114.554V101.107H80.8859Z" fill="#ECB22E"/>\n<path d="M80.8859 94.3323C73.4853 94.3323 67.4397 88.2866 67.4397 80.886C67.4397 73.4853 73.4853 67.4397 80.8859 67.4397H114.554C121.954 67.4397 128 73.4853 128 80.886C128 88.2866 121.954 94.3323 114.554 94.3323H80.8859Z" fill="#ECB22E"/>\n</g>\n</g>\n<defs>\n<clipPath id="clip0_0_113">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_0_113">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "snowflake":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_58_7704)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M117.899 55.7094L103.495 64.009L117.899 72.2385C118.76 72.7364 119.515 73.3991 120.12 74.1887C120.726 74.9782 121.169 75.8793 121.427 76.8405C121.684 77.8016 121.749 78.8039 121.618 79.7902C121.488 80.7766 121.165 81.7275 120.667 82.5889C120.169 83.4503 119.506 84.2051 118.717 84.8104C117.927 85.4157 117.026 85.8595 116.065 86.1165C115.104 86.3736 114.101 86.4388 113.115 86.3084C112.129 86.1781 111.178 85.8547 110.316 85.3569L84.5083 70.4894C83.3255 69.8051 82.3494 68.8142 81.6829 67.6213C81.0164 66.4283 80.6842 65.0776 80.7215 63.7116C80.7417 63.1198 80.8328 62.5326 80.9926 61.9625C81.5209 60.0506 82.7766 58.4214 84.4909 57.4236L110.299 42.6086C111.164 42.1086 112.119 41.7842 113.11 41.6539C114.101 41.5235 115.107 41.5898 116.072 41.8489C117.037 42.108 117.942 42.5549 118.734 43.164C119.526 43.7731 120.19 44.5323 120.689 45.3984C121.189 46.257 121.514 47.2063 121.645 48.1915C121.775 49.1766 121.709 50.1779 121.449 51.1371C121.19 52.0964 120.742 52.9945 120.133 53.7794C119.523 54.5643 118.764 55.2204 117.899 55.7094ZM104.265 95.939L78.4652 81.0978C77.3109 80.4354 76.0034 80.0865 74.6726 80.086C73.3417 80.0854 72.0339 80.4331 70.8791 81.0945C69.7243 81.7559 68.7626 82.708 68.0897 83.8562C67.4168 85.0044 67.0561 86.3087 67.0435 87.6395V117.287C67.1103 119.257 67.9398 121.124 69.357 122.493C70.7741 123.863 72.668 124.629 74.639 124.629C76.61 124.629 78.5039 123.863 79.921 122.493C81.3381 121.124 82.1676 119.257 82.2345 117.287V100.67L96.6734 108.97C97.5348 109.468 98.4859 109.792 99.4724 109.923C100.459 110.054 101.462 109.989 102.423 109.733C103.385 109.476 104.286 109.033 105.076 108.427C105.866 107.822 106.53 107.068 107.028 106.206C107.527 105.345 107.851 104.394 107.981 103.407C108.112 102.421 108.048 101.418 107.791 100.457C107.534 99.495 107.091 98.5935 106.486 97.8033C105.881 97.0132 105.126 96.35 104.265 95.8515V95.939ZM74.5297 66.9387L63.7726 77.5646C63.4046 77.9067 62.9277 78.108 62.4258 78.133H59.2687C58.768 78.103 58.2927 77.9024 57.9218 77.5646L47.226 66.9037C46.8914 66.5386 46.6937 66.0689 46.6663 65.5744V62.426C46.6952 61.9293 46.8926 61.4573 47.226 61.0879L57.9218 50.4271C58.2935 50.0919 58.7689 49.8943 59.2687 49.8674H62.4258C62.9264 49.8907 63.403 50.0888 63.7726 50.4271L74.4947 61.0879C74.8255 61.4581 75.0199 61.9302 75.0456 62.426V65.5744C75.0214 66.068 74.8267 66.5378 74.4947 66.9037L74.5297 66.9387ZM65.959 63.9827C65.9177 63.4729 65.705 62.992 65.3556 62.6184L62.2509 59.5487C61.8789 59.2141 61.4037 59.0166 60.9041 58.989H60.7904C60.293 59.0151 59.8201 59.2129 59.4523 59.5487L56.3476 62.6184C56.0144 62.994 55.8199 63.4724 55.7967 63.974V64.0877C55.8187 64.5817 56.0137 65.0522 56.3476 65.417L59.4698 68.4779C59.8384 68.8125 60.3108 69.0102 60.8079 69.0377H60.9216C61.4212 69.01 61.8964 68.8126 62.2684 68.4779L65.3731 65.3908C65.7084 65.0253 65.909 64.5564 65.9415 64.0614L65.959 63.9827ZM17.4299 32.0789L43.2381 46.8764C44.3936 47.5386 45.7023 47.8869 47.0341 47.8869C48.3659 47.8869 49.6746 47.5385 50.8301 46.8763C51.9857 46.2141 52.9479 45.2611 53.6212 44.1121C54.2946 42.963 54.6556 41.6578 54.6685 40.326V10.7048C54.6017 8.73493 53.7721 6.8681 52.355 5.49824C50.9379 4.12839 49.044 3.36266 47.073 3.36266C45.102 3.36266 43.2081 4.12839 41.791 5.49824C40.3738 6.8681 39.5443 8.73493 39.4775 10.7048V27.3213L25.0211 19.0131C24.1597 18.5146 23.2086 18.1907 22.222 18.0598C21.2355 17.929 20.2329 17.9937 19.2713 18.2503C18.3098 18.5069 17.4082 18.9504 16.6181 19.5555C15.828 20.1605 15.1648 20.9153 14.6663 21.7767C14.1679 22.638 13.844 23.5891 13.7131 24.5757C13.5822 25.5622 13.647 26.5649 13.9036 27.5264C14.1602 28.4879 14.6037 29.3895 15.2087 30.1796C15.8138 30.9697 16.5685 31.633 17.4299 32.1314V32.0789ZM74.0661 47.8909C75.5902 48.0114 77.1149 47.6668 78.4389 46.9026L104.238 32.0352C105.1 31.5368 105.854 30.8735 106.459 30.0834C107.065 29.2933 107.508 28.3917 107.765 27.4302C108.021 26.4687 108.086 25.466 107.955 24.4795C107.824 23.4929 107.5 22.5418 107.002 21.6805C106.503 20.8191 105.84 20.0643 105.05 19.4593C104.26 18.8542 103.358 18.4107 102.397 18.1541C100.455 17.6358 98.3868 17.9102 96.6472 18.9169L82.2083 27.2951V10.6785C82.1414 8.7087 81.3119 6.84186 79.8948 5.47201C78.4776 4.10215 76.5837 3.33643 74.6127 3.33643C72.6418 3.33643 70.7479 4.10215 69.3307 5.47201C67.9136 6.84186 67.0841 8.7087 67.0172 10.6785V40.326C67.0148 42.2454 67.7413 44.0942 69.0499 45.4985C70.3584 46.9028 72.1513 47.7579 74.0661 47.8909ZM47.6458 80.1095C46.1216 79.9857 44.5959 80.3305 43.273 81.0978L17.4299 95.904C15.6903 96.9107 14.4219 98.5671 13.9036 100.509C13.3853 102.451 13.6597 104.519 14.6663 106.259C15.673 107.998 17.3294 109.267 19.2713 109.785C21.2132 110.303 23.2815 110.029 25.0211 109.022L39.4775 100.723V117.339C39.5443 119.309 40.3738 121.176 41.791 122.546C43.2081 123.916 45.102 124.681 47.073 124.681C49.044 124.681 50.9379 123.916 52.355 122.546C53.7721 121.176 54.6017 119.309 54.6685 117.339V87.6395C54.6646 85.7297 53.9385 83.892 52.6359 82.4954C51.3333 81.0987 49.5507 80.2464 47.6458 80.1095ZM40.6494 66.2303C41.1476 64.5921 41.0725 62.8329 40.4365 61.243C39.8006 59.6532 38.6417 58.3275 37.1511 57.4848L11.3692 42.6261C9.62803 41.6287 7.56307 41.3605 5.62485 41.8799C3.68663 42.3993 2.03247 43.6641 1.02324 45.3984C0.523605 46.2567 0.199114 47.2056 0.0685393 48.1901C-0.0620352 49.1746 0.00389896 50.1753 0.262528 51.1342C0.521157 52.093 0.967347 52.9911 1.57529 53.7764C2.18323 54.5618 2.94085 55.2188 3.80433 55.7094L18.2083 64.009L3.80433 72.2385C2.94297 72.7353 2.18788 73.3968 1.58217 74.1853C0.976458 74.9738 0.531994 75.874 0.274153 76.8343C0.0163107 77.7946 -0.0498595 78.7963 0.0794199 79.7822C0.208699 80.768 0.530896 81.7188 1.02762 82.5802C1.52433 83.4415 2.18585 84.1966 2.97439 84.8023C3.76292 85.408 4.66304 85.8525 5.62335 86.1103C6.58366 86.3682 7.58535 86.4343 8.57123 86.3051C9.55711 86.1758 10.5079 85.8536 11.3692 85.3569L37.1511 70.4894C38.8114 69.5625 40.0584 68.0405 40.6406 66.2303H40.6494ZM122.114 17.0628H120.951V18.4883H122.106C122.639 18.4883 122.98 18.2435 122.98 17.7887C122.98 17.3339 122.665 17.0628 122.106 17.0628H122.114ZM119.543 15.751H122.167C123.584 15.751 124.528 16.5293 124.528 17.7362C124.533 18.0722 124.447 18.4032 124.281 18.6953C124.115 18.9874 123.874 19.2299 123.584 19.3979L124.607 20.8671V21.1645H123.129L122.106 19.7652H120.951V21.1645H119.534L119.543 15.751ZM126.802 18.567C126.844 17.905 126.749 17.2413 126.522 16.618C126.294 15.9947 125.94 15.4254 125.481 14.9461C125.023 14.4669 124.469 14.088 123.857 13.8337C123.244 13.5793 122.585 13.4549 121.922 13.4684C119.027 13.4684 117.103 15.5586 117.103 18.567C117.103 21.4356 119.027 23.657 121.922 23.657C122.585 23.6729 123.245 23.5505 123.859 23.2977C124.473 23.0449 125.027 22.6671 125.487 22.1883C125.947 21.7096 126.302 21.1404 126.53 20.517C126.758 19.8935 126.853 19.2295 126.811 18.567H126.802ZM128.009 18.567C128.009 21.9691 125.735 24.8114 121.887 24.8114C118.039 24.8114 115.861 21.9428 115.861 18.567C115.861 15.1913 118.109 12.3227 121.887 12.3227C125.665 12.3227 128 15.1563 128 18.567H128.009Z" fill="#29B5E8"/>\n</g>\n<defs>\n<clipPath id="clip0_58_7704">\n<rect width="128" height="121.703" fill="white" transform="translate(0 3.14844)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "stripe":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_794)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M54.5868 38.5631C54.5868 33.0774 59.0879 30.9675 66.5429 30.9675C77.233 30.9675 90.7363 34.2027 101.426 39.9697V6.91478C89.7516 2.27303 78.2176 0.444458 66.5429 0.444458C37.989 0.444458 19 15.3544 19 40.2511C19 79.073 72.4505 72.884 72.4505 89.6225C72.4505 96.0928 66.8242 98.2027 58.9473 98.2027C47.2725 98.2027 32.3626 93.4203 20.5473 86.95V120.427C33.6286 126.053 46.8505 128.444 58.9473 128.444C88.2044 128.444 108.319 113.957 108.319 88.7785C108.178 46.862 54.5868 54.317 54.5868 38.5631Z" fill="#635BFF"/>\n</g>\n<defs>\n<clipPath id="clip0_0_794">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "supabase":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_0_132)">\n<path d="M74.8244 125.802C71.5544 129.92 64.9243 127.664 64.8455 122.406L63.6934 45.501H115.404C124.77 45.501 129.994 56.3191 124.17 63.6545L74.8244 125.802Z" fill="url(#paint0_linear_0_132)"/>\n<path d="M74.8244 125.802C71.5544 129.92 64.9243 127.664 64.8455 122.406L63.6934 45.501H115.404C124.77 45.501 129.994 56.3191 124.17 63.6545L74.8244 125.802Z" fill="url(#paint1_linear_0_132)" fill-opacity="0.2"/>\n<path d="M53.7939 2.05576C57.0639 -2.06261 63.6942 0.193957 63.773 5.45206L64.2778 82.3569H13.2142C3.84765 82.3569 -1.37622 71.5389 4.44815 64.2035L53.7939 2.05576Z" fill="#3ECF8E"/>\n</g>\n<defs>\n<linearGradient id="paint0_linear_0_132" x1="63.6934" y1="62.5528" x2="109.652" y2="81.8278" gradientUnits="userSpaceOnUse">\n<stop stop-color="#249361"/>\n<stop offset="1" stop-color="#3ECF8E"/>\n</linearGradient>\n<linearGradient id="paint1_linear_0_132" x1="43.3176" y1="34.6548" x2="64.2773" y2="74.1101" gradientUnits="userSpaceOnUse">\n<stop/>\n<stop offset="1" stop-opacity="0"/>\n</linearGradient>\n<clipPath id="clip0_0_132">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "teams":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_168_571)">\n<g clip-path="url(#clip1_168_571)">\n<path d="M89.6979 48.7828H122.761C125.884 48.7828 128.416 51.3149 128.416 54.4386V84.5543C128.416 96.0345 119.11 105.341 107.63 105.341H107.532C96.0514 105.343 86.7436 96.0374 86.7419 84.5572C86.7419 84.5563 86.7419 84.5553 86.7419 84.5542V51.7387C86.742 50.1062 88.0654 48.7828 89.6979 48.7828Z" fill="#5059C9"/>\n<path d="M112.045 42.8293C119.443 42.8293 125.44 36.832 125.44 29.4339C125.44 22.0359 119.443 16.0386 112.045 16.0386C104.646 16.0386 98.6492 22.0359 98.6492 29.4339C98.6492 36.832 104.646 42.8293 112.045 42.8293Z" fill="#5059C9"/>\n<path d="M70.3701 42.8293C81.0562 42.8293 89.719 34.1666 89.719 23.4805C89.719 12.7944 81.0562 4.13162 70.3701 4.13162C59.684 4.13162 51.0212 12.7944 51.0212 23.4805C51.0212 34.1666 59.684 42.8293 70.3701 42.8293Z" fill="#7B83EB"/>\n<path d="M96.1695 48.7828H41.5938C38.5074 48.8592 36.0658 51.4206 36.1374 54.5071V88.8558C35.7064 107.378 50.3602 122.748 68.8817 123.201C87.4031 122.748 102.057 107.378 101.626 88.8558V54.5071C101.697 51.4206 99.2559 48.8592 96.1695 48.7828Z" fill="#7B83EB"/>\n<path opacity="0.1" d="M71.8583 48.7828V96.9167C71.8435 99.124 70.5059 101.107 68.4648 101.947C67.8149 102.222 67.1165 102.364 66.4108 102.364H38.7568C38.3699 101.382 38.0127 100.4 37.715 99.3875C36.673 95.9717 36.1413 92.4209 36.1373 88.8498V54.4981C36.0657 51.4165 38.5032 48.8592 41.5847 48.7828H71.8583Z" fill="black"/>\n<path opacity="0.2" d="M68.8815 48.7828V99.8935C68.8814 100.599 68.7397 101.298 68.4648 101.947C67.6244 103.989 65.6414 105.326 63.4341 105.341H40.1559C39.6499 104.359 39.1736 103.376 38.7568 102.364C38.3401 101.352 38.0127 100.4 37.715 99.3875C36.673 95.9718 36.1413 92.4209 36.1373 88.8498V54.4981C36.0657 51.4165 38.5032 48.8592 41.5847 48.7828H68.8815Z" fill="black"/>\n<path opacity="0.2" d="M68.8817 48.7828V93.94C68.859 96.9391 66.4334 99.3648 63.4343 99.3875H37.7152C36.6732 95.9718 36.1415 92.4209 36.1375 88.8498V54.4981C36.066 51.4165 38.5035 48.8592 41.585 48.7828H68.8817Z" fill="black"/>\n<path opacity="0.2" d="M65.9049 48.7828V93.94C65.8823 96.9391 63.4566 99.3648 60.4575 99.3875H37.7152C36.6732 95.9718 36.1415 92.4209 36.1375 88.8498V54.4981C36.066 51.4165 38.5035 48.8592 41.585 48.7828H65.9049Z" fill="black"/>\n<path opacity="0.1" d="M71.8583 33.393V42.7698C71.3523 42.7995 70.876 42.8293 70.3699 42.8293C69.8639 42.8293 69.3876 42.7996 68.8815 42.7698C67.8768 42.7031 66.8802 42.5437 65.9048 42.2935C59.8769 40.866 54.8969 36.6385 52.5095 30.9224C52.0987 29.9624 51.7798 28.9657 51.5569 27.9456H66.4108C69.4147 27.957 71.8469 30.3892 71.8583 33.393Z" fill="black"/>\n<path opacity="0.2" d="M68.8816 36.3698V42.7698C67.8768 42.7031 66.8803 42.5437 65.9049 42.2935C59.8769 40.866 54.8969 36.6385 52.5095 30.9224H63.4342C66.4379 30.9338 68.8702 33.366 68.8816 36.3698Z" fill="black"/>\n<path opacity="0.2" d="M68.8816 36.3698V42.7698C67.8768 42.7031 66.8803 42.5437 65.9049 42.2935C59.8769 40.866 54.8969 36.6385 52.5095 30.9224H63.4342C66.4379 30.9338 68.8702 33.366 68.8816 36.3698Z" fill="black"/>\n<path opacity="0.2" d="M65.9049 36.3698V42.2935C59.8769 40.866 54.8969 36.6385 52.5095 30.9223H60.4574C63.4613 30.9338 65.8934 33.366 65.9049 36.3698Z" fill="black"/>\n<path d="M5.87285 30.9223H60.4485C63.4619 30.9223 65.9048 33.3653 65.9048 36.3787V90.9543C65.9048 93.9678 63.4619 96.4106 60.4485 96.4106H5.87285C2.85937 96.4106 0.416504 93.9677 0.416504 90.9543V36.3787C0.416504 33.3653 2.85943 30.9223 5.87285 30.9223Z" fill="url(#paint0_linear_168_571)"/>\n<path d="M47.5204 51.694H36.6106V81.402H29.6599V51.694H18.8008V45.9311H47.5204V51.694Z" fill="white"/>\n</g>\n</g>\n<defs>\n<linearGradient id="paint0_linear_168_571" x1="11.7932" y1="26.6588" x2="54.5282" y2="100.674" gradientUnits="userSpaceOnUse">\n<stop stop-color="#5A62C3"/>\n<stop offset="0.5" stop-color="#4D55BD"/>\n<stop offset="1" stop-color="#3940AB"/>\n</linearGradient>\n<clipPath id="clip0_168_571">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_168_571">\n<rect width="128" height="119.07" fill="white" transform="translate(0.416504 4.13162)"/>\n</clipPath>\n</defs>\n</svg>\n',
  "trello":
    '<svg width="128" height="128" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">\n<g clip-path="url(#clip0_240_7025)">\n<g clip-path="url(#clip1_240_7025)">\n<path fill-rule="evenodd" clip-rule="evenodd" d="M112.867 0H15.133C6.72578 0 0 6.72578 0 15.133V112.657C0 121.064 6.72578 127.79 15.133 127.79H112.657C121.064 127.79 127.79 121.064 127.79 112.657V15.3432C128 6.72578 121.274 0 112.867 0ZM55.0673 92.2693C55.0673 95.0016 52.7553 97.3136 50.023 97.3136H28.7947C26.0624 97.3136 23.7504 95.0016 23.7504 92.2693V28.7947C23.7504 26.0624 26.0624 23.7504 28.7947 23.7504H50.2332C52.9655 23.7504 55.2775 26.0624 55.2775 28.7947V92.2693H55.0673ZM104.46 63.0542C104.46 65.7865 102.358 68.0985 99.4154 68.3087C99.4154 68.3087 99.4154 68.3087 99.2053 68.3087H77.977C75.2447 68.3087 72.9327 65.9967 72.9327 63.2644V28.7947C72.9327 26.0624 75.2447 23.7504 77.977 23.7504H99.4154C102.148 23.7504 104.46 26.0624 104.46 28.7947V63.0542Z" fill="url(#paint0_linear_240_7025)"/>\n</g>\n</g>\n<defs>\n<linearGradient id="paint0_linear_240_7025" x1="64.042" y1="128.084" x2="64.042" y2="0" gradientUnits="userSpaceOnUse">\n<stop stop-color="#0052CC"/>\n<stop offset="1" stop-color="#2684FF"/>\n</linearGradient>\n<clipPath id="clip0_240_7025">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n<clipPath id="clip1_240_7025">\n<rect width="128" height="128" fill="white"/>\n</clipPath>\n</defs>\n</svg>\n',
  "twilio":
    '<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Twilio</title><path d="M12 0C5.381-.008.008 5.352 0 11.971V12c0 6.64 5.359 12 12 12 6.64 0 12-5.36 12-12 0-6.641-5.36-12-12-12zm0 20.801c-4.846.015-8.786-3.904-8.801-8.75V12c-.014-4.846 3.904-8.786 8.75-8.801H12c4.847-.014 8.786 3.904 8.801 8.75V12c.015 4.847-3.904 8.786-8.75 8.801H12zm5.44-11.76c0 1.359-1.12 2.479-2.481 2.479-1.366-.007-2.472-1.113-2.479-2.479 0-1.361 1.12-2.481 2.479-2.481 1.361 0 2.481 1.12 2.481 2.481zm0 5.919c0 1.36-1.12 2.48-2.481 2.48-1.367-.008-2.473-1.114-2.479-2.48 0-1.359 1.12-2.479 2.479-2.479 1.361-.001 2.481 1.12 2.481 2.479zm-5.919 0c0 1.36-1.12 2.48-2.479 2.48-1.368-.007-2.475-1.113-2.481-2.48 0-1.359 1.12-2.479 2.481-2.479 1.358-.001 2.479 1.12 2.479 2.479zm0-5.919c0 1.359-1.12 2.479-2.479 2.479-1.367-.007-2.475-1.112-2.481-2.479 0-1.361 1.12-2.481 2.481-2.481 1.358 0 2.479 1.12 2.479 2.481z"/></svg>',
};
