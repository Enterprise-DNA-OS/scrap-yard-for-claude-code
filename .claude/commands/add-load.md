---
description: "Record a truck or container leaving a yard (refused if the yard does not hold that much)"
---

# add-load

Run `npm run scrap -- add-load --code= --site= --buyer= --grade= --kg= --price=<per tonne> [--contract=] [--container=] [--seal=] [--on=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Refused if the yard does not hold that many kilograms of the grade. A load against a contract that fills it closes the contract.

Nothing here sends a message, pays anyone or contacts anyone.
