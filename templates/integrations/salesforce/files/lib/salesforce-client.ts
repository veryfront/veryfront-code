import { salesforceConfig } from "veryfront/oauth";
import { getValidToken, type OAuthProvider } from "./oauth.ts";

function getEnv(key: string): string | undefined {
  // @ts-ignore - Deno global
  if (typeof Deno !== "undefined") return Deno.env.get(key);

  // @ts-ignore - process global
  if (typeof process !== "undefined" && process.env) return process.env[key];

  return undefined;
}

// The generic OAuthService does not support Salesforce, so tokens refresh
// through the base scaffold's getValidToken().
const salesforceOAuthProvider: OAuthProvider = {
  name: "salesforce",
  authorizationUrl: salesforceConfig.authorizationUrl,
  tokenUrl: salesforceConfig.tokenUrl,
  clientId: getEnv("SALESFORCE_CLIENT_ID") ?? "",
  clientSecret: getEnv("SALESFORCE_CLIENT_SECRET") ?? "",
  scopes: [...salesforceConfig.defaultScopes],
  callbackPath: "/api/auth/salesforce/callback",
};

/**
 * Your org's instance URL: SALESFORCE_INSTANCE_URL when set, otherwise the
 * REST URL the token's userinfo reports.
 */
async function getInstanceUrl(token: string): Promise<string | undefined> {
  const configured = getEnv("SALESFORCE_INSTANCE_URL");
  if (configured) return configured.replace(/\/$/, "");

  const response = await fetch("https://login.salesforce.com/services/oauth2/userinfo", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (!response.ok) return undefined;
  const info = (await response.json()) as { urls?: { rest?: string } };
  return info.urls?.rest ? new URL(info.urls.rest).origin : undefined;
}

const API_VERSION = "v59.0";

interface SalesforceQueryResponse<T> {
  totalSize: number;
  done: boolean;
  records: T[];
  nextRecordsUrl?: string;
}

interface SalesforceAccount {
  Id: string;
  Name: string;
  Type?: string;
  Industry?: string;
  Website?: string;
  Phone?: string;
  BillingStreet?: string;
  BillingCity?: string;
  BillingState?: string;
  BillingPostalCode?: string;
  BillingCountry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  Description?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  [key: string]: any;
}

interface SalesforceContact {
  Id: string;
  FirstName?: string;
  LastName: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Department?: string;
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  Description?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  [key: string]: any;
}

interface SalesforceOpportunity {
  Id: string;
  Name: string;
  AccountId?: string;
  Amount?: number;
  StageName: string;
  Probability?: number;
  CloseDate: string;
  Type?: string;
  LeadSource?: string;
  Description?: string;
  NextStep?: string;
  IsClosed: boolean;
  IsWon: boolean;
  ForecastCategory?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  [key: string]: any;
}

interface SalesforceLead {
  Id: string;
  FirstName?: string;
  LastName: string;
  Company: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Status: string;
  LeadSource?: string;
  Industry?: string;
  Street?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  Website?: string;
  Description?: string;
  Rating?: string;
  CreatedDate: string;
  LastModifiedDate: string;
  [key: string]: any;
}

/** Validate a Salesforce record ID (15 or 18 character alphanumeric). */
function validateSalesforceId(id: string, label: string): string {
  if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
    throw new Error(`Invalid ${label}: must be a 15 or 18 character Salesforce ID`);
  }
  return id;
}

/** Escape a string value for use in SOQL single-quoted literals. */
function escapeSoql(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/** Validate a SOQL field name. */
function validateFieldName(field: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(field)) {
    throw new Error(`Invalid SOQL field name: ${field}`);
  }
  return field;
}

async function salesforceFetch<T>(
  userId: string,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getValidToken(salesforceOAuthProvider, userId, "salesforce");
  if (!token) {
    throw new Error("Not authenticated with Salesforce. Please connect your account.");
  }

  const instanceUrl = await getInstanceUrl(token);
  if (!instanceUrl) {
    throw new Error("Salesforce instance URL not found. Please set SALESFORCE_INSTANCE_URL.");
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${instanceUrl}/services/data/${API_VERSION}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error?.[0]?.message ?? error?.message ?? response.statusText;
    throw new Error(`Salesforce API error: ${response.status} ${message}`);
  }

  return response.json();
}

export function query<T = any>(userId: string, soql: string): Promise<SalesforceQueryResponse<T>> {
  return salesforceFetch<SalesforceQueryResponse<T>>(
    userId,
    `/query?q=${encodeURIComponent(soql)}`,
  );
}

function buildListSoql(params: {
  object: string;
  fields: string[];
  where?: string;
  limit: number;
  offset: number;
}): string {
  const { object, fields, where, limit, offset } = params;

  fields.forEach((f) => validateFieldName(f));
  let soql = `SELECT ${fields.join(", ")} FROM ${object}`;
  if (where) soql += ` WHERE ${where}`;
  soql += ` ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;

  return soql;
}

async function getSingleRecord<T>(userId: string, params: {
  object: string;
  id: string;
  fields: string[];
  notFoundMessage: string;
}): Promise<T> {
  const { object, id, fields, notFoundMessage } = params;
  fields.forEach((f) => validateFieldName(f));
  validateSalesforceId(id, `${object} ID`);
  const soql = `SELECT ${fields.join(", ")} FROM ${object} WHERE Id = '${id}'`;
  const result = await query<T>(userId, soql);

  if (result.totalSize === 0) throw new Error(notFoundMessage);
  return result.records[0];
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export function listAccounts(userId: string, options?: {
  limit?: number;
  offset?: number;
  fields?: string[];
}): Promise<SalesforceQueryResponse<SalesforceAccount>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const fields = options?.fields ?? [
    "Id",
    "Name",
    "Type",
    "Industry",
    "Website",
    "Phone",
    "BillingCity",
    "BillingState",
    "BillingCountry",
    "NumberOfEmployees",
    "AnnualRevenue",
    "CreatedDate",
    "LastModifiedDate",
  ];

  return query<SalesforceAccount>(
    userId,
    buildListSoql({ object: "Account", fields, limit, offset }),
  );
}

export function getAccount(
  userId: string,
  accountId: string,
  fields?: string[],
): Promise<SalesforceAccount> {
  const selectedFields = fields ?? [
    "Id",
    "Name",
    "Type",
    "Industry",
    "Website",
    "Phone",
    "BillingStreet",
    "BillingCity",
    "BillingState",
    "BillingPostalCode",
    "BillingCountry",
    "NumberOfEmployees",
    "AnnualRevenue",
    "Description",
    "CreatedDate",
    "LastModifiedDate",
  ];

  return getSingleRecord<SalesforceAccount>(userId, {
    object: "Account",
    id: accountId,
    fields: selectedFields,
    notFoundMessage: `Account with ID ${accountId} not found`,
  });
}

export function createAccount(userId: string, data: {
  Name: string;
  Type?: string;
  Industry?: string;
  Website?: string;
  Phone?: string;
  BillingStreet?: string;
  BillingCity?: string;
  BillingState?: string;
  BillingPostalCode?: string;
  BillingCountry?: string;
  NumberOfEmployees?: number;
  AnnualRevenue?: number;
  Description?: string;
  [key: string]: any;
}): Promise<{ id: string; success: boolean; errors: any[] }> {
  return salesforceFetch(userId, "/sobjects/Account", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// CONTACTS
// ============================================================================

export function listContacts(userId: string, options?: {
  limit?: number;
  offset?: number;
  fields?: string[];
  accountId?: string;
}): Promise<SalesforceQueryResponse<SalesforceContact>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const fields = options?.fields ?? [
    "Id",
    "FirstName",
    "LastName",
    "Email",
    "Phone",
    "Title",
    "Department",
    "AccountId",
    "MailingCity",
    "MailingState",
    "MailingCountry",
    "CreatedDate",
    "LastModifiedDate",
  ];

  const where = options?.accountId
    ? (validateSalesforceId(options.accountId, "accountId"), `AccountId = '${options.accountId}'`)
    : undefined;

  return query<SalesforceContact>(
    userId,
    buildListSoql({ object: "Contact", fields, where, limit, offset }),
  );
}

export function getContact(
  userId: string,
  contactId: string,
  fields?: string[],
): Promise<SalesforceContact> {
  const selectedFields = fields ?? [
    "Id",
    "FirstName",
    "LastName",
    "Email",
    "Phone",
    "MobilePhone",
    "Title",
    "Department",
    "AccountId",
    "MailingStreet",
    "MailingCity",
    "MailingState",
    "MailingPostalCode",
    "MailingCountry",
    "Description",
    "CreatedDate",
    "LastModifiedDate",
  ];

  return getSingleRecord<SalesforceContact>(userId, {
    object: "Contact",
    id: contactId,
    fields: selectedFields,
    notFoundMessage: `Contact with ID ${contactId} not found`,
  });
}

export function createContact(userId: string, data: {
  LastName: string;
  FirstName?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Department?: string;
  AccountId?: string;
  MailingStreet?: string;
  MailingCity?: string;
  MailingState?: string;
  MailingPostalCode?: string;
  MailingCountry?: string;
  Description?: string;
  [key: string]: any;
}): Promise<{ id: string; success: boolean; errors: any[] }> {
  return salesforceFetch(userId, "/sobjects/Contact", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// OPPORTUNITIES
// ============================================================================

export function listOpportunities(userId: string, options?: {
  limit?: number;
  offset?: number;
  fields?: string[];
  accountId?: string;
}): Promise<SalesforceQueryResponse<SalesforceOpportunity>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const fields = options?.fields ?? [
    "Id",
    "Name",
    "AccountId",
    "Amount",
    "StageName",
    "Probability",
    "CloseDate",
    "Type",
    "LeadSource",
    "IsClosed",
    "IsWon",
    "ForecastCategory",
    "CreatedDate",
    "LastModifiedDate",
  ];

  const where = options?.accountId
    ? (validateSalesforceId(options.accountId, "accountId"), `AccountId = '${options.accountId}'`)
    : undefined;

  return query<SalesforceOpportunity>(
    userId,
    buildListSoql({ object: "Opportunity", fields, where, limit, offset }),
  );
}

export function getOpportunity(
  userId: string,
  opportunityId: string,
  fields?: string[],
): Promise<SalesforceOpportunity> {
  const selectedFields = fields ?? [
    "Id",
    "Name",
    "AccountId",
    "Amount",
    "StageName",
    "Probability",
    "CloseDate",
    "Type",
    "LeadSource",
    "Description",
    "NextStep",
    "IsClosed",
    "IsWon",
    "ForecastCategory",
    "CreatedDate",
    "LastModifiedDate",
  ];

  return getSingleRecord<SalesforceOpportunity>(userId, {
    object: "Opportunity",
    id: opportunityId,
    fields: selectedFields,
    notFoundMessage: `Opportunity with ID ${opportunityId} not found`,
  });
}

export function createOpportunity(userId: string, data: {
  Name: string;
  StageName: string;
  CloseDate: string;
  AccountId?: string;
  Amount?: number;
  Probability?: number;
  Type?: string;
  LeadSource?: string;
  Description?: string;
  NextStep?: string;
  [key: string]: any;
}): Promise<{ id: string; success: boolean; errors: any[] }> {
  return salesforceFetch(userId, "/sobjects/Opportunity", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// LEADS
// ============================================================================

export function listLeads(userId: string, options?: {
  limit?: number;
  offset?: number;
  fields?: string[];
  status?: string;
}): Promise<SalesforceQueryResponse<SalesforceLead>> {
  const limit = options?.limit ?? 10;
  const offset = options?.offset ?? 0;
  const fields = options?.fields ?? [
    "Id",
    "FirstName",
    "LastName",
    "Company",
    "Email",
    "Phone",
    "Title",
    "Status",
    "LeadSource",
    "Industry",
    "City",
    "State",
    "Country",
    "Rating",
    "CreatedDate",
    "LastModifiedDate",
  ];

  const where = options?.status ? `Status = '${escapeSoql(options.status)}'` : undefined;

  return query<SalesforceLead>(
    userId,
    buildListSoql({ object: "Lead", fields, where, limit, offset }),
  );
}

export function createLead(userId: string, data: {
  LastName: string;
  Company: string;
  FirstName?: string;
  Email?: string;
  Phone?: string;
  MobilePhone?: string;
  Title?: string;
  Status?: string;
  LeadSource?: string;
  Industry?: string;
  Street?: string;
  City?: string;
  State?: string;
  PostalCode?: string;
  Country?: string;
  Website?: string;
  Description?: string;
  Rating?: string;
  [key: string]: any;
}): Promise<{ id: string; success: boolean; errors: any[] }> {
  return salesforceFetch(userId, "/sobjects/Lead", {
    method: "POST",
    body: JSON.stringify({ ...data, Status: data.Status ?? "Open - Not Contacted" }),
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function formatPersonName(firstName?: string, lastName?: string, email?: string, fallback = "Unnamed"): string {
  const parts = [firstName, lastName].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return email ?? fallback;
}

export function formatContactName(contact: SalesforceContact): string {
  return formatPersonName(contact.FirstName, contact.LastName, contact.Email, "Unnamed Contact");
}

export function formatLeadName(lead: SalesforceLead): string {
  return formatPersonName(lead.FirstName, lead.LastName, lead.Email, "Unnamed Lead");
}

export function formatAddress(
  street?: string,
  city?: string,
  state?: string,
  postalCode?: string,
  country?: string,
): string {
  return [street, city, state, postalCode, country].filter(Boolean).join(", ");
}

export type {
  SalesforceAccount,
  SalesforceContact,
  SalesforceLead,
  SalesforceOpportunity,
  SalesforceQueryResponse,
};
