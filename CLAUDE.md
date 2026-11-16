# Scrap Yard for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR YARDS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing this week? | `/attention` |
| The Monday review | `/weekly-review` |
| Would we pass an inspection? | `/compliance`, then `/draft-register` |
| What are we paying today? Change a price | `/price-board`, `/set-price` |
| How did the yard go today? | `/day-end` |
| Weigh someone in | `/add-ticket`, `/add-line`, then `/pay` |
| What copper can we bale? | `/held`, then `/release` |
| What is in the yard? What is stuck? | `/yard-stock`, `/stale-stock` |
| Will we fill the contract? | `/contracts`, `/draft-buyer-update` |
| A container or truck went out | `/add-load` |
| New sale contract | `/add-contract` |
| What are we making per tonne? | `/margin` |
| Anyone selling us something they should not? | `/seller-watch`, `/seller`, `/log` |
| Who have we not paid? | `/unpaid`, `/tickets` |
| New seller, missing ID, ban someone | `/add-seller`, `/update-seller` |
| Statement for a trade account, price list | `/draft-statement`, `/draft-price-list` |
| Bring in ScrapRight tickets or a customer list | `/import` |
| Get everything out | `/export` |
| Change a field, grade family or rule | `/customise`, `/add-grade` |
| A new page to look at | `/new-view` |
| Who changed what | `/audit` |

If an ask fits nothing here, run the CLI directly (`npm run scrap -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Yard rules for this office

- Seller ID records are personal information. Never paste them anywhere outside this folder and the database.
- The law is checked before the money moves. Never work around a refusal from `add-ticket`, `pay` or `release`; tell the operator the rule and its source.
- A pattern on `/seller-watch` is not proof. Contacting police is a person's decision, never this system's.
- Compliance checks cite their source. Nothing here is legal advice.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the compliance rules, the guide for moving off ScrapRight, and why there is no front end.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/scrapright
