#!/usr/bin/env node
// The one CLI for Scrap Yard for Claude Code.
//
//   npm run scrap -- help
//   npm run scrap -- attention
//   npm run scrap -- seller "kyle"
//   npm run scrap -- yard-stock --json
//
// Human tables by default, --json for machines. Records match on code or a case-insensitive
// part of the name; an ambiguous match lists the candidates and exits 1.
// Nothing here sends or pays. Letters, statements and registers are written to drafts/.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table as textTable } from './lib/format.mjs';

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- reads

export const reads = {
  'price-board': {
    about: "Today's buy price per grade at each yard, filtered by --site and --kind=public|trade",
    sql: `select site, grade, grade_name, seller_kind as kind, cents_per_tonne, effective_on, days_old
          from current_prices
          where ($1::text is null or lower(site) = lower($1)) and ($2::text is null or seller_kind = lower($2))
          order by site, family, grade, seller_kind`,
    params: (o) => [str(o.site), str(o.kind)],
  },
  'day-end': {
    about: 'One day at each yard: tickets, tonnes, paid by EFT, cheque and cash, and still open (--on=YYYY-MM-DD, default today)',
    sql: `select site, count(*)::int as tickets, sum(net_kg)::bigint as net_kg, sum(amount_cents)::bigint as total_cents,
            coalesce(sum(amount_cents) filter (where payment_method = 'eft' and status = 'paid'), 0)::bigint as eft_cents,
            coalesce(sum(amount_cents) filter (where payment_method = 'cheque' and status = 'paid'), 0)::bigint as cheque_cents,
            coalesce(sum(amount_cents) filter (where payment_method = 'cash' and status = 'paid'), 0)::bigint as cash_cents,
            coalesce(sum(amount_cents) filter (where status = 'open'), 0)::bigint as open_cents,
            count(*) filter (where status = 'open')::int as open_tickets
          from ticket_summary
          where received_on = coalesce($1::date, current_date) and status <> 'void' and ($2::text is null or lower(site) = lower($2))
          group by site order by site`,
    params: (o) => [o.on === 'yesterday' ? addDays(today(), -1) : isoDate(o.on, 'on'), str(o.site)],
  },
  tickets: {
    about: 'Tickets in the last --days (default 7), filtered by --site, --status or --seller',
    sql: `select code, site, received_on, seller, seller_kind, lines, net_kg, amount_cents, status, payment_method, payment_ref
          from ticket_summary
          where received_on >= current_date - coalesce($1::int, 7)
            and ($2::text is null or lower(site) = lower($2))
            and ($3::text is null or status = lower($3))
            and ($4::text is null or lower(seller) like '%' || lower($4) || '%' or lower(seller_code) = lower($4))
          order by received_on desc, code desc`,
    params: (o) => [o.days ? Number(o.days) : null, str(o.site), str(o.status), str(o.seller)],
  },
  unpaid: { about: 'Tickets weighed but not yet paid', sql: 'select * from unpaid_tickets order by days_waiting desc, ticket' },
  held: {
    about: 'Copper and other goods under a hold: what can be cut, baled or sold, and when',
    sql: `select ticket, line_no, site, seller, grade, net_kg, item_no, received_on, hold_until, days_left, state_now
          from held_items where released_on is null order by hold_until, ticket`,
  },
  'yard-stock': {
    about: 'Tonnes on hand by yard and grade, with average cost and days since it last moved (--site)',
    sql: `select site, grade, grade_name, on_hand_kg, avg_cost_cents_per_tonne, last_in, last_out, days_since_moved
          from yard_stock where on_hand_kg > 0 and ($1::text is null or lower(site) = lower($1)) order by site, on_hand_kg desc`,
    params: (o) => [str(o.site)],
  },
  'stale-stock': {
    about: 'Grades sitting in a yard 45 days or more without moving',
    sql: `select site, grade, grade_name, on_hand_kg, avg_cost_cents_per_tonne, days_since_moved,
            round(on_hand_kg * avg_cost_cents_per_tonne / 1000.0)::bigint as cost_tied_up_cents
          from yard_stock where on_hand_kg > 0 and days_since_moved >= 45 order by days_since_moved desc`,
  },
  contracts: {
    about: 'Open sale contracts: shipped, remaining, in the yard, and the ones at risk',
    sql: `select code, buyer, grade, tonnes, cents_per_tonne, currency, deliver_by, days_left, shipped_t, remaining_t, in_yard_t,
            case when remaining_t > in_yard_t and days_left <= 21 then 'short: ' || (remaining_t - in_yard_t) || ' t to buy in ' || days_left || ' days'
                 when remaining_t > in_yard_t then 'need ' || (remaining_t - in_yard_t) || ' t more'
                 else 'covered' end as position
          from contract_position order by deliver_by`,
  },
  margin: { about: 'Average buy and sell price per tonne by grade over 30 days', sql: 'select * from grade_margin order by margin_cents_per_tonne nulls last, grade' },
  'seller-watch': { about: 'Sellers worth a second look: frequent copper, banned sellers, big public sellers', sql: 'select * from seller_watch order by copper_tickets_30d desc, seller' },
  compliance: { about: 'Records checked against the rules in docs/compliance.md', sql: 'select * from compliance_findings order by rule, due_on nulls last, record' },
  attention: {
    about: 'Everything held, unpaid, short, stale or in breach, one list',
    sql: `select * from (
            select 'compliance' as kind, rule || ' ' || record as record, detail, due_on, days_left from compliance_findings
            union all
            select 'unpaid', ticket, seller || ': $' || to_char(amount_cents / 100.0, 'FM999999990.00') || ' waiting ' || days_waiting || ' days', received_on, null::int
            from unpaid_tickets where days_waiting >= 2
            union all
            select 'contract', code, buyer || ', ' || grade || ': ' || remaining_t || ' t to ship, ' || in_yard_t || ' t in the yards', deliver_by, days_left
            from contract_position where remaining_t > in_yard_t
            union all
            select 'stale stock', site || ' ' || grade, on_hand_kg || ' kg not moved for ' || days_since_moved || ' days', null::date, null::int
            from yard_stock where on_hand_kg > 0 and days_since_moved >= 45
            union all
            select 'seller', seller_code, seller || ': ' || reason, last_ticket_on, null::int from seller_watch
            union all
            select 'price board', site || ' ' || grade, seller_kind || ' price unchanged for ' || days_old || ' days', effective_on, null::int
            from current_prices where days_old > 21
          ) a order by days_left nulls last, kind, record`,
  },
  'dealer-register': {
    about: 'The dealer record, one row per line, for --from to --to (default the last 30 days) and --site',
    sql: `select * from dealer_register
          where received_on between coalesce($1::date, current_date - 30) and coalesce($2::date, current_date)
            and ($3::text is null or lower(site) = lower($3))
          order by received_on, received_at, ticket`,
    params: (o) => [isoDate(o.from, 'from'), isoDate(o.to, 'to'), str(o.site)],
  },
  sellers: {
    about: 'Sellers, filtered by --kind=public|trade',
    sql: `select code, kind, name, business_name, phone, id_type, id_number, banned from sellers
          where ($1::text is null or kind = lower($1)) order by kind, name`,
    params: (o) => [str(o.kind)],
  },
  buyers: { about: 'Buyers and mills', sql: 'select code, name, country, contact, email from buyers order by code' },
  sites: { about: 'Yards with licence and expiry', sql: 'select code, name, country, state, licence_no, licence_expires_on, manager from sites order by code' },
  grades: { about: 'Grades with family and copper content', sql: 'select code, name, family, copper_pct, active from grades order by family, code' },
  audit: { about: 'Every change made through this CLI, newest first', sql: 'select entity, record_id, operation, actor, detail, created_at from audit_log order by id desc limit 200' },
  imports: { about: 'Imported files with fingerprint and row count', sql: 'select source, filename, row_count, actor, created_at from import_batches order by created_at desc' },
};

// ---------------------------------------------------------------- helpers

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (const a of argv) {
    if (a === '--help' || a === '-h') { pos.unshift('help'); continue; }
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq < 0) opts[a.slice(2)] = true;
    else opts[a.slice(2, eq)] = a.slice(eq + 1);
  }
  return { pos, opts };
}

export class UsageError extends Error {}
const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
const need = (o, ...keys) => {
  const missing = keys.filter((k) => o[k] === undefined || o[k] === true || o[k] === '');
  if (missing.length) throw new UsageError(`missing ${missing.map((k) => '--' + k).join(', ')}`);
};
function isoDate(v, name) {
  if (v === undefined || v === null || v === '' || v === true) return null;
  if (v === 'today') return today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new UsageError(`--${name} must be a date like 2026-11-16`);
  return String(v);
}
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function dollarsToCents(v, name) {
  if (v === undefined || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be an amount in dollars, like 380 or 11.50`);
  return Math.round(n * 100);
}
function kg(v, name) {
  if (v === undefined || v === '' || v === true) return null;
  const n = Number(String(v).replace(/[,\s]|kg$/gi, ''));
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a weight in kilograms`);
  return Math.round(n);
}
const oneOf = (v, allowed, name) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).toLowerCase().replace(/[\s-]+/g, '_');
  if (!allowed.includes(s)) throw new UsageError(`--${name} must be one of: ${allowed.join(', ')}`);
  return s;
};
const actorOf = (o) => (typeof o.actor === 'string' && o.actor) || process.env.SCRAP_ACTOR || process.env.USER || process.env.USERNAME || 'operator';
const dollars = (c) => (c === null || c === undefined ? '' : (Number(c) / 100).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const lineAmount = (netKg, centsPerTonne) => Math.round((netKg * centsPerTonne) / 1000);

async function audit(db, entity, recordId, operation, actor, detail) {
  await db.query('insert into audit_log (entity, record_id, operation, actor, detail) values ($1, $2, $3, $4, $5)', [entity, String(recordId), operation, actor, JSON.stringify(detail ?? {})]);
}

// Resolve one record by exact code, then a case-insensitive part of its name.
const lookups = {
  seller: { sql: 'select id, code, name, kind, banned from sellers', code: 'code', name: "name || ' ' || business_name" },
  site: { sql: 'select id, code, name, country, state from sites', code: 'code', name: 'name' },
  grade: { sql: 'select id, code, name, family, copper_pct from grades', code: 'code', name: 'name' },
  buyer: { sql: 'select id, code, name, email, contact from buyers', code: 'code', name: 'name' },
  contract: { sql: 'select id, code, code as name from contracts', code: 'code', name: 'notes' },
  ticket: { sql: 'select id, code, code as name, status from tickets', code: 'code', name: 'code' },
};
export async function resolve(db, kind, key) {
  if (!key || key === true) throw new UsageError(`name the ${kind}`);
  const l = lookups[kind];
  const exact = await db.query(`${l.sql} where lower(${l.code}) = lower($1)`, [String(key)]);
  if (exact.length === 1) return exact[0];
  const hits = await db.query(`${l.sql} where lower(${l.name}) like '%' || lower($1) || '%' or lower(${l.code}) like lower($1) || '%' order by 2 limit 20`, [String(key)]);
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new UsageError(`no ${kind} matches "${key}"`);
  throw new UsageError(`Ambiguous ${kind} "${key}": ${hits.map((h) => `${h.code} (${h.name})`).join(', ')}`);
}

function writeDraft(name, body) {
  const dir = path.resolve(REPO_ROOT, process.env.DRAFTS_DIR || 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today()}-${name}`);
  fs.writeFileSync(file, body);
  return path.relative(REPO_ROOT, file);
}

export function printRows(rows) {
  if (!rows.length) return '  (none)';
  const columns = Object.keys(rows[0])
    .filter((k) => k !== 'id')
    .map((key) => ({
      key,
      label: key.replace(/(^|_)cents_per_tonne$/, ' $/t').trim().replace(/_cents$/, ' $').replace(/_/g, ' '),
      align: typeof rows[0][key] === 'number' ? 'right' : 'left',
      width: 64,
      format: key.endsWith('_cents') || key.endsWith('cents_per_tonne') ? (v) => (v === null || v === undefined ? '' : (Number(v) / 100).toFixed(2))
        : (v) => (v === true ? 'yes' : v === false ? 'no' : typeof v === 'object' && v !== null ? JSON.stringify(v) : v),
    }));
  return textTable(rows, columns);
}

// The payment rules. NSW bans cash for scrap outright. Victoria bans it except for goods
// over 80% copper, which are second-hand goods. Sources: docs/compliance.md (R01).
async function cashAllowed(db, ticketId) {
  const lines = await db.query('select state, copper_pct, grade from line_detail where id in (select id from ticket_lines where ticket_id = $1)', [ticketId]);
  const [{ state }] = await db.query('select s.state from tickets t join sites s on s.id = t.site_id where t.id = $1', [ticketId]);
  if (state === 'NSW') return { ok: false, why: 'NSW bans cash for scrap metal (Scrap Metal Industry Act 2016 s 12). Pay by EFT or a cheque not payable to cash.' };
  if (state === 'VIC' && lines.some((l) => l.copper_pct <= 80)) {
    return { ok: false, why: 'Victoria bans cash for scrap metal; only goods over 80% copper are exempt (Consumer Affairs Victoria scrap metal laws). Pay by EFT or a non-transferable cheque.' };
  }
  return { ok: true };
}

async function boardPrice(db, siteId, gradeId, kind) {
  const [p] = await db.query(
    `select cents_per_tonne from buy_prices where site_id = $1 and grade_id = $2 and seller_kind = $3 and effective_on <= current_date
     order by effective_on desc limit 1`, [siteId, gradeId, kind]);
  return p?.cents_per_tonne ?? null;
}

async function insertLine(db, t, seller, o) {
  need(o, 'grade', 'gross');
  const g = await resolve(db, 'grade', o.grade);
  const gross = kg(o.gross, 'gross');
  const tare = kg(o.tare, 'tare') ?? 0;
  if (tare > gross) throw new UsageError('--tare is more than --gross');
  const price = dollarsToCents(o.price, 'price') ?? (await boardPrice(db, t.site_id, g.id, seller.kind));
  if (price === null) throw new UsageError(`no ${seller.kind} price on the board for ${g.code} at this yard; set one with set-price or pass --price`);
  if (g.family === 'vehicle' && !str(o.vin)) throw new UsageError('a vehicle needs its VIN or identifier (--vin) before you buy it');
  const [{ n }] = await db.query('select coalesce(max(line_no), 0) + 1 as n from ticket_lines where ticket_id = $1', [t.id]);
  const [row] = await db.query(
    `insert into ticket_lines (ticket_id, line_no, grade_id, description, gross_kg, tare_kg, cents_per_tonne, amount_cents, vehicle_vin, vehicle_rego, item_no, photo_taken)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning line_no, gross_kg, tare_kg, cents_per_tonne, amount_cents, item_no`,
    [t.id, n, g.id, o.desc || '', gross, tare, price, lineAmount(gross - tare, price), o.vin || '', o.vrego || '', o.item || '', o.photo === true],
  );
  return { grade: g.code, ...row };
}

// ---------------------------------------------------------------- writes and documents

const SELLER_KIND = ['public', 'trade'];
const PAY = ['eft', 'cheque', 'cash'];
const FAMILY = ['ferrous', 'non_ferrous', 'copper', 'vehicle', 'battery'];

export const commands = {
  seller: {
    about: 'One seller: profile, ID, recent tickets, copper, notes',
    usage: 'seller <code or name>',
    async run(db, [key]) {
      const s = await resolve(db, 'seller', key);
      const [profile] = await db.query('select code, kind, name, business_name, business_no, address, phone, email, date_of_birth, id_type, id_number, id_expires_on, banned, notes from sellers where id = $1', [s.id]);
      return {
        profile,
        tickets: await db.query('select code, site, received_on, lines, net_kg, amount_cents, status, payment_method from ticket_summary where seller_code = $1 order by received_on desc limit 10', [s.code]),
        watch: await db.query('select tickets_30d, copper_tickets_30d, copper_kg_30d, paid_30d_cents, reason from seller_watch where seller_code = $1', [s.code]),
        notes: await db.query('select noted_on, kind, body, actor from seller_notes where seller_id = $1 order by noted_on desc, created_at desc limit 10', [s.id]),
      };
    },
  },
  ticket: {
    about: 'One ticket with every line, hold and payment',
    usage: 'ticket <code>',
    async run(db, [key]) {
      const t = await resolve(db, 'ticket', key);
      const [head] = await db.query('select code, site, received_on, seller, seller_kind, net_kg, amount_cents, status, payment_method, payment_ref, paid_on, operator from ticket_summary where id = $1', [t.id]);
      return {
        ticket: head,
        lines: await db.query('select line_no, grade, gross_kg, tare_kg, net_kg, cents_per_tonne, amount_cents, vehicle_vin, item_no, hold_until, released_on from line_detail where ticket = $1 order by line_no', [t.code]),
      };
    },
  },
  'add-seller': {
    about: 'Add a seller with the ID the law asks for',
    usage: 'add-seller --code=P20 --name= [--kind=public|trade] [--business=] [--business-no=] --address= [--phone=] [--email=] [--dob=YYYY-MM-DD] --id-type= --id-number= [--id-expires=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'code', 'name', 'address', 'id-type', 'id-number');
      const [row] = await db.query(
        `insert into sellers (code, kind, name, business_name, business_no, address, phone, email, date_of_birth, id_type, id_number, id_expires_on)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning code, kind, name, id_type, id_number`,
        [o.code, oneOf(o.kind, SELLER_KIND, 'kind') || 'public', o.name, o.business || '', o['business-no'] || '', o.address, o.phone || '', o.email || '', isoDate(o.dob, 'dob'), o['id-type'], o['id-number'], isoDate(o['id-expires'], 'id-expires')],
      );
      await audit(db, 'seller', row.code, 'insert', actorOf(o), row);
      return [row];
    },
  },
  'update-seller': {
    about: 'Record ID, address or date of birth, or ban or unban a seller',
    usage: 'update-seller <seller> [--address=] [--dob=] [--id-type=] [--id-number=] [--id-expires=] [--phone=] [--ban --reason=] [--unban]',
    async run(db, [key], o) {
      const s = await resolve(db, 'seller', key);
      if (o.ban === true) need(o, 'reason');
      const [before] = await db.query('select address, date_of_birth, id_type, id_number, banned from sellers where id = $1', [s.id]);
      const banned = o.ban === true ? true : o.unban === true ? false : null;
      const [after] = await db.query(
        `update sellers set address = coalesce($2, address), date_of_birth = coalesce($3::date, date_of_birth), id_type = coalesce($4, id_type),
           id_number = coalesce($5, id_number), id_expires_on = coalesce($6::date, id_expires_on), phone = coalesce($7, phone),
           banned = coalesce($8, banned), notes = case when $9::text is null then notes else trim(notes || ' ' || $9) end
         where id = $1 returning code, name, address, date_of_birth, id_type, id_number, banned`,
        [s.id, str(o.address), isoDate(o.dob, 'dob'), str(o['id-type']), str(o['id-number']), isoDate(o['id-expires'], 'id-expires'), str(o.phone), banned, str(o.reason)],
      );
      if (banned !== null) {
        await db.query('insert into seller_notes (seller_id, kind, body, actor) values ($1, $2, $3, $4)', [s.id, 'note', banned ? `Banned: ${o.reason}` : 'Ban lifted', actorOf(o)]);
      }
      await audit(db, 'seller', s.code, banned === true ? 'ban' : banned === false ? 'unban' : 'update', actorOf(o), { before, after });
      return [after];
    },
  },
  'add-ticket': {
    about: 'Open a weigh ticket for a seller at a yard, with its first line',
    usage: 'add-ticket --code=T-5001 --site= --seller= [--rego=] [--operator=] [--signed] --grade= --gross= [--tare=] [--price=dollars per tonne] [--vin=] [--vrego=] [--item=] [--photo] [--desc=]',
    async run(db, _p, o) {
      need(o, 'code', 'site', 'seller');
      const site = await resolve(db, 'site', o.site);
      const seller = await resolve(db, 'seller', o.seller);
      if (seller.banned) throw new UsageError(`${seller.name} is banned. Do not buy. See: npm run scrap -- seller ${seller.code}`);
      const [id] = await db.query('select id_type, id_number, address from sellers where id = $1', [seller.id]);
      if (!id.id_type || !id.id_number || !id.address) throw new UsageError(`record ${seller.name}'s ID and address first: update-seller ${seller.code} --id-type= --id-number= --address=`);
      await db.exec('BEGIN');
      try {
        const [t] = await db.query(
          `insert into tickets (code, site_id, seller_id, seller_vehicle_rego, operator, seller_signed) values ($1,$2,$3,$4,$5,$6) returning id, code, site_id, received_on`,
          [o.code, site.id, seller.id, o.rego || '', o.operator || actorOf(o), o.signed === true],
        );
        const line = o.grade ? await insertLine(db, t, seller, o) : null;
        await audit(db, 'ticket', t.code, 'insert', actorOf(o), { site: site.code, seller: seller.code, line });
        await db.exec('COMMIT');
        return [{ ticket: t.code, site: site.code, seller: seller.name, ...(line || {}) }];
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  },
  'add-line': {
    about: 'Add a weighed line to an open ticket at the board price (or --price)',
    usage: 'add-line <ticket> --grade= --gross= [--tare=] [--price=] [--vin=] [--vrego=] [--item=] [--photo] [--desc=]',
    async run(db, [key], o) {
      const tk = await resolve(db, 'ticket', key);
      if (tk.status !== 'open') throw new UsageError(`${tk.code} is ${tk.status}; open a new ticket`);
      const [t] = await db.query('select id, code, site_id, seller_id from tickets where id = $1', [tk.id]);
      const [seller] = await db.query('select id, kind from sellers where id = $1', [t.seller_id]);
      const line = await insertLine(db, t, seller, o);
      await audit(db, 'ticket', t.code, 'add-line', actorOf(o), line);
      return [{ ticket: t.code, ...line }];
    },
  },
  pay: {
    about: 'Mark a ticket paid by EFT, cheque or cash (cash refused where the law bans it)',
    usage: 'pay <ticket> --method=eft|cheque|cash [--ref=] [--on=YYYY-MM-DD]',
    async run(db, [key], o) {
      need(o, 'method');
      const tk = await resolve(db, 'ticket', key);
      if (tk.status !== 'open') throw new UsageError(`${tk.code} is already ${tk.status}`);
      const method = oneOf(o.method, PAY, 'method');
      const [{ n }] = await db.query('select count(*)::int as n from ticket_lines where ticket_id = $1', [tk.id]);
      if (!n) throw new UsageError(`${tk.code} has no lines to pay for`);
      if (method === 'cash') {
        const c = await cashAllowed(db, tk.id);
        if (!c.ok) throw new UsageError(c.why);
      }
      const [row] = await db.query(
        `update tickets set status = 'paid', payment_method = $2, payment_ref = $3, paid_on = coalesce($4::date, current_date) where id = $1
         returning code, status, payment_method, payment_ref, paid_on`, [tk.id, method, o.ref || '', isoDate(o.on, 'on')]);
      await audit(db, 'ticket', tk.code, 'pay', actorOf(o), row);
      return [row];
    },
  },
  void: {
    about: 'Void a ticket with a reason (it stays on record)',
    usage: 'void <ticket> --reason=',
    async run(db, [key], o) {
      need(o, 'reason');
      const tk = await resolve(db, 'ticket', key);
      if (tk.status === 'paid') throw new UsageError(`${tk.code} is paid; reverse the payment first`);
      const [row] = await db.query("update tickets set status = 'void', void_reason = $2 where id = $1 returning code, status, void_reason", [tk.id, o.reason]);
      await audit(db, 'ticket', tk.code, 'void', actorOf(o), row);
      return [row];
    },
  },
  release: {
    about: 'Release a held line for cutting, baling or sale (refused while the hold runs)',
    usage: 'release <ticket>[/<line>] [--on=YYYY-MM-DD]',
    async run(db, [key], o) {
      const [code, lineNo] = String(key || '').split('/');
      const tk = await resolve(db, 'ticket', code);
      const on = isoDate(o.on, 'on') || today();
      const lines = await db.query('select id, line_no, grade, hold_until, released_on from line_detail where ticket = $1 and ($2::int is null or line_no = $2) order by line_no', [tk.code, lineNo ? Number(lineNo) : null]);
      if (!lines.length) throw new UsageError(`no line ${lineNo} on ${tk.code}`);
      const out = [];
      for (const l of lines) {
        if (l.released_on) { out.push({ line_no: l.line_no, grade: l.grade, result: `already released ${l.released_on}` }); continue; }
        if (l.hold_until && on < l.hold_until) throw new UsageError(`${tk.code}/${l.line_no} (${l.grade}) is on hold until ${l.hold_until}. See docs/compliance.md R04 and R05.`);
        await db.query('update ticket_lines set released_on = $2 where id = $1', [l.id, on]);
        out.push({ line_no: l.line_no, grade: l.grade, result: `released ${on}` });
      }
      await audit(db, 'ticket', tk.code, 'release', actorOf(o), out);
      return out.map((r) => ({ ticket: tk.code, ...r }));
    },
  },
  'set-price': {
    about: 'Change the board price for a grade at a yard',
    usage: 'set-price --site= --grade= --price=<dollars per tonne> [--kind=public|trade] [--from=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'site', 'grade', 'price');
      const site = await resolve(db, 'site', o.site);
      const g = await resolve(db, 'grade', o.grade);
      const kind = oneOf(o.kind, SELLER_KIND, 'kind') || 'public';
      const [row] = await db.query(
        `insert into buy_prices (site_id, grade_id, seller_kind, cents_per_tonne, effective_on, set_by) values ($1,$2,$3,$4,coalesce($5::date, current_date),$6)
         on conflict (site_id, grade_id, seller_kind, effective_on) do update set cents_per_tonne = excluded.cents_per_tonne, set_by = excluded.set_by
         returning seller_kind, cents_per_tonne, effective_on`, [site.id, g.id, kind, dollarsToCents(o.price, 'price'), isoDate(o.from, 'from'), actorOf(o)]);
      await audit(db, 'price', `${site.code}/${g.code}`, 'set', actorOf(o), row);
      return [{ site: site.code, grade: g.code, ...row }];
    },
  },
  'add-grade': {
    about: 'Add a grade to the board',
    usage: 'add-grade --code= --name= --family=ferrous|non_ferrous|copper|vehicle|battery [--copper=0-100]',
    async run(db, _p, o) {
      need(o, 'code', 'name', 'family');
      const pct = o.copper ? Number(o.copper) : 0;
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) throw new UsageError('--copper must be a whole percentage');
      const [row] = await db.query('insert into grades (code, name, family, copper_pct) values ($1,$2,$3,$4) returning code, name, family, copper_pct', [String(o.code).toUpperCase(), o.name, oneOf(o.family, FAMILY, 'family'), pct]);
      await audit(db, 'grade', row.code, 'insert', actorOf(o), row);
      return [row];
    },
  },
  'add-contract': {
    about: 'Record a sale contract with a buyer or mill',
    usage: 'add-contract --code= --buyer= --grade= --tonnes= --price=<per tonne> --deliver-by=YYYY-MM-DD [--currency=NZD] [--notes=]',
    async run(db, _p, o) {
      need(o, 'code', 'buyer', 'grade', 'tonnes', 'price', 'deliver-by');
      const b = await resolve(db, 'buyer', o.buyer);
      const g = await resolve(db, 'grade', o.grade);
      const tonnes = Number(o.tonnes);
      if (!Number.isFinite(tonnes) || tonnes <= 0) throw new UsageError('--tonnes must be more than 0');
      const [row] = await db.query(
        `insert into contracts (code, buyer_id, grade_id, tonnes, cents_per_tonne, currency, deliver_by, notes) values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning code, tonnes, cents_per_tonne, currency, deliver_by`,
        [o.code, b.id, g.id, tonnes, dollarsToCents(o.price, 'price'), String(o.currency || 'NZD').toUpperCase(), isoDate(o['deliver-by'], 'deliver-by'), o.notes || '']);
      await audit(db, 'contract', row.code, 'insert', actorOf(o), row);
      return [{ buyer: b.name, grade: g.code, ...row }];
    },
  },
  'add-load': {
    about: 'Record a truck or container leaving a yard (refused if the yard does not hold that much)',
    usage: 'add-load --code= --site= --buyer= --grade= --kg= --price=<per tonne> [--contract=] [--container=] [--seal=] [--on=YYYY-MM-DD]',
    async run(db, _p, o) {
      need(o, 'code', 'site', 'buyer', 'grade', 'kg', 'price');
      const site = await resolve(db, 'site', o.site);
      const b = await resolve(db, 'buyer', o.buyer);
      const g = await resolve(db, 'grade', o.grade);
      const c = o.contract ? await resolve(db, 'contract', o.contract) : null;
      const weight = kg(o.kg, 'kg');
      const [stock] = await db.query('select on_hand_kg from yard_stock where site = $1 and grade = $2', [site.code, g.code]);
      if (!stock || stock.on_hand_kg < weight) throw new UsageError(`${site.code} holds ${stock?.on_hand_kg ?? 0} kg of ${g.code}, less than ${weight} kg`);
      const price = dollarsToCents(o.price, 'price');
      const [row] = await db.query(
        `insert into loads (code, site_id, buyer_id, contract_id, grade_id, shipped_on, container_no, seal_no, net_kg, cents_per_tonne, amount_cents)
         values ($1,$2,$3,$4,$5,coalesce($6::date, current_date),$7,$8,$9,$10,$11) returning code, shipped_on, net_kg, cents_per_tonne, amount_cents, container_no`,
        [o.code, site.id, b.id, c?.id ?? null, g.id, isoDate(o.on, 'on'), o.container || '', o.seal || '', weight, price, lineAmount(weight, price)]);
      if (c) {
        const [pos] = await db.query('select remaining_t from contract_position where code = $1', [c.code]);
        if (pos && Number(pos.remaining_t) <= 0) await db.query("update contracts set status = 'filled' where id = $1", [c.id]);
      }
      await audit(db, 'load', row.code, 'insert', actorOf(o), { site: site.code, buyer: b.code, contract: c?.code ?? null, ...row });
      return [{ site: site.code, buyer: b.name, grade: g.code, contract: c?.code ?? null, ...row }];
    },
  },
  log: {
    about: 'Log a note, call, visit, email or police enquiry against a seller',
    usage: 'log <seller> --body="..." [--kind=note|call|visit|email|police] [--on=YYYY-MM-DD]',
    async run(db, [key], o) {
      need(o, 'body');
      const s = await resolve(db, 'seller', key);
      const [row] = await db.query(
        'insert into seller_notes (seller_id, kind, body, actor, noted_on) values ($1,$2,$3,$4,coalesce($5::date, current_date)) returning noted_on, kind, body',
        [s.id, oneOf(o.kind, ['note', 'call', 'visit', 'email', 'police'], 'kind') || 'note', o.body, actorOf(o), isoDate(o.on, 'on')]);
      await audit(db, 'seller_note', s.code, 'insert', actorOf(o), row);
      return [{ seller: s.name, ...row }];
    },
  },
  import: {
    about: 'Import tickets from a ScrapRight (or any yard system) ticket CSV, or a seller list',
    usage: 'import scrapright <tickets.csv> --site= [--unit=kg|lb] [--mapping=map.json] [--dry-run]\n         import sellers <sellers.csv> [--dry-run]',
    async run(db, [kind, file], o) {
      if (!['scrapright', 'tickets', 'sellers'].includes(kind)) throw new UsageError('import scrapright <file> --site= or import sellers <file>');
      if (!file || !fs.existsSync(file)) throw new UsageError(`file not found: ${file}`);
      const bytes = fs.readFileSync(file);
      const fingerprint = createHash('sha256').update(bytes).digest('hex');
      const rows = parseCsv(bytes.toString('utf8'));
      const seen = await db.query('select filename from import_batches where fingerprint = $1', [fingerprint]);
      if (seen.length) return [{ result: 'skipped', reason: `identical file already imported as ${seen[0].filename}`, rows: rows.length }];
      const dry = o['dry-run'] === true;
      await db.exec('BEGIN');
      try {
        const result = kind === 'sellers' ? await importSellers(db, rows) : await importTickets(db, rows, o);
        if (dry) {
          await db.exec('ROLLBACK');
          return [{ result: 'dry run, nothing saved', rows: rows.length, ...result }];
        }
        await db.query('insert into import_batches (source, filename, fingerprint, row_count, actor) values ($1,$2,$3,$4,$5)', [kind, path.basename(file), fingerprint, rows.length, actorOf(o)]);
        await audit(db, 'import', path.basename(file), kind, actorOf(o), result);
        await db.exec('COMMIT');
        return [{ result: 'imported', rows: rows.length, ...result }];
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  },
  export: {
    about: 'Write every table to CSV and JSON in a new folder',
    usage: 'export [--out=exports/2026-11-16]',
    async run(db, _p, o) {
      const out = path.resolve(REPO_ROOT, typeof o.out === 'string' ? o.out : path.join('exports', new Date().toISOString().replace(/[:.]/g, '-')));
      if (fs.existsSync(out) && fs.readdirSync(out).length) throw new UsageError(`${out} is not empty`);
      fs.mkdirSync(out, { recursive: true, mode: 0o700 });
      const manifest = [];
      for (const t of TABLES) {
        const rows = await db.query(`select * from ${t}`);
        fs.writeFileSync(path.join(out, `${t}.json`), JSON.stringify(rows, null, 2));
        fs.writeFileSync(path.join(out, `${t}.csv`), toCsv(rows));
        manifest.push({ table: t, rows: rows.length });
      }
      fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ exported_at: new Date().toISOString(), tables: manifest }, null, 2));
      return manifest.map((m) => ({ ...m, folder: path.relative(REPO_ROOT, out) }));
    },
  },
  'weekly-review': {
    about: 'Write the Monday review: compliance, money waiting, holds, stock, contracts, margins',
    usage: 'weekly-review',
    async run(db) {
      const results = [];
      for (const name of ['compliance', 'unpaid', 'held', 'contracts', 'stale-stock', 'margin', 'seller-watch']) results.push(await db.query(reads[name].sql));
      const [findings, unpaid, held, contracts, stale, margin, watch] = results;
      const owed = unpaid.reduce((s, r) => s + Number(r.amount_cents || 0), 0);
      const lines = [
        `# Weekly review, ${today()}`,
        '',
        '## Compliance',
        ...(findings.length ? findings.map((f) => `- ${f.rule} ${f.record}: ${f.detail}. ${f.source}.`) : ['- Nothing breached.']),
        '',
        '## Money waiting',
        `- ${unpaid.length} tickets weighed and not paid, $${dollars(owed)} between them.`,
        ...unpaid.map((u) => `  - ${u.ticket} at ${u.site}: ${u.seller}, $${dollars(u.amount_cents)}, ${u.days_waiting} days.`),
        '',
        '## Holds',
        ...(held.length ? held.map((h) => `- ${h.ticket}/${h.line_no} ${h.grade} (${h.net_kg} kg) at ${h.site}: ${h.state_now}, hold ends ${h.hold_until}.`) : ['- Nothing on hold.']),
        '',
        '## Contracts',
        ...contracts.map((c) => `- ${c.code} ${c.buyer}, ${c.grade}: ${c.remaining_t} t to ship by ${c.deliver_by} (${c.days_left} days), ${c.in_yard_t} t in the yards. ${c.position}.`),
        '',
        '## Stock and margin',
        ...stale.map((s) => `- ${s.site} ${s.grade}: ${s.on_hand_kg} kg not moved for ${s.days_since_moved} days, $${dollars(s.cost_tied_up_cents)} tied up.`),
        ...margin.filter((m) => m.margin_cents_per_tonne !== null).map((m) => `- ${m.grade}: bought at $${dollars(m.avg_buy_cents_per_tonne)}/t, sold at $${dollars(m.avg_sell_cents_per_tonne)}/t, margin $${dollars(m.margin_cents_per_tonne)}/t.`),
        '',
        '## Sellers to look at',
        ...(watch.length ? watch.map((w) => `- ${w.seller} (${w.seller_code}): ${w.reason}.`) : ['- None.']),
        '',
        'Draft only. Check each compliance row against the ticket before acting on it.',
      ];
      const file = writeDraft('weekly-review.md', lines.join('\n') + '\n');
      return [{ draft: file, findings: findings.length, unpaid: unpaid.length, on_hold: held.length, contracts: contracts.length }];
    },
  },
  'draft-register': {
    about: 'Write the dealer register for a date range as CSV to drafts/, ready for a police inspection',
    usage: 'draft-register [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--site=]',
    async run(db, _p, o) {
      const r = reads['dealer-register'];
      const rows = await db.query(r.sql, r.params(o));
      const file = writeDraft(`dealer-register${o.site ? '-' + String(o.site).toLowerCase() : ''}.csv`, toCsv(rows));
      return [{ draft: file, lines: rows.length }];
    },
  },
  'draft-statement': {
    about: 'Write a purchase statement for a trade seller (default the last 30 days)',
    usage: 'draft-statement <seller> [--days=30]',
    async run(db, [key], o) {
      const s = await resolve(db, 'seller', key);
      const [p] = await db.query('select name, business_name, business_no, address, email, kind from sellers where id = $1', [s.id]);
      if (p.kind !== 'trade') throw new UsageError(`${p.name} is a public seller; statements are for trade accounts`);
      const days = Number(o.days || 30);
      const lines = await db.query('select ticket, received_on, site, grade_name, net_kg, cents_per_tonne, amount_cents, status, payment_method from line_detail where seller_code = $1 and received_on >= current_date - $2::int order by received_on, ticket, line_no', [s.code, days]);
      const total = lines.reduce((a, l) => a + Number(l.amount_cents), 0);
      const open = lines.filter((l) => l.status === 'open').reduce((a, l) => a + Number(l.amount_cents), 0);
      const body = [
        `To: ${p.email}`,
        `Subject: Purchase statement, ${p.business_name || p.name}, last ${days} days`,
        '',
        `${p.business_name || p.name}${p.business_no ? ` (${p.business_no})` : ''}`,
        p.address,
        '',
        '| Date | Ticket | Yard | Grade | Net kg | $/t | Amount | Paid |',
        '|---|---|---|---|---:|---:|---:|---|',
        ...lines.map((l) => `| ${l.received_on} | ${l.ticket} | ${l.site} | ${l.grade_name} | ${l.net_kg} | ${dollars(l.cents_per_tonne)} | ${dollars(l.amount_cents)} | ${l.status === 'paid' ? l.payment_method.toUpperCase() : 'to pay'} |`),
        '',
        `Total bought: $${dollars(total)}. Still to pay: $${dollars(open)}.`,
        '',
        'Thanks for your business. Reply to this email with any query about a ticket.',
      ].join('\n');
      return [{ draft: writeDraft(`statement-${s.code}.md`, body + '\n'), lines: lines.length, total_cents: total, open_cents: open }];
    },
  },
  'draft-price-list': {
    about: 'Write the trade price list email for a yard from the current board',
    usage: 'draft-price-list --site=',
    async run(db, _p, o) {
      need(o, 'site');
      const site = await resolve(db, 'site', o.site);
      const prices = await db.query("select grade_name, cents_per_tonne, effective_on from current_prices where site = $1 and seller_kind = 'trade' order by family, grade", [site.code]);
      const body = [
        `Subject: ${site.name} trade prices from ${today()}`,
        '',
        `Our trade buy prices at ${site.name}, per tonne:`,
        '',
        ...prices.map((p) => `- ${p.grade_name}: $${dollars(p.cents_per_tonne)}`),
        '',
        'Prices move with the market and are confirmed on the weighbridge ticket. Bring photo ID on every visit.',
      ].join('\n');
      return [{ draft: writeDraft(`price-list-${site.code}.md`, body + '\n'), grades: prices.length }];
    },
  },
  'draft-buyer-update': {
    about: 'Write an email to a buyer on where their contract stands',
    usage: 'draft-buyer-update <contract>',
    async run(db, [key]) {
      const c = await resolve(db, 'contract', key);
      const [pos] = await db.query('select * from contract_position where code = $1', [c.code]);
      if (!pos) throw new UsageError(`${c.code} is not open`);
      const [b] = await db.query('select b.email, b.contact from contracts k join buyers b on b.id = k.buyer_id where k.id = $1', [c.id]);
      const loads = await db.query('select l.code, l.shipped_on, l.container_no, l.seal_no, l.net_kg from loads l where l.contract_id = $1 order by l.shipped_on', [c.id]);
      const body = [
        `To: ${b.email}`,
        `Subject: Contract ${pos.code}, ${pos.grade} shipping position`,
        '',
        `Hi ${String(b.contact).split(' ')[0]},`,
        '',
        `Contract ${pos.code} for ${pos.tonnes} t of ${pos.grade}: ${pos.shipped_t} t shipped, ${pos.remaining_t} t to go by ${pos.deliver_by}.`,
        '',
        ...loads.map((l) => `- ${l.shipped_on}: ${l.code}${l.container_no ? `, container ${l.container_no}, seal ${l.seal_no}` : ''}, ${l.net_kg} kg`),
        '',
        '[Yard manager: add the next load date before sending.]',
        '',
        Number(pos.remaining_t) > Number(pos.in_yard_t) ? `Office note, delete before sending: only ${pos.in_yard_t} t is in the yards today.` : '',
      ].join('\n');
      return [{ draft: writeDraft(`buyer-update-${pos.code}.md`, body + '\n'), remaining_t: pos.remaining_t, in_yard_t: pos.in_yard_t }];
    },
  },
  help: {
    about: 'This list',
    usage: 'help',
    async run() {
      return [...Object.entries(reads).map(([name, r]) => ({ command: name, does: r.about })), ...Object.entries(commands).map(([name, c]) => ({ command: name, does: c.about }))];
    },
  },
};

export const commandNames = [...Object.keys(reads), ...Object.keys(commands)];
const TABLES = ['sites', 'sellers', 'grades', 'buy_prices', 'tickets', 'ticket_lines', 'buyers', 'contracts', 'loads', 'seller_notes', 'import_batches', 'audit_log'];

// ---------------------------------------------------------------- import helpers

// Column names yard systems use in their ticket exports. Add your own with --mapping.
const TICKET_MAP = {
  ticket: ['Ticket #', 'Ticket Number', 'Ticket No', 'Ticket', 'ticket'],
  date: ['Ticket Date', 'Date', 'Date In', 'date'],
  seller: ['Customer', 'Customer Name', 'Seller', 'Name', 'seller'],
  business: ['Company', 'Business Name', 'business'],
  kind: ['Customer Type', 'Type', 'kind'],
  address: ['Address', 'Customer Address', 'address'],
  dob: ['DOB', 'Date of Birth', 'Birth Date', 'dob'],
  id_type: ['ID Type', 'Identification Type', 'id_type'],
  id_number: ['ID Number', 'ID #', 'License Number', 'Licence Number', 'id_number'],
  material: ['Material', 'Commodity', 'Grade', 'Item', 'material'],
  gross: ['Gross', 'Gross Weight', 'gross'],
  tare: ['Tare', 'Tare Weight', 'tare'],
  net: ['Net', 'Net Weight', 'net'],
  amount: ['Amount', 'Extended', 'Total', 'Line Total', 'amount'],
  price: ['Price', 'Unit Price', 'price'],
  payment: ['Payment Type', 'Paid By', 'Payment', 'payment'],
  ref: ['Check #', 'Cheque No', 'Reference', 'ref'],
  vin: ['VIN', 'Vehicle VIN', 'vin'],
  vrego: ['Plate', 'Vehicle Rego', 'Rego', 'vrego'],
};

function normDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // day first, as NZ and AU write it
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  throw new UsageError(`cannot read the date "${s}"; use YYYY-MM-DD or DD/MM/YYYY`);
}
const num = (v) => {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new UsageError(`cannot read the number "${v}"`);
  return n;
};
function guessFamily(name) {
  const s = name.toLowerCase();
  if (/insul|cable/.test(s)) return ['copper', 40];
  if (/copper|cu\b|#1|#2|bare bright/.test(s)) return ['copper', 94];
  if (/brass|bronze/.test(s)) return ['non_ferrous', 65];
  if (/car|vehicle|auto body|elv/.test(s)) return ['vehicle', 0];
  if (/batter/.test(s)) return ['battery', 0];
  if (/alum|stainless|lead|zinc|nickel|ss\b/.test(s)) return ['non_ferrous', 0];
  return ['ferrous', 0];
}
const slugCode = (s, n = 10) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, n) || 'X';
async function uniqueCode(db, table, base) {
  for (let i = 1; ; i++) {
    const code = i === 1 ? base : `${base}${i}`;
    if (!(await db.query(`select 1 from ${table} where code = $1`, [code])).length) return code;
  }
}
const normPay = (v) => {
  const s = String(v || '').toLowerCase();
  if (!s) return 'none';
  if (/cash/.test(s)) return 'cash';
  if (/cheque|check/.test(s)) return 'cheque';
  return 'eft';
};

async function findOrAddSeller(db, row, get, counts) {
  const name = get(row, 'seller');
  if (!name) throw new UsageError('every row needs a customer or seller name');
  const [hit] = await db.query('select id, kind from sellers where lower(name) = lower($1)', [name]);
  if (hit) return hit;
  const business = get(row, 'business');
  const kind = /trade|commercial|business|account/i.test(get(row, 'kind')) || business ? 'trade' : 'public';
  const [s] = await db.query(
    `insert into sellers (code, kind, name, business_name, address, date_of_birth, id_type, id_number, external_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, kind`,
    [await uniqueCode(db, 'sellers', 'S' + slugCode(name, 6)), kind, name, business, get(row, 'address'), normDate(get(row, 'dob')), get(row, 'id_type'), get(row, 'id_number'), JSON.stringify({ source: 'import' })]);
  counts.sellers_added++;
  return s;
}

async function importTickets(db, rows, o) {
  need(o, 'site');
  const site = await resolve(db, 'site', o.site);
  const unit = String(o.unit || 'kg').toLowerCase();
  if (!['kg', 'lb'].includes(unit)) throw new UsageError('--unit must be kg or lb');
  const toKg = (v) => (v === null ? null : Math.round(unit === 'lb' ? v * 0.45359237 : v));
  let map = TICKET_MAP;
  if (typeof o.mapping === 'string') {
    const custom = JSON.parse(fs.readFileSync(o.mapping, 'utf8'));
    map = { ...TICKET_MAP, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])) };
  }
  const get = (row, field) => pick(row, ...map[field]);
  const counts = { tickets_added: 0, lines_added: 0, sellers_added: 0, grades_added: 0, total_cents: 0 };
  const tickets = new Map();
  for (const [i, row] of rows.entries()) {
    const code = get(row, 'ticket');
    if (!code) throw new UsageError(`row ${i + 2}: ticket number is required`);
    const material = get(row, 'material');
    if (!material) throw new UsageError(`row ${i + 2}: material is required`);
    let t = tickets.get(code);
    if (!t) {
      if ((await db.query('select 1 from tickets where code = $1', [code])).length) throw new UsageError(`row ${i + 2}: ticket ${code} is already in the database`);
      const seller = await findOrAddSeller(db, row, get, counts);
      const pay = normPay(get(row, 'payment'));
      const on = normDate(get(row, 'date')) || today();
      [t] = await db.query(
        `insert into tickets (code, site_id, seller_id, received_on, status, payment_method, payment_ref, paid_on, seller_signed, external_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true,$9) returning id`,
        [code, site.id, seller.id, on, pay === 'none' ? 'open' : 'paid', pay, get(row, 'ref'), pay === 'none' ? null : on, JSON.stringify(row)]);
      t.lines = 0;
      tickets.set(code, t);
      counts.tickets_added++;
    }
    let [g] = await db.query('select id from grades where lower(code) = lower($1) or lower(name) = lower($1)', [material]);
    if (!g) {
      const [family, pct] = guessFamily(material);
      [g] = await db.query('insert into grades (code, name, family, copper_pct) values ($1,$2,$3,$4) returning id', [await uniqueCode(db, 'grades', slugCode(material, 8)), material, family, pct]);
      counts.grades_added++;
    }
    const gross = toKg(num(get(row, 'gross')));
    const tare = toKg(num(get(row, 'tare'))) ?? 0;
    const net = toKg(num(get(row, 'net'))) ?? (gross !== null ? gross - tare : null);
    if (net === null || net < 0) throw new UsageError(`row ${i + 2}: needs a net weight, or gross and tare`);
    const amountCents = num(get(row, 'amount')) !== null ? Math.round(num(get(row, 'amount')) * 100) : null;
    const unitPrice = num(get(row, 'price'));
    const perTonne = amountCents !== null ? (net > 0 ? Math.round((amountCents * 1000) / net) : 0) : unitPrice !== null ? Math.round(unitPrice * 100 * (unit === 'lb' ? 2204.62262 : 1000)) : null;
    if (perTonne === null) throw new UsageError(`row ${i + 2}: needs an amount or a unit price`);
    // A unit price is applied to the weight as the export states it, so pounds stay exact.
    const netUnits = num(get(row, 'net')) ?? (num(get(row, 'gross')) !== null ? num(get(row, 'gross')) - (num(get(row, 'tare')) ?? 0) : null);
    const amount = amountCents ?? Math.round(netUnits * unitPrice * 100);
    t.lines++;
    await db.query(
      `insert into ticket_lines (ticket_id, line_no, grade_id, description, gross_kg, tare_kg, cents_per_tonne, amount_cents, vehicle_vin, vehicle_rego)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [t.id, t.lines, g.id, material, gross ?? net + tare, gross !== null ? tare : 0, perTonne, amount, get(row, 'vin'), get(row, 'vrego')]);
    counts.lines_added++;
    counts.total_cents += amount;
  }
  return counts;
}

async function importSellers(db, rows) {
  const get = (row, field) => pick(row, ...TICKET_MAP[field]);
  const counts = { sellers_added: 0, sellers_already_there: 0 };
  for (const row of rows) {
    const name = get(row, 'seller');
    if (!name) throw new UsageError('every row needs a customer or seller name');
    if ((await db.query('select 1 from sellers where lower(name) = lower($1)', [name])).length) { counts.sellers_already_there++; continue; }
    await findOrAddSeller(db, row, get, counts);
  }
  return counts;
}

function toCsv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------- run

export async function run(db, argv) {
  const { pos, opts } = parseArgs(argv);
  const [name = 'help', ...rest] = pos;
  if (reads[name]) {
    const r = reads[name];
    return db.query(r.sql, r.params ? r.params(opts) : []);
  }
  if (commands[name]) return commands[name].run(db, rest, opts);
  throw new UsageError(`unknown command "${name}". Try: help`);
}

function render(name, result, asJson) {
  if (asJson) return JSON.stringify(result, null, 2);
  if (name === 'help') {
    return 'Scrap Yard for Claude Code\n\n  npm run scrap -- <command> [options] [--json]\n\n' + printRows(result) + '\n\nUsage for a command: npm run scrap -- usage <command>';
  }
  if (Array.isArray(result)) return printRows(result);
  return Object.entries(result).map(([k, v]) => `${k.toUpperCase()}\n${Array.isArray(v) ? printRows(v) : printRows([v])}`).join('\n\n');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const args = argv.filter((a) => a !== '--json');
  if (args[0] === 'usage') {
    const c = commands[args[1]];
    console.log(c ? `npm run scrap -- ${c.usage}` : reads[args[1]] ? `npm run scrap -- ${args[1]} [--json]   ${reads[args[1]].about}` : 'unknown command');
    process.exit(c || reads[args[1]] ? 0 : 1);
  }
  const db = await getDb();
  try {
    const result = await run(db, args);
    console.log(render(args.find((a) => !a.startsWith('--')) || 'help', result, asJson));
  } catch (error) {
    console.error(error instanceof UsageError ? `scrap: ${error.message}` : error.stack || error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
