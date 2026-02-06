import { tool } from "veryfront/tool";
import { z } from "zod";
import { listContacts } from "../../lib/xero-client.ts";

export default tool({
  id: "list-contacts",
  description: "List contacts from Xero. Can filter by customer or supplier type.",
  inputSchema: z.object({
    isCustomer: z.boolean().optional().describe("Filter for customers only"),
    isSupplier: z.boolean().optional().describe("Filter for suppliers only"),
    limit: z
      .number()
      .min(1)
      .max(100)
      .default(20)
      .describe("Maximum number of contacts to return"),
  }),
  async execute({ isCustomer, isSupplier, limit }) {
    const contacts = await listContacts({ isCustomer, isSupplier, limit });

    return contacts.map((contact) => ({
      contactId: contact.ContactID,
      contactNumber: contact.ContactNumber,
      name: contact.Name,
      firstName: contact.FirstName,
      lastName: contact.LastName,
      emailAddress: contact.EmailAddress,
      isCustomer: contact.IsCustomer,
      isSupplier: contact.IsSupplier,
      addresses: contact.Addresses?.map((addr) => ({
        addressType: addr.AddressType,
        city: addr.City,
        region: addr.Region,
        postalCode: addr.PostalCode,
        country: addr.Country,
      })),
      phones: contact.Phones?.map((phone) => ({
        phoneType: phone.PhoneType,
        phoneNumber: phone.PhoneNumber,
      })),
    }));
  },
});
