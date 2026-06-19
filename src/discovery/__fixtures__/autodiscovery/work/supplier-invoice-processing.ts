import { work } from "veryfront/work";

export default work({
  id: "supplier-invoice-processing",
  name: "Supplier invoice processing",
  outcome: "Resolve all open supplier invoices.",
  expectations: [
    {
      id: "invoices_discovered",
      description: "Open supplier invoices have been discovered.",
    },
    {
      id: "all_invoices_resolved",
      description: "All discovered invoices have a final resolution.",
    },
  ],
});
