---
description: "Import tickets from a ScrapRight (or any yard system) ticket CSV, or a seller list"
---

# import

Run `npm run scrap -- import scrapright <tickets.csv> --site= [--unit=kg|lb] [--mapping=map.json] [--dry-run]`. Fill in the operator's values. Add `--json` when you need every field.

Run with --dry-run first and show the counts: tickets, lines, new sellers, new grades, dollars. Check new grade names and families before the real run. A US export in pounds takes --unit=lb. Other column names take a mapping file: see docs/replace-scrapright.md. An identical file is skipped; a bad row rolls back the whole file.

Nothing here sends a message, pays anyone or contacts anyone.
