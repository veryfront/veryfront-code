import { getAccessToken } from "./token-store.ts";

const XERO_BASE_URL = "https://api.xero.com/api.xro/2.0";

interface XeroResponse<T> {
  Id: string;
  Status: string;
  ProviderName: string;
  DateTimeUTC: string;
  [key: string]: T | string;
}

interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Type: "ACCREC" | "ACCPAY";
  Status: string;
  LineAmountTypes: string;
  Contact: {
    ContactID: string;
    Name: string;
  };
  LineItems: Array<{
    LineItemID?: string;
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode?: string;
    TaxType?: string;
    LineAmount: number;
  }>;
  Date: string;
  DueDate: string;
  SubTotal: number;
  TotalTax: number;
  Total: number;
  AmountDue: number;
  AmountPaid: number;
  CurrencyCode: string;
  Reference?: string;
  UpdatedDateUTC: string;
}

interface XeroContact {
  ContactID: string;
  ContactNumber?: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Addresses?: Array<{
    AddressType: string;
    City?: string;
    Region?: string;
    PostalCode?: string;
    Country?: string;
    AttentionTo?: string;
  }>;
  Phones?: Array<{
    PhoneType: string;
    PhoneNumber?: string;
    PhoneAreaCode?: string;
    PhoneCountryCode?: string;
  }>;
  UpdatedDateUTC: string;
  IsSupplier: boolean;
  IsCustomer: boolean;
}

interface XeroTenant {
  tenantId: string;
  tenantType: string;
  tenantName: string;
}

async function requireAccessToken(): Promise<string> {
  const token = await getAccessToken();
  if (!token) throw new Error("Not authenticated with Xero. Please connect your account.");
  return token;
}

async function getTenantId(token: string): Promise<string> {
  const response = await fetch("https://api.xero.com/connections", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) throw new Error(`Failed to get Xero tenants: ${response.status}`);

  const tenants: XeroTenant[] = await response.json();
  const tenantId = tenants[0]?.tenantId;

  if (!tenantId) {
    throw new Error("No Xero organizations found. Please connect to a Xero organization.");
  }

  return tenantId;
}

function getCollection<T extends Record<string, unknown>, K extends keyof T>(
  response: XeroResponse<T>,
  key: K,
): T[K] {
  return response[key] as T[K];
}

async function xeroFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = await requireAccessToken();
  const tenantId = await getTenantId(token);

  const response = await fetch(`${XERO_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      Message?: string;
      Detail?: string;
    };

    const message = error.Message ?? error.Detail ?? response.statusText;
    throw new Error(`Xero API error: ${response.status} ${message}`);
  }

  return response.json();
}

export async function listInvoices(options?: {
  status?: "DRAFT" | "SUBMITTED" | "AUTHORISED" | "PAID" | "VOIDED";
  type?: "ACCREC" | "ACCPAY";
  contactId?: string;
  limit?: number;
}): Promise<XeroInvoice[]> {
  const params = new URLSearchParams();
  const where: string[] = [];

  if (options?.status) where.push(`Status == "${options.status}"`);
  if (options?.type) where.push(`Type == "${options.type}"`);
  if (options?.contactId) where.push(`Contact.ContactID == Guid("${options.contactId}")`);

  if (where.length) params.set("where", where.join(" AND "));
  if (options?.limit) params.set("page", "1");

  const queryString = params.toString();
  const endpoint = `/Invoices${queryString ? `?${queryString}` : ""}`;

  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>(endpoint);
  const invoices = (getCollection(response, "Invoices") as XeroInvoice[] | undefined) ?? [];

  return options?.limit ? invoices.slice(0, options.limit) : invoices;
}

export async function getInvoice(invoiceId: string): Promise<XeroInvoice> {
  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>(
    `/Invoices/${invoiceId}`,
  );

  const invoices = getCollection(response, "Invoices") as XeroInvoice[] | undefined;
  const invoice = invoices?.[0];

  if (!invoice) throw new Error(`Invoice not found: ${invoiceId}`);
  return invoice;
}

export async function createInvoice(options: {
  contactId: string;
  type: "ACCREC" | "ACCPAY";
  date: string;
  dueDate: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    accountCode?: string;
    taxType?: string;
  }>;
  reference?: string;
  status?: "DRAFT" | "SUBMITTED" | "AUTHORISED";
}): Promise<XeroInvoice> {
  const invoice = {
    Type: options.type,
    Contact: { ContactID: options.contactId },
    Date: options.date,
    DueDate: options.dueDate,
    LineItems: options.lineItems.map((item) => ({
      Description: item.description,
      Quantity: item.quantity,
      UnitAmount: item.unitAmount,
      AccountCode: item.accountCode,
      TaxType: item.taxType ?? "NONE",
    })),
    Reference: options.reference,
    Status: options.status ?? "DRAFT",
    LineAmountTypes: "Exclusive",
  };

  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>("/Invoices", {
    method: "POST",
    body: JSON.stringify({ Invoices: [invoice] }),
  });

  const invoices = getCollection(response, "Invoices") as XeroInvoice[] | undefined;
  const created = invoices?.[0];

  if (!created) throw new Error("Failed to create invoice");
  return created;
}

export async function listContacts(options?: {
  isCustomer?: boolean;
  isSupplier?: boolean;
  limit?: number;
}): Promise<XeroContact[]> {
  const params = new URLSearchParams();
  const where: string[] = [];

  if (options?.isCustomer !== undefined) where.push(`IsCustomer == ${options.isCustomer}`);
  if (options?.isSupplier !== undefined) where.push(`IsSupplier == ${options.isSupplier}`);

  if (where.length) params.set("where", where.join(" AND "));

  const queryString = params.toString();
  const endpoint = `/Contacts${queryString ? `?${queryString}` : ""}`;

  const response = await xeroFetch<XeroResponse<{ Contacts: XeroContact[] }>>(endpoint);
  const contacts = (getCollection(response, "Contacts") as XeroContact[] | undefined) ?? [];

  return options?.limit ? contacts.slice(0, options.limit) : contacts;
}

export async function getContact(contactId: string): Promise<XeroContact> {
  const response = await xeroFetch<XeroResponse<{ Contacts: XeroContact[] }>>(
    `/Contacts/${contactId}`,
  );

  const contacts = getCollection(response, "Contacts") as XeroContact[] | undefined;
  const contact = contacts?.[0];

  if (!contact) throw new Error(`Contact not found: ${contactId}`);
  return contact;
}

export async function getCurrentUser(): Promise<{
  userId: string;
  userName: string;
  email: string;
}> {
  const token = await requireAccessToken();

  const response = await fetch(`${XERO_BASE_URL}/Organisation`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) throw new Error(`Failed to get user info: ${response.status}`);

  const data: { Organisations: Array<{ Name: string }> } = await response.json();

  return {
    userId: "current-user",
    userName: data.Organisations[0]?.Name ?? "Xero User",
    email: "user@xero.com",
  };
}
