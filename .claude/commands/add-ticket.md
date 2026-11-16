---
description: "Open a weigh ticket for a seller at a yard, with its first line"
---

# add-ticket

Run `npm run scrap -- add-ticket --code=T-5001 --site= --seller= [--rego=] [--operator=] [--signed] --grade= --gross= [--tare=] [--price=dollars per tonne] [--vin=] [--vrego=] [--item=] [--photo] [--desc=]`. Fill in the operator's values. Add `--json` when you need every field.

Check the seller first: banned sellers and sellers with no ID or address are refused. Every vehicle needs its VIN. The price comes from the board unless the yard manager gives one.

Nothing here sends a message, pays anyone or contacts anyone.
