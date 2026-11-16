---
description: "Mark a ticket paid by EFT, cheque or cash (cash refused where the law bans it)"
---

# pay

Run `npm run scrap -- pay <ticket> --method=eft|cheque|cash [--ref=] [--on=YYYY-MM-DD]`. Fill in the operator's values. Add `--json` when you need every field.

Cash is refused at NSW yards, and at Victorian yards unless every line is over 80% copper. Record the EFT or cheque reference.

Nothing here sends a message, pays anyone or contacts anyone.
