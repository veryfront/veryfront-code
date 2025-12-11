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

async function xeroFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Xero. Please connect your account.");
  }

  const tenantsResponse = await fetch("https://api.xero.com/connections", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!tenantsResponse.ok) {
    throw new Error(`Failed to get Xero tenants: ${tenantsResponse.status}`);
  }

  const tenants = (await tenantsResponse.json()) as XeroTenant[];
  if (tenants.length === 0) {
    throw new Error("No Xero organizations found. Please connect to a Xero organization.");
  }

  const tenantId = tenants[0].tenantId;

  const response = await fetch(`${XERO_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Xero API error: ${response.status} ${error.Message || error.Detail || response.statusText}`,
    );
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

  let where: string[] = [];
  if (options?.status) {
    where.push(`Status == "${options.status}"`);
  }
  if (options?.type) {
    where.push(`Type == "${options.type}"`);
  }
  if (options?.contactId) {
    where.push(`Contact.ContactID == Guid("${options.contactId}")`);
  }

  if (where.length > 0) {
    params.set("where", where.join(" AND "));
  }

  if (options?.limit) {
    params.set("page", "1");
  }

  const queryString = params.toString();
  const endpoint = `/Invoices${queryString ? `?${queryString}` : ""}`;

  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>(endpoint);
  const invoices = (response as unknown as { Invoices: XeroInvoice[] }).Invoices || [];

  return options?.limit ? invoices.slice(0, options.limit) : invoices;
}

export async function getInvoice(invoiceId: string): Promise<XeroInvoice> {
  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>(
    `/Invoices/${invoiceId}`,
  );
  const invoices = (response as unknown as { Invoices: XeroInvoice[] }).Invoices;

  if (!invoices || invoices.length === 0) {
    throw new Error(`Invoice not found: ${invoiceId}`);
  }

  return invoices[0];
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
    Contact: {
      ContactID: options.contactId,
    },
    Date: options.date,
    DueDate: options.dueDate,
    LineItems: options.lineItems.map((item) => ({
      Description: item.description,
      Quantity: item.quantity,
      UnitAmount: item.unitAmount,
      AccountCode: item.accountCode,
      TaxType: item.taxType || "NONE",
    })),
    Reference: options.reference,
    Status: options.status || "DRAFT",
    LineAmountTypes: "Exclusive",
  };

  const response = await xeroFetch<XeroResponse<{ Invoices: XeroInvoice[] }>>(
    "/Invoices",
    {
      method: "POST",
      body: JSON.stringify({ Invoices: [invoice] }),
    },
  );

  const invoices = (response as unknown as { Invoices: XeroInvoice[] }).Invoices;
  if (!invoices || invoices.length === 0) {
    throw new Error("Failed to create invoice");
  }

  return invoices[0];
}

export async function listContacts(options?: {
  isCustomer?: boolean;
  isSupplier?: boolean;
  limit?: number;
}): Promise<XeroContact[]> {
  const params = new URLSearchParams();

  let where: string[] = [];
  if (options?.isCustomer !== undefined) {
    where.push(`IsCustomer == ${options.isCustomer}`);
  }
  if (options?.isSupplier !== undefined) {
    where.push(`IsSupplier == ${options.isSupplier}`);
  }

  if (where.length > 0) {
    params.set("where", where.join(" AND "));
  }

  const queryString = params.toString();
  const endpoint = `/Contacts${queryString ? `?${queryString}` : ""}`;

  const response = await xeroFetch<XeroResponse<{ Contacts: XeroContact[] }>>(endpoint);
  const contacts = (response as unknown as { Contacts: XeroContact[] }).Contacts || [];

  return options?.limit ? contacts.slice(0, options.limit) : contacts;
}

export async function getContact(contactId: string): Promise<XeroContact> {
  const response = await xeroFetch<XeroResponse<{ Contacts: XeroContact[] }>>(
    `/Contacts/${contactId}`,
  );
  const contacts = (response as unknown as { Contacts: XeroContact[] }).Contacts;

  if (!contacts || contacts.length === 0) {
    throw new Error(`Contact not found: ${contactId}`);
  }

  return contacts[0];
}

export async function getCurrentUser(): Promise<{
  userId: string;
  userName: string;
  email: string;
}> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with Xero. Please connect your account.");
  }

  const response = await fetch("https://api.xero.com/api.xro/2.0/Organisation", {
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  const data = (await response.json()) as { Organisations: Array<{ Name: string }> };
  return {
    userId: "current-user",
    userName: data.Organisations[0]?.Name || "Xero User",
    email: "user@xero.com",
  };
}
