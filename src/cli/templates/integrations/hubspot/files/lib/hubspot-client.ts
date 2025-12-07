import { getAccessToken } from "./token-store.ts";

const HUBSPOT_BASE_URL = "https://api.hubapi.com";

interface HubSpotPagination {
  after?: string;
  next?: {
    after: string;
    link: string;
  };
}

interface HubSpotResponse<T> {
  results: T[];
  paging?: HubSpotPagination;
}

interface HubSpotContact {
  id: string;
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    website?: string;
    jobtitle?: string;
    createdate?: string;
    lastmodifieddate?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

interface HubSpotCompany {
  id: string;
  properties: {
    name?: string;
    domain?: string;
    city?: string;
    state?: string;
    country?: string;
    industry?: string;
    phone?: string;
    createdate?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

interface HubSpotDeal {
  id: string;
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
    createdate?: string;
    [key: string]: string | undefined;
  };
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

async function hubspotFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with HubSpot. Please connect your account.");
  }

  const response = await fetch(`${HUBSPOT_BASE_URL}${endpoint}`, {
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
      `HubSpot API error: ${response.status} ${error.message || response.statusText}`,
    );
  }

  return response.json();
}

// ============================================================================
// CONTACTS
// ============================================================================

export async function listContacts(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotResponse<HubSpotContact>> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.set("limit", options.limit.toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.properties && options.properties.length > 0) {
    options.properties.forEach((prop) => params.append("properties", prop));
  } else {
    // Default properties
    ["email", "firstname", "lastname", "phone", "company", "jobtitle"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/contacts${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotResponse<HubSpotContact>>(url);
}

export async function getContact(
  contactId: string,
  properties?: string[],
): Promise<HubSpotContact> {
  const params = new URLSearchParams();

  if (properties && properties.length > 0) {
    properties.forEach((prop) => params.append("properties", prop));
  } else {
    ["email", "firstname", "lastname", "phone", "company", "jobtitle", "website"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/contacts/${contactId}${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotContact>(url);
}

export async function createContact(properties: {
  email: string;
  firstname?: string;
  lastname?: string;
  phone?: string;
  company?: string;
  website?: string;
  jobtitle?: string;
  [key: string]: string | undefined;
}): Promise<HubSpotContact> {
  return hubspotFetch<HubSpotContact>("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

export async function updateContact(
  contactId: string,
  properties: {
    email?: string;
    firstname?: string;
    lastname?: string;
    phone?: string;
    company?: string;
    website?: string;
    jobtitle?: string;
    [key: string]: string | undefined;
  },
): Promise<HubSpotContact> {
  return hubspotFetch<HubSpotContact>(`/crm/v3/objects/contacts/${contactId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

export async function searchContacts(options: {
  query?: string;
  filterGroups?: Array<{
    filters: Array<{
      propertyName: string;
      operator: string;
      value: string;
    }>;
  }>;
  properties?: string[];
  limit?: number;
  after?: string;
}): Promise<HubSpotResponse<HubSpotContact>> {
  const body: Record<string, unknown> = {};

  if (options.filterGroups) {
    body.filterGroups = options.filterGroups;
  }

  if (options.properties && options.properties.length > 0) {
    body.properties = options.properties;
  } else {
    body.properties = ["email", "firstname", "lastname", "phone", "company", "jobtitle"];
  }

  if (options.limit) {
    body.limit = options.limit;
  }

  if (options.after) {
    body.after = options.after;
  }

  return hubspotFetch<HubSpotResponse<HubSpotContact>>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ============================================================================
// COMPANIES
// ============================================================================

export async function listCompanies(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotResponse<HubSpotCompany>> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.set("limit", options.limit.toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.properties && options.properties.length > 0) {
    options.properties.forEach((prop) => params.append("properties", prop));
  } else {
    ["name", "domain", "city", "state", "industry", "phone"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/companies${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotResponse<HubSpotCompany>>(url);
}

export async function getCompany(
  companyId: string,
  properties?: string[],
): Promise<HubSpotCompany> {
  const params = new URLSearchParams();

  if (properties && properties.length > 0) {
    properties.forEach((prop) => params.append("properties", prop));
  } else {
    ["name", "domain", "city", "state", "country", "industry", "phone"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/companies/${companyId}${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotCompany>(url);
}

export async function createCompany(properties: {
  name: string;
  domain?: string;
  city?: string;
  state?: string;
  country?: string;
  industry?: string;
  phone?: string;
  [key: string]: string | undefined;
}): Promise<HubSpotCompany> {
  return hubspotFetch<HubSpotCompany>("/crm/v3/objects/companies", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

// ============================================================================
// DEALS
// ============================================================================

export async function listDeals(options?: {
  limit?: number;
  after?: string;
  properties?: string[];
}): Promise<HubSpotResponse<HubSpotDeal>> {
  const params = new URLSearchParams();

  if (options?.limit) {
    params.set("limit", options.limit.toString());
  }
  if (options?.after) {
    params.set("after", options.after);
  }
  if (options?.properties && options.properties.length > 0) {
    options.properties.forEach((prop) => params.append("properties", prop));
  } else {
    ["dealname", "amount", "dealstage", "pipeline", "closedate"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/deals${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotResponse<HubSpotDeal>>(url);
}

export async function getDeal(
  dealId: string,
  properties?: string[],
): Promise<HubSpotDeal> {
  const params = new URLSearchParams();

  if (properties && properties.length > 0) {
    properties.forEach((prop) => params.append("properties", prop));
  } else {
    ["dealname", "amount", "dealstage", "pipeline", "closedate"].forEach(
      (prop) => params.append("properties", prop),
    );
  }

  const queryString = params.toString();
  const url = `/crm/v3/objects/deals/${dealId}${queryString ? `?${queryString}` : ""}`;

  return hubspotFetch<HubSpotDeal>(url);
}

export async function createDeal(properties: {
  dealname: string;
  amount?: string;
  dealstage?: string;
  pipeline?: string;
  closedate?: string;
  [key: string]: string | undefined;
}): Promise<HubSpotDeal> {
  return hubspotFetch<HubSpotDeal>("/crm/v3/objects/deals", {
    method: "POST",
    body: JSON.stringify({ properties }),
  });
}

export async function updateDeal(
  dealId: string,
  properties: {
    dealname?: string;
    amount?: string;
    dealstage?: string;
    pipeline?: string;
    closedate?: string;
    [key: string]: string | undefined;
  },
): Promise<HubSpotDeal> {
  return hubspotFetch<HubSpotDeal>(`/crm/v3/objects/deals/${dealId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function formatContactName(contact: HubSpotContact): string {
  const parts = [];
  if (contact.properties.firstname) parts.push(contact.properties.firstname);
  if (contact.properties.lastname) parts.push(contact.properties.lastname);
  return parts.length > 0 ? parts.join(" ") : contact.properties.email || "Unnamed Contact";
}

export function formatCompanyName(company: HubSpotCompany): string {
  return company.properties.name || company.properties.domain || "Unnamed Company";
}

export function formatDealName(deal: HubSpotDeal): string {
  return deal.properties.dealname || "Unnamed Deal";
}

export type { HubSpotCompany, HubSpotContact, HubSpotDeal, HubSpotResponse };
