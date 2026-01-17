import { tool } from "veryfront/tool";
import { z } from "zod";
import { formatContactName, listContacts } from "../../lib/salesforce-client.ts";

export default tool({
  id: "list-contacts",
  description:
    "List contacts from your Salesforce CRM. Returns contact information including name, email, phone, title, and account association.",
  inputSchema: z.object({
    limit: z.number().min(1).max(100).default(10).describe("Maximum number of contacts to return"),
    offset: z.number().min(0).default(0).describe("Number of records to skip for pagination"),
    accountId: z.string().optional().describe("Filter contacts by Account ID"),
    fields: z.array(z.string()).optional().describe(
      "Additional fields to retrieve (e.g., Account.Name, Owner.Name, LeadSource)",
    ),
  }),
  async execute({ limit, offset, accountId, fields }) {
    const response = await listContacts({
      limit,
      offset,
      accountId,
      fields,
    });

    return {
      contacts: response.records.map((contact) => ({
        id: contact.Id,
        name: formatContactName(contact),
        firstName: contact.FirstName,
        lastName: contact.LastName,
        email: contact.Email,
        phone: contact.Phone,
        mobilePhone: contact.MobilePhone,
        title: contact.Title,
        department: contact.Department,
        accountId: contact.AccountId,
        mailingCity: contact.MailingCity,
        mailingState: contact.MailingState,
        mailingCountry: contact.MailingCountry,
        createdDate: contact.CreatedDate,
        lastModifiedDate: contact.LastModifiedDate,
        additionalFields: fields
          ? Object.fromEntries(
            fields
              .filter((field) => contact[field] !== undefined)
              .map((field) => [field, contact[field]]),
          )
          : undefined,
      })),
      totalSize: response.totalSize,
      hasMore: !response.done,
    };
  },
});
