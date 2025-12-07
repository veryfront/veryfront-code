import { getAccessToken } from "./token-store.ts";

const QUICKBOOKS_BASE_URL = "https://quickbooks.api.intuit.com/v3";

// Note: QuickBooks requires a realmId (company ID) which should be stored during OAuth
// For this template, we'll use an environment variable or parameter
const getRealmId = (): string => {
  const realmId = process.env.QUICKBOOKS_REALM_ID;
  if (!realmId) {
    throw new Error("QUICKBOOKS_REALM_ID environment variable is required");
  }
  return realmId;
};

interface QuickBooksResponse<T> {
  QueryResponse?: {
    [key: string]: T[];
    maxResults?: number;
    startPosition?: number;
  };
  Invoice?: T;
  Customer?: T;
  time?: string;
}

interface QuickBooksInvoice {
  Id: string;
  DocNumber: string;
  TxnDate: string;
  DueDate?: string;
  TotalAmt: number;
  Balance: number;
  CustomerRef: {
    value: string;
    name: string;
  };
  Line: Array<{
    Id: string;
    LineNum: number;
    Description?: string;
    Amount: number;
    DetailType: string;
    SalesItemLineDetail?: {
      ItemRef: {
        value: string;
        name: string;
      };
      Qty?: number;
      UnitPrice?: number;
    };
  }>;
  EmailStatus?: string;
  BillEmail?: {
    Address: string;
  };
  TxnStatus?: string;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

interface QuickBooksCustomer {
  Id: string;
  DisplayName: string;
  CompanyName?: string;
  GivenName?: string;
  FamilyName?: string;
  PrimaryEmailAddr?: {
    Address: string;
  };
  PrimaryPhone?: {
    FreeFormNumber: string;
  };
  BillAddr?: {
    Line1?: string;
    City?: string;
    CountrySubDivisionCode?: string;
    PostalCode?: string;
  };
  Balance: number;
  Active: boolean;
  MetaData?: {
    CreateTime: string;
    LastUpdatedTime: string;
  };
}

async function quickbooksFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error("Not authenticated with QuickBooks. Please connect your account.");
  }

  const realmId = getRealmId();
  const url = `${QUICKBOOKS_BASE_URL}/company/${realmId}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `QuickBooks API error: ${response.status} ${error.Fault?.Error?.[0]?.Message || response.statusText}`,
    );
  }

  return response.json();
}

export async function listInvoices(options?: {
  customerId?: string;
  maxResults?: number;
}): Promise<QuickBooksInvoice[]> {
  const maxResults = options?.maxResults || 100;
  let query = `SELECT * FROM Invoice MAXRESULTS ${maxResults}`;

  if (options?.customerId) {
    query = `SELECT * FROM Invoice WHERE CustomerRef = '${options.customerId}' MAXRESULTS ${maxResults}`;
  }

  const response = await quickbooksFetch<QuickBooksResponse<QuickBooksInvoice>>(
    `/query?query=${encodeURIComponent(query)}`,
  );

  return response.QueryResponse?.Invoice || [];
}

export async function getInvoice(invoiceId: string): Promise<QuickBooksInvoice> {
  const response = await quickbooksFetch<QuickBooksResponse<QuickBooksInvoice>>(
    `/invoice/${invoiceId}`,
  );

  if (!response.Invoice) {
    throw new Error(`Invoice ${invoiceId} not found`);
  }

  return response.Invoice;
}

export async function createInvoice(options: {
  customerId: string;
  lineItems: Array<{
    description?: string;
    amount: number;
    itemId?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
  txnDate?: string;
  dueDate?: string;
  customerMemo?: string;
}): Promise<QuickBooksInvoice> {
  const lines = options.lineItems.map((item, index) => {
    const line: Record<string, unknown> = {
      LineNum: index + 1,
      Amount: item.amount,
      DetailType: "SalesItemLineDetail",
    };

    if (item.description) {
      line.Description = item.description;
    }

    if (item.itemId) {
      line.SalesItemLineDetail = {
        ItemRef: {
          value: item.itemId,
        },
        Qty: item.quantity || 1,
        UnitPrice: item.unitPrice || item.amount,
      };
    }

    return line;
  });

  const invoiceData: Record<string, unknown> = {
    CustomerRef: {
      value: options.customerId,
    },
    Line: lines,
  };

  if (options.txnDate) {
    invoiceData.TxnDate = options.txnDate;
  }

  if (options.dueDate) {
    invoiceData.DueDate = options.dueDate;
  }

  if (options.customerMemo) {
    invoiceData.CustomerMemo = {
      value: options.customerMemo,
    };
  }

  const response = await quickbooksFetch<QuickBooksResponse<QuickBooksInvoice>>(
    "/invoice",
    {
      method: "POST",
      body: JSON.stringify(invoiceData),
    },
  );

  if (!response.Invoice) {
    throw new Error("Failed to create invoice");
  }

  return response.Invoice;
}

export async function listCustomers(options?: {
  maxResults?: number;
  active?: boolean;
}): Promise<QuickBooksCustomer[]> {
  const maxResults = options?.maxResults || 100;
  let query = `SELECT * FROM Customer MAXRESULTS ${maxResults}`;

  if (options?.active !== undefined) {
    query = `SELECT * FROM Customer WHERE Active = ${options.active} MAXRESULTS ${maxResults}`;
  }

  const response = await quickbooksFetch<QuickBooksResponse<QuickBooksCustomer>>(
    `/query?query=${encodeURIComponent(query)}`,
  );

  return response.QueryResponse?.Customer || [];
}

export async function getCustomer(customerId: string): Promise<QuickBooksCustomer> {
  const response = await quickbooksFetch<QuickBooksResponse<QuickBooksCustomer>>(
    `/customer/${customerId}`,
  );

  if (!response.Customer) {
    throw new Error(`Customer ${customerId} not found`);
  }

  return response.Customer;
}
