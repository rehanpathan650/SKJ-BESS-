# Quotations from an electricity bill

**New quotation** (website menu, Android dashboard, or a customer's page) turns a customer's electricity bill into a
complete techno-commercial quotation: bill analysis, recommended system with size options, installation layout
drawing, BOQ, GST, payment schedule, bank-finance EMI with a year-by-year repayment schedule, savings and payback,
scope, warranty, implementation, terms, and a signature block. The same content is shown on screen and as a PDF.

## Steps
1. **Upload the bill.** A PDF from the DISCOM portal works best (photos, Excel, CSV are accepted). Without a customer
   selected, a new customer is created and named from the bill.
2. **Check the values.** Bills are read by Claude when `ANTHROPIC_API_KEY` is set, otherwise by the built-in MSEDCL
   reader (HT bills) or basic text rules. A person confirms the values; every figure depends on them.
3. **Choose and generate.** Size (best value, an alternative, or custom), project value, purpose, backup, optional
   contract-demand revision, bank finance (down payment, interest, tenure), payment milestones, validity, warranty.
   Figures update live. **Generate quotation** saves it with a number like `SKJ/BESS/2026-27/001` and a PDF.

## Who calculates what
| Part | How |
|---|---|
| Reading the bill | Claude (AI) or the MSEDCL reader, then checked by a person |
| Battery size | The app tries ~40 standard sizes (2–4 hour systems) and picks the best value (NPV) for this bill |
| Savings | Time-of-day shifting (peak surcharge minus charging cost and battery losses) + demand-charge reduction, with degradation, O&M and tariff escalation |
| Contract-demand revision | Shown separately; counted in payback only if you tick the box (it needs no battery) |
| BOQ, GST, milestones, EMI, repayment schedule, payback, IRR | Fixed formulas (EMI = standard reducing-balance formula) |
| Wording (summary, observations, operating strategy, recommendation) | Claude when configured, otherwise standard text. AI wording may only quote rupee amounts the app calculated; anything else is rejected and the standard text is used |

No number in a quotation comes from AI.

## Settings to fill in before quoting customers
* **Pricing & assumptions**: vendor battery ₹/kWh, PCS ₹/kW, installation %, margin %, GST %, O&M, escalation,
  degradation. The defaults are placeholders (about ₹1.27 Cr for 1 MWh / 250 kW). Or type a fixed project value per
  quotation.
* **Company details on quotations** (same page): name, address, phone, email, GSTIN, authorised signatory.
* `ANTHROPIC_API_KEY` in `apps/api/.env` to read PDFs/photos of any DISCOM and to write the wording.

## Single-login mode (`SINGLE_USER_MODE=true` in `apps/api/.env`)
For one person producing quotations: public sign-up is off, the user-approval and role screens are hidden, and saved
configurations and quotations skip the engineer-validation / management-approval chain (they are ready to send).
Everything is still audited. Turn it off to return to the multi-person workflow; quotations then need a configuration
validated by an engineer and approval before sharing.

## Honest results
The quotation states plainly when a battery does not pay back on the current tariff (for example when billed demand
is fixed by the 75%-of-contract-demand minimum and the evening surcharge barely exceeds battery losses), and points to
a contract-demand revision or interval-data study instead. Sales can still quote any size and price.
