import { getAccessToken, getInstanceUrl } from "./token-store.ts";

// Salesforce REST API version
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

async function salesforceFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  const instanceUrl = getInstanceUrl();

  if (!token) {
    throw new Error("Not authenticated with Salesforce. Please connect your account.");
  }

  if (!instanceUrl) {
    throw new Error("Salesforce instance URL not found. Please reconnect your account.");
  }

  const url = endpoint.startsWith("http")
    ? endpoint
    : `${instanceUrl}/services/data/${API_VERSION}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Salesforce API error: ${response.status} ${
        error[0]?.message || error.message || response.statusText
      }`,
    );
  }

  return response.json();
}

// ============================================================================
// SOQL QUERY
// ============================================================================

export function query<T = any>(soql: string): Promise<SalesforceQueryResponse<T>> {
  const encodedQuery = encodeURIComponent(soql);
  return salesforceFetch<SalesforceQueryResponse<T>>(`/query?q=${encodedQuery}`);
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export function listAccounts(options?: {
  limit?: number;
  offset?: number;
  fields?: string[];
}): Promise<SalesforceQueryResponse<SalesforceAccount>> {
  const limit = options?.limit || 10;
  const offset = options?.offset || 0;
  const fields = options?.fields || [
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

  const soql = `SELECT ${
    fields.join(", ")
  } FROM Account ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;
  return query<SalesforceAccount>(soql);
}

export async function getAccount(
  accountId: string,
  fields?: string[],
): Promise<SalesforceAccount> {
  const selectedFields = fields || [
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

  const soql = `SELECT ${selectedFields.join(", ")} FROM Account WHERE Id = '${accountId}'`;
  const result = await query<SalesforceAccount>(soql);

  if (result.totalSize === 0) {
    throw new Error(`Account with ID ${accountId} not found`);
  }

  return result.records[0];
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
  const limit = options?.limit || 10;
  const offset = options?.offset || 0;
  const fields = options?.fields || [
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

  let soql = `SELECT ${fields.join(", ")} FROM Contact`;

  if (options?.accountId) {
    soql += ` WHERE AccountId = '${options.accountId}'`;
  }

  soql += ` ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;

  return query<SalesforceContact>(soql);
}

export async function getContact(
  contactId: string,
  fields?: string[],
): Promise<SalesforceContact> {
  const selectedFields = fields || [
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

  const soql = `SELECT ${selectedFields.join(", ")} FROM Contact WHERE Id = '${contactId}'`;
  const result = await query<SalesforceContact>(soql);

  if (result.totalSize === 0) {
    throw new Error(`Contact with ID ${contactId} not found`);
  }

  return result.records[0];
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
  const limit = options?.limit || 10;
  const offset = options?.offset || 0;
  const fields = options?.fields || [
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

  let soql = `SELECT ${fields.join(", ")} FROM Opportunity`;

  if (options?.accountId) {
    soql += ` WHERE AccountId = '${options.accountId}'`;
  }

  soql += ` ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;

  return query<SalesforceOpportunity>(soql);
}

export async function getOpportunity(
  opportunityId: string,
  fields?: string[],
): Promise<SalesforceOpportunity> {
  const selectedFields = fields || [
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

  const soql = `SELECT ${selectedFields.join(", ")} FROM Opportunity WHERE Id = '${opportunityId}'`;
  const result = await query<SalesforceOpportunity>(soql);

  if (result.totalSize === 0) {
    throw new Error(`Opportunity with ID ${opportunityId} not found`);
  }

  return result.records[0];
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
  const limit = options?.limit || 10;
  const offset = options?.offset || 0;
  const fields = options?.fields || [
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

  let soql = `SELECT ${fields.join(", ")} FROM Lead`;

  if (options?.status) {
    soql += ` WHERE Status = '${options.status}'`;
  }

  soql += ` ORDER BY LastModifiedDate DESC LIMIT ${limit} OFFSET ${offset}`;

  return query<SalesforceLead>(soql);
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
  // Set default status if not provided
  const leadData = {
    ...data,
    Status: data.Status || "Open - Not Contacted",
  };

  return salesforceFetch("/sobjects/Lead", {
    method: "POST",
    body: JSON.stringify(leadData),
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function formatContactName(contact: SalesforceContact): string {
  const parts = [];
  if (contact.FirstName) parts.push(contact.FirstName);
  if (contact.LastName) parts.push(contact.LastName);
  return parts.length > 0 ? parts.join(" ") : contact.Email || "Unnamed Contact";
}

export function formatLeadName(lead: SalesforceLead): string {
  const parts = [];
  if (lead.FirstName) parts.push(lead.FirstName);
  if (lead.LastName) parts.push(lead.LastName);
  return parts.length > 0 ? parts.join(" ") : lead.Email || "Unnamed Lead";
}

export function formatAddress(
  street?: string,
  city?: string,
  state?: string,
  postalCode?: string,
  country?: string,
): string {
  const parts = [];
  if (street) parts.push(street);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (postalCode) parts.push(postalCode);
  if (country) parts.push(country);
  return parts.join(", ");
}

export type {
  SalesforceAccount,
  SalesforceContact,
  SalesforceLead,
  SalesforceOpportunity,
  SalesforceQueryResponse,
};
