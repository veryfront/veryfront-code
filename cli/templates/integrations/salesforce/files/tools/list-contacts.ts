import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";
import { formatContactName, listContacts } from "../../lib/salesforce-client.ts";

export default tool({
  id: "list-contacts",
  description:
    "List contacts from your Salesforce CRM. Returns contact information including name, email, phone, title, and account association.",
  inputSchema: defineSchema((v) => v.object({
    limit: v.number().min(1).max(100).default(10).describe("Maximum number of contacts to return"),
    offset: v.number().min(0).default(0).describe("Number of records to skip for pagination"),
    accountId: v.string().optional().describe("Filter contacts by Account ID"),
    fields: v
      .array(v.string())
      .optional()
      .describe("Additional fields to retrieve (e.g., Account.Name, Owner.Name, LeadSource)"),
  }))(),
  async execute({ limit, offset, accountId, fields }) {
    const response = await listContacts({ limit, offset, accountId, fields });

    return {
      contacts: response.records.map((contact) => {
        const additionalFields = fields
          ? Object.fromEntries(
              fields.flatMap((field) => {
                const value = contact[field];
                return value === undefined ? [] : [[field, value]];
              }),
            )
          : undefined;

        return {
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
          additionalFields,
        };
      }),
      totalSize: response.totalSize,
      hasMore: !response.done,
    };
  },
});
