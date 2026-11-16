<h1 align="center">Scrap Yard for Claude Code</h1>

<p align="center">
  <strong>The open-source scrap yard system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your ScrapRight data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=scrapright">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/scrapright?utm_source=github&utm_medium=readme&utm_campaign=scrapright">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-scrapright">Instead of ScrapRight</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Scrap Yard for Claude Code runs a scrap metal yard's office: sellers and their ID, weigh tickets, grades and the price board, copper holds, yard stock, buyer contracts and the loads and containers that fill them. It is a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask in plain language.

ScrapRight is now part of ReSpark, which prices per location per month by custom quote, with dispatch, rail, exports and equipment maintenance sold as standalone products ([respark.com/pricing](https://respark.com/pricing), read 16 November 2026). No figure is published.

It is for scrap metal yards in New Zealand and Australia, one yard or several, that buy from the public and from trade, sell to mills and exporters, and have to show the police a clean dealer record. The New Zealand copper rules and the NSW and Victorian cash bans are built in.

Want the same thing with a weighbridge connection, a counter app with a camera, or a web front end? That is a customisation, and it is what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=scrapright).

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your tickets and seller records sit in plain Postgres tables you own. Any tool can read them. No export fee, no lock-in.
- No per-location fee, no modules. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for what a screen still gives you.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node 20 or later):

```bash
git clone https://github.com/Enterprise-DNA-OS/scrap-yard-for-claude-code.git
cd scrap-yard-for-claude-code
npm install
npm test
npm run demo
npm run scrap -- attention
```

Then open the folder in Claude Code and type `/attention`. The demo is four fictional yards in Auckland, Christchurch, Sydney and Melbourne, with a cash payment for steel in Sydney, a seller with no ID on file, a car body bought with no VIN, copper in Auckland cut up nine days into its 14-day hold, bright copper in Melbourne released with no photo, a banned seller who still got a ticket, a public seller who has sold copper six times in a month, an export contract 106 tonnes short with ten days to go, and stainless sitting in the yard for 78 days.

Seed only an empty demo database. On Postgres, `npm run seed -- --demo-database` is required on purpose.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. Seller ID records are personal information under the Privacy Act 2020 (NZ) and the Privacy Act 1988 (Cth): set up controlled access and backups before shared use.

## The commands

The weekly rituals:

| Command | What it does |
|---|---|
| `/attention` | Everything in breach, on hold, unpaid, short, stale or worth a look, in one list |
| `/weekly-review` | Writes the Monday review to `drafts/`: compliance, money waiting, holds, contracts, stock and margin |
| `/compliance` | Checks the records against six NZ, NSW and Victorian rules, each cited in [docs/compliance.md](docs/compliance.md) |
| `/price-board` | Today's buy price per grade at each yard, public and trade, and how old each price is |
| `/day-end` | One day at each yard: tickets, kilograms, paid by EFT, cheque and cash, still open |
| `/held` | Copper and other goods on hold, and the date each can be cut, baled or sold |
| `/yard-stock` | Kilograms on hand by yard and grade, with average cost and days since it moved |
| `/stale-stock` | Grades sitting 45 days or more, and the money tied up |
| `/contracts` | Open sale contracts: shipped, remaining, in the yards, and the ones that are short |
| `/margin` | Average buy and sell price per tonne for each grade over 30 days |
| `/seller-watch` | Public sellers bringing copper again and again, big public sellers, banned sellers |
| `/unpaid` | Tickets weighed but not paid |
| `/tickets`, `/ticket` | Recent tickets by yard, seller or status, and one ticket with its holds |
| `/seller` | One seller: ID, tickets, copper pattern and notes |
| `/dealer-register` | The dealer record, one row per line, in the order police ask for it |

Records and paperwork:

| Command | What it does |
|---|---|
| `/add-ticket`, `/add-line` | Weigh in at the board price. Refuses a banned seller, a seller with no ID or address, and a vehicle with no VIN |
| `/pay` | Mark a ticket paid. Refuses cash where the law bans it |
| `/release` | Release a held line for processing. Refuses inside the hold |
| `/void` | Void a ticket with a reason; it stays on record |
| `/add-seller`, `/update-seller` | Add a seller with ID, record missing details, ban or unban with a reason |
| `/set-price`, `/add-grade` | Change the price board, add a grade |
| `/add-contract`, `/add-load` | Record a sale contract, and each truck or container that ships against it |
| `/log` | A note, call or police enquiry against a seller |
| `/draft-register` | The dealer register for a date range as a CSV, for an inspection |
| `/draft-statement` | A purchase statement for a trade account |
| `/draft-price-list` | The trade price list email for a yard |
| `/draft-buyer-update` | An email to a buyer on where their contract stands |
| `/import` | Tickets from a ScrapRight export, or a customer list |
| `/export` | Every table to CSV and JSON with a manifest |
| `/customise` | Add a field, a grade family or your state's rules, in plain language |
| `/new-view` | Add a read-only page to `npm run view` |
| `/audit`, `/imports`, `/help` | What changed and who changed it, what was imported, every command |

Every CLI command takes `--json`. Records match on code or any part of the name; an ambiguous name lists the candidates and exits 1. Nothing sends and nothing pays: every letter, statement and register is written to `drafts/` for a person to deal with.

`npm run view` renders three read-only pages (the week, stock and contracts, the price board) in your colours from `brand.json`. `npm run docs` renders a weighbridge ticket for each recent ticket, a purchase statement for each trade account and a load-out sheet for each recent load.

## Ten questions ScrapRight's screens do not answer for you

Each is one command against your own records today.

1. Which tickets would fail a police inspection today, and why? `compliance`
2. Which copper can we cut or bale this week, and which has to wait, to the day? `held`
3. Which public sellers have brought in copper four or more times this month? `seller-watch`
4. Are we going to fill each export contract by its date, with what is in the yards now? `contracts`
5. How many tonnes do we need to buy in, and how fast, to make that date? `contracts`
6. What did each grade cost us and sell for over the last month, per tonne? `margin`
7. Which grades have sat in a yard for 45 days, and how much money is tied up? `stale-stock`
8. Which yard took cash yesterday, and was any of it for a grade the law says cannot be paid in cash? `day-end`, `compliance`
9. Which prices on the board have not moved in three weeks? `attention`
10. Which yard's dealer licence runs out next? `compliance`

## Your first hour: ten things to ask for

1. "Put our yard's name and colours in brand.json."
2. "Run the attention list on the demo and explain each row."
3. "Which copper is on hold, and when can each lot be baled?"
4. "Clear the demo and set up our yards, licences and grades."
5. "Set today's price board for the Auckland yard from this list."
6. "Map our ScrapRight ticket export and dry-run it."
7. "Import our customers and check who has no ID on file."
8. "Add our open export contracts and the containers already shipped."
9. "Add the Queensland rules for our Brisbane yard to the compliance check."
10. "Set up a shared database with backups for the office and the weighbridge."

## Instead of ScrapRight

Export tickets and customers from ScrapRight as CSV and run `npm run scrap -- import scrapright tickets.csv --site=AKL --dry-run`. The column names ScrapRight-style exports use are read out of the box, a US export in pounds takes `--unit=lb`, and anything else takes a one-line mapping. The full guide, including what does not carry over, is [docs/replace-scrapright.md](docs/replace-scrapright.md).

## Architecture

```
scrap-yard-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     compliance rules, the ScrapRight guide, why no front end
  views.json, documents.json the read-only pages and the paperwork
  examples/                 a ScrapRight-style ticket export and a customer list
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Scrap Yard for Claude Code for your business, migrates your ScrapRight data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=scrapright)
- Read more: [enterprisedna.co/omni/instead-of/scrapright](https://enterprisedna.co/omni/instead-of/scrapright?utm_source=github&utm_medium=readme&utm_campaign=scrapright)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
