import { getAccessToken, getInstanceUrl } from "./token-store.ts";

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

async function salesforceFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Salesforce. Please connect your account.");
  }

  const instanceUrl = getInstanceUrl();
  if (!instanceUrl) {
    throw new Error("Salesforce instance URL not found. Please reconnect your account.");
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
    const error = await response.json().catch(() => ({} as any));
    const message = error?.[0]?.message ?? error?.message ?? response.statusText;
    throw new Error(`Salesforce API error: ${response.status} ${message}`);
  }

  return response.json();
}

export function query<T = any>(soql: string): Promise<SalesforceQueryResponse<T>> {
  return salesforceFetch<SalesforceQueryResponse<T>>(`/query?q=${encodeURIComponent(soql)}`);
}

function buildListSoql(params: {
  object: string;
  fields: string[];
  where?: string;
  limit: number;
  offset: number;
}): string {
  const { object, fields, where, limit, offset } = params;
  let soql = `SELECT ${fields.join(", ")} FROM ${object}`;
  if (where) soql += ` WHERE ${where}`;
  soql += ` ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;
  return soql;
}

async function getSingleRecord<T>(params: {
  object: string;
  id: string;
  fields: string[];
  notFoundMessage: string;
}): Promise<T> {
  const { object, id, fields, notFoundMessage } = params;
  const soql = `SELECT ${fields.join(", ")} FROM ${object} WHERE Id = '${id}'`;
  const result = await query<T>(soql);

  if (result.totalSize === 0) throw new Error(notFoundMessage);
  return result.records[0];
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export function listAccounts(options?: {
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
    buildListSoql({ object: "Account", fields, limit, offset }),
  );
}

export function getAccount(accountId: string, fields?: string[]): Promise<SalesforceAccount> {
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

  return getSingleRecord<SalesforceAccount>({
    object: "Account",
    id: accountId,
    fields: selectedFields,
    notFoundMessage: `Account with ID ${accountId} not found`,
  });
}

export function createAccount(data: {
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
  return salesforceFetch("/sobjects/Account", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// CONTACTS
// ============================================================================

export function listContacts(options?: {
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

  const where = options?.accountId ? `AccountId = '${options.accountId}'` : undefined;

  return query<SalesforceContact>(
    buildListSoql({ object: "Contact", fields, where, limit, offset }),
  );
}

export function getContact(contactId: string, fields?: string[]): Promise<SalesforceContact> {
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

  return getSingleRecord<SalesforceContact>({
    object: "Contact",
    id: contactId,
    fields: selectedFields,
    notFoundMessage: `Contact with ID ${contactId} not found`,
  });
}

export function createContact(data: {
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
  return salesforceFetch("/sobjects/Contact", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// OPPORTUNITIES
// ============================================================================

export function listOpportunities(options?: {
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

  const where = options?.accountId ? `AccountId = '${options.accountId}'` : undefined;

  return query<SalesforceOpportunity>(
    buildListSoql({ object: "Opportunity", fields, where, limit, offset }),
  );
}

export function getOpportunity(
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

  return getSingleRecord<SalesforceOpportunity>({
    object: "Opportunity",
    id: opportunityId,
    fields: selectedFields,
    notFoundMessage: `Opportunity with ID ${opportunityId} not found`,
  });
}

export function createOpportunity(data: {
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
  return salesforceFetch("/sobjects/Opportunity", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// ============================================================================
// LEADS
// ============================================================================

export function listLeads(options?: {
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

  const where = options?.status ? `Status = '${options.status}'` : undefined;

  return query<SalesforceLead>(buildListSoql({ object: "Lead", fields, where, limit, offset }));
}

export function createLead(data: {
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
  const leadData = { ...data, Status: data.Status ?? "Open - Not Contacted" };

  return salesforceFetch("/sobjects/Lead", {
    method: "POST",
    body: JSON.stringify(leadData),
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function formatContactName(contact: SalesforceContact): string {
  const parts = [contact.FirstName, contact.LastName].filter(Boolean);
  return parts.length ? parts.join(" ") : contact.Email ?? "Unnamed Contact";
}

export function formatLeadName(lead: SalesforceLead): string {
  const parts = [lead.FirstName, lead.LastName].filter(Boolean);
  return parts.length ? parts.join(" ") : lead.Email ?? "Unnamed Lead";
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
