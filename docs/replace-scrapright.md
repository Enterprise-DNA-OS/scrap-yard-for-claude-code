# Moving off ScrapRight

ScrapRight is now part of ReSpark ([respark.com/scrapright](https://respark.com/scrapright), read 16 November 2026). ScrapRight customers can keep using their platform, and ReSpark offers to help move them across to its own. If you would rather own your records, this is the path.

## 1. Get your data out

Ask for, or run, these exports from ScrapRight (or whichever yard system you use) as CSV:

- **Tickets**, one row per ticket line: ticket number, date, customer, material, gross, tare and net weight, price or line amount, payment type and reference, and any VIN.
- **Customers**, with address, date of birth and ID type and number.

ReSpark lists data migration as part of its onboarding. Ask for your exports before you give notice, and keep the files until the records here reconcile.

## 2. Dry-run the import

```bash
npm run scrap -- import sellers customers.csv --dry-run
npm run scrap -- import scrapright tickets.csv --site=AKL --dry-run
```

The dry run reports tickets, lines, new sellers, new grades and the dollar total, and saves nothing. Check the total against ScrapRight's own report for the same dates.

## 3. Import for real

Run the same commands without `--dry-run`. An identical file is skipped if you run it twice. A row that cannot be read (a bad date, a missing weight) rolls back the whole file and names the row.

## What maps

| ScrapRight column | Here |
|---|---|
| Ticket #, Ticket Number | `tickets.code` |
| Ticket Date, Date | `tickets.received_on` (YYYY-MM-DD or DD/MM/YYYY) |
| Customer, Company, Customer Type | `sellers` (a company or a commercial type makes a trade seller) |
| Address, DOB, ID Type, ID Number | `sellers` ID fields, which the compliance check reads |
| Material, Commodity | `grades` by code or name; a new name becomes a new grade, with its family guessed from the name |
| Gross, Tare, Net | `ticket_lines` weights in kg; `--unit=lb` converts a US export in pounds |
| Amount, or Price | `ticket_lines.amount_cents` and the price per tonne |
| Payment Type, Check # | paid by EFT, cheque or cash, with the reference; blank means still open |
| VIN, Plate | `ticket_lines.vehicle_vin`, `vehicle_rego` |

Other column names take a mapping file: `{"material": "Commodity Description", "net": "Net Lbs"}` and `--mapping=map.json`.

## What does not carry over

- **Photos, thumbprints and ID scans.** Keep the ScrapRight archive for as long as your records rules require.
- **Item numbers and release dates on copper.** Imported copper lines arrive with no item number and no release date, so the NZ copper check lists them. Mark the ones already processed with `release`, after the hold.
- **Price history.** Set today's board with `set-price`; older tickets keep the price they were bought at.
- **Accounting.** Payments stay in your accounting system. This records how each ticket was paid.
- **Containers, contracts and dispatch.** Add open contracts with `add-contract` and recent loads with `add-load`.

Want it done for you, mapped from your own export? That is what Enterprise DNA does: https://enterprisedna.co/omni/instead-of/scrapright
