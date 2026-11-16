#!/usr/bin/env node
// npm test: a temporary database, migrate twice, seed twice, then every command, with assertions.
// Uses the embedded database unless SCRAP_TEST_POSTGRES_URL or TEST_DATABASE_URL names a
// disposable Postgres. Never point this at a working database: it seeds demo data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, reads, commands, resolve } from './scrap.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scrap-test-'));
process.env.DATABASE_URL = process.env.SCRAP_TEST_POSTGRES_URL || process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(tmp, 'db');
process.env.OUTPUT_DIR = path.join(tmp, 'out');
process.env.DRAFTS_DIR = path.join(tmp, 'drafts');
process.env.SCRAP_ACTOR = 'Test operator';

const db = await getDb();
let checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const rejects = async (args, pattern) => { await assert.rejects(() => run(db, args), pattern); checks++; };
const today = new Date().toISOString().slice(0, 10);
const draft = (file) => fs.readFileSync(path.join(process.env.DRAFTS_DIR, path.basename(file)), 'utf8');
const rules = async () => (await run(db, ['compliance'])).map((f) => `${f.rule} ${f.record}`).sort();

try {
  if (db.mode === 'postgres') {
    await db.exec('drop schema public cascade; create schema public;');
  }
  eq((await migrate(db)).ran.length, 1, 'first migrate applies 0001');
  eq((await migrate(db)).ran.length, 0, 'second migrate is a no-op');
  await seed(db);
  const [{ n: before }] = await db.query('select count(*)::int n from ticket_lines');
  await seed(db);
  eq((await db.query('select count(*)::int n from ticket_lines'))[0].n, before, 'seed is idempotent');

  // Every read runs.
  for (const name of Object.keys(reads)) ok(Array.isArray(await run(db, [name])), name);

  // The demo's planted problems, one rule at a time.
  eq(await rules(), ['R01 T-3002', 'R01 T-4002', 'R02 T-1006', 'R02 T-2003', 'R02 T-3001', 'R03 T-3003/2', 'R04 T-1002/1', 'R04 T-1003/1', 'R05 T-4001/1', 'R06 AKL']);
  ok((await run(db, ['compliance'])).every((f) => /Act|guidance|laws/.test(f.source)), 'every finding cites its source');
  ok(!(await rules()).includes('R01 T-4001'), 'Victorian cash for goods over 80% copper is not a breach');
  eq((await run(db, ['unpaid'])).map((r) => r.ticket).sort(), ['T-1005', 'T-1009', 'T-2004', 'T-4004']);
  eq((await run(db, ['held'])).length, 7, 'seven lines on hold');
  eq((await run(db, ['held'])).find((h) => h.ticket === 'T-4004').days_left, 5, 'Victoria: 7 days without a photo');
  eq((await run(db, ['held'])).find((h) => h.ticket === 'T-1010').days_left, 13, 'NZ copper: 14 days');
  eq((await run(db, ['stale-stock'])).map((s) => `${s.site} ${s.grade}`), ['AKL SS304', 'SYD CAST']);
  const k2611 = (await run(db, ['contracts'])).find((c) => c.code === 'K-2611');
  eq([k2611.shipped_t, k2611.remaining_t, k2611.in_yard_t], ['120.00', '180.00', '74.03']);
  ok(k2611.position.startsWith('short'), 'K-2611 is short with 10 days left');
  eq((await run(db, ['seller-watch'])).map((s) => s.seller_code).sort(), ['P01', 'P06']);
  eq((await run(db, ['margin'])).find((m) => m.grade === 'HMS').margin_cents_per_tonne, 4955);
  eq((await run(db, ['price-board', '--site=akl', '--kind=trade'])).length, 12);
  eq((await run(db, ['day-end', `--on=${today}`])).length, 0, 'nothing weighed yet today');
  eq((await run(db, ['day-end', '--on=yesterday'])).map((d) => d.site), ['AKL', 'CHC']);
  eq((await run(db, ['dealer-register', '--site=syd'])).length, 5);
  eq((await run(db, ['tickets', '--days=30', '--seller=kyle'])).length, 6);
  ok((await run(db, ['attention'])).length >= 20, 'attention gathers everything');

  // Matching.
  eq((await resolve(db, 'seller', 'p01')).name, 'Kyle Brennan');
  eq((await resolve(db, 'seller', 'westside')).code, 'T02');
  await assert.rejects(() => resolve(db, 'seller', 'hollis'), /Ambiguous seller/); checks++;
  await assert.rejects(() => resolve(db, 'seller', 'nobody-here'), /no seller matches/); checks++;
  const profile = await run(db, ['seller', 'Kyle']);
  eq(profile.tickets.length, 6);
  eq(profile.watch[0].copper_tickets_30d, 6);

  // The weighbridge: the law is checked before the money moves.
  await rejects(['add-ticket', '--code=T-9001', '--site=CHC', '--seller=Sam Fale', '--grade=HMS', '--gross=100'], /banned/);
  await rejects(['add-ticket', '--code=T-9001', '--site=SYD', '--seller=Darren', '--grade=HMS', '--gross=100'], /ID and address first/);
  await rejects(['add-ticket', '--code=T-9001', '--site=SYD', '--seller=P05', '--grade=CAR', '--gross=1000'], /VIN/);
  ok(!(await db.query("select 1 from tickets where code = 'T-9001'")).length, 'a refused line rolls back the ticket');
  const t = await run(db, ['add-ticket', '--code=T-9001', '--site=SYD', '--seller=P05', '--grade=HMS', '--gross=1000', '--tare=120', '--signed']);
  eq([t[0].cents_per_tonne, t[0].amount_cents], [38000, 33440], 'priced from the board: 880 kg at $380/t');
  const l2 = await run(db, ['add-line', 'T-9001', '--grade=CAR', '--gross=1100', '--vin=6T1BF3EK1AX012345']);
  eq(l2[0].line_no, 2);
  await rejects(['pay', 'T-9001', '--method=cash'], /NSW bans cash/);
  await run(db, ['pay', 'T-9001', '--method=eft', '--ref=EFT 9001']);
  await rejects(['add-line', 'T-9001', '--grade=HMS', '--gross=10'], /is paid/);
  await rejects(['pay', 'T-9001', '--method=eft'], /already paid/);
  eq((await run(db, ['day-end', `--on=${today}`]))[0].eft_cents, 33440 + 22000, "880 kg of HMS and an 1100 kg car paid by EFT");

  // Victoria: brass is scrap, bright copper is a second-hand good.
  await run(db, ['add-ticket', '--code=T-9002', '--site=MEL', '--seller=Jason', '--grade=BRASS', '--gross=20', '--signed']);
  await rejects(['pay', 'T-9002', '--method=cash'], /only goods over 80% copper/);
  await run(db, ['void', 'T-9002', '--reason=Seller left']);
  await run(db, ['add-ticket', '--code=T-9003', '--site=MEL', '--seller=Jason', '--grade=CU1', '--gross=12', '--signed']);
  eq((await run(db, ['pay', 'T-9003', '--method=cash']))[0].payment_method, 'cash');
  ok(!(await rules()).some((r) => r.includes('T-9003')), 'cash for bright copper in Victoria is not flagged');

  // Holds: release refused inside the hold, allowed after it.
  await rejects(['release', 'T-1004'], /on hold until/);
  await rejects(['release', 'T-9003'], /on hold until/);
  const later = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
  eq((await run(db, ['release', 'T-1004', `--on=${later}`]))[0].result, `released ${later}`);
  eq((await run(db, ['release', 'T-1004']))[0].result, `already released ${later}`);

  // Fixing the records clears the findings.
  await run(db, ['update-seller', 'Darren', '--id-type=NSW driver licence', '--id-number=11223344']);
  await run(db, ['update-seller', 'Mere', '--dob=1990-05-05']);
  ok(!(await rules()).some((r) => r === 'R02 T-3001' || r === 'R02 T-1006'), 'ID and date of birth recorded');
  await run(db, ['update-seller', 'Kyle', '--ban', '--reason=Could not show where the cable came from']);
  await rejects(['add-ticket', '--code=T-9004', '--site=AKL', '--seller=Kyle', '--grade=CU1', '--gross=5'], /banned/);
  await rejects(['update-seller', 'Ruby', '--ban'], /missing --reason/);
  await run(db, ['update-seller', 'Kyle', '--unban']);
  eq((await run(db, ['seller', 'P01'])).notes[0].body, 'Ban lifted');

  // Prices, grades, contracts and loads.
  await run(db, ['set-price', '--site=AKL', '--grade=HMS', '--price=395', '--kind=trade']);
  eq((await run(db, ['price-board', '--site=AKL', '--kind=trade'])).find((p) => p.grade === 'HMS').cents_per_tonne, 39500);
  await run(db, ['add-grade', '--code=ZINC', '--name=Zinc die cast', '--family=non ferrous']);
  await rejects(['add-grade', '--code=X', '--name=X', '--family=plastic'], /must be one of/);
  await rejects(['add-load', '--code=L-900', '--site=SYD', '--buyer=B01', '--grade=HMS', '--kg=900000', '--price=460'], /holds/);
  const ld = await run(db, ['add-load', '--code=L-900', '--site=SYD', '--buyer=B01', '--grade=HMS', '--kg=50000', '--price=460', '--contract=K-2611', '--container=TCLU1112223', '--seal=SL-1']);
  eq(ld[0].amount_cents, 2300000);
  eq((await run(db, ['contracts'])).find((c) => c.code === 'K-2611').shipped_t, '170.00');
  await run(db, ['add-contract', '--code=K-2701', '--buyer=Southern Steel', '--grade=CAST', '--tonnes=0.3', '--price=360', '--deliver-by=2099-01-01', '--currency=aud']);
  await run(db, ['add-load', '--code=L-901', '--site=SYD', '--buyer=B02', '--grade=CAST', '--kg=300', '--price=360', '--contract=K-2701']);
  ok(!(await run(db, ['contracts'])).some((c) => c.code === 'K-2701'), 'a filled contract leaves the list');
  ok(!(await run(db, ['stale-stock'])).some((s) => s.grade === 'CAST'), 'shipped stock is no longer stale');
  await run(db, ['log', 'Westside', '--kind=call', '--body=Two loads booked for next week']);
  ok((await run(db, ['audit'])).length >= 15, 'every write is audited');

  // Import: a ScrapRight ticket export, dry run, real run, repeat skipped, bad file rolled back.
  const csv = path.join(REPO_ROOT, 'examples', 'scrapright-tickets.csv');
  const dry = await run(db, ['import', 'scrapright', csv, '--site=AKL', '--dry-run']);
  eq([dry[0].tickets_added, dry[0].lines_added], [3, 4]);
  eq((await db.query("select count(*)::int n from tickets where code like 'SR-%'"))[0].n, 0, 'dry run saves nothing');
  const real = await run(db, ['import', 'scrapright', csv, '--site=AKL']);
  eq([real[0].tickets_added, real[0].lines_added, real[0].sellers_added, real[0].grades_added, real[0].total_cents], [3, 4, 2, 2, 248730]);
  eq((await db.query("select kind, business_name from sellers where name = 'Ana Lee'"))[0], { kind: 'trade', business_name: 'Hutt Valley Plumbing Ltd' });
  eq((await db.query("select family from grades where name = 'Car Body'"))[0].family, 'vehicle');
  eq((await db.query("select status, payment_method from tickets where code = 'SR-70003'"))[0], { status: 'open', payment_method: 'none' });
  eq((await db.query("select received_on from tickets where code = 'SR-70001'"))[0].received_on, '2026-11-03', 'day-first dates');
  eq((await run(db, ['import', 'scrapright', csv, '--site=AKL']))[0].result, 'skipped');
  const lb = path.join(tmp, 'lb.csv');
  fs.writeFileSync(lb, 'Ticket #,Ticket Date,Customer,ID Type,ID Number,Material,Net,Price\nUS-1,2026-11-01,Pat Doe,Licence,X1,Heavy melting steel 1 and 2,1000,0.20\n');
  const lbr = await run(db, ['import', 'tickets', lb, '--site=AKL', '--unit=lb', '--dry-run']);
  eq(lbr[0].total_cents, 20000, '1000 lb at 20 cents a pound is $200');
  const bad = path.join(tmp, 'bad.csv');
  fs.writeFileSync(bad, 'Ticket #,Ticket Date,Customer,Material,Net,Amount\nB-1,2026-11-01,Ok Row,Cast iron,100,30\nB-2,yesterday,Bad Date,Cast iron,100,30\n');
  await rejects(['import', 'scrapright', bad, '--site=AKL'], /cannot read the date/);
  eq((await db.query("select count(*)::int n from tickets where code = 'B-1'"))[0].n, 0, 'a bad row rolls back the whole file');
  const sel = await run(db, ['import', 'sellers', path.join(REPO_ROOT, 'examples', 'sellers.csv')]);
  eq([sel[0].sellers_added, sel[0].sellers_already_there], [1, 1]);

  // Drafts never send; they land in drafts/.
  const review = await run(db, ['weekly-review']);
  ok(draft(review[0].draft).includes('## Holds'));
  const st = await run(db, ['draft-statement', 'Westside']);
  ok(draft(st[0].draft).includes('Westside Demolition Pty Ltd'));
  await rejects(['draft-statement', 'Kyle'], /public seller/);
  const pl = await run(db, ['draft-price-list', '--site=AKL']);
  ok(draft(pl[0].draft).includes('Heavy melting steel 1 and 2: $395.00'));
  const bu = await run(db, ['draft-buyer-update', 'K-2611']);
  ok(draft(bu[0].draft).includes('TCLU1112223'));
  const reg = await run(db, ['draft-register', '--site=SYD']);
  ok(draft(reg[0].draft).startsWith('ticket,received_on'), 'register is a CSV');

  // Export: every table plus a manifest, into a new folder only.
  const out = path.join(tmp, 'export');
  const manifest = await run(db, ['export', `--out=${out}`]);
  eq(manifest.length, 12);
  ok(fs.readFileSync(path.join(out, 'grades.csv'), 'utf8').includes('"Bright copper wire, No. 1"'), 'CSV quoting survives');
  await rejects(['export', `--out=${out}`], /not empty/);

  await rejects(['nonsense'], /unknown command/);
  eq((await run(db, ['help'])).length, Object.keys(reads).length + Object.keys(commands).length);
} finally {
  await db.close();
}

// The rendered views and documents, and the CLI as a person runs it, on the same data.
const env = { ...process.env };
for (const [script, args, expect] of [
  ['view.mjs', [], /view: .*prices/],
  ['docs.mjs', [], /document\(s\) rendered/],
  ['scrap.mjs', ['attention'], /compliance/],
  ['scrap.mjs', ['yard-stock', '--json'], /"on_hand_kg"/],
]) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, `${script} ${args.join(' ')} failed: ${r.stderr}`);
  assert.match(r.stdout, expect);
  checks++;
}
const amb = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'scrap.mjs'), 'seller', 'hollis'], { env, encoding: 'utf8' });
assert.equal(amb.status, 1, 'ambiguous match exits 1');
assert.match(amb.stderr, /Ambiguous/);
checks++;
for (const kind of ['weigh-ticket', 'trade-statement', 'load-out-sheet']) {
  assert.ok(fs.readdirSync(path.join(process.env.OUTPUT_DIR, 'docs-out', kind)).length >= 3, `${kind} rendered`);
  checks++;
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PASS: ${checks} checks, ${Object.keys(reads).length + Object.keys(commands).length} commands (${process.env.DATABASE_URL ? 'postgres' : 'pglite'})`);
