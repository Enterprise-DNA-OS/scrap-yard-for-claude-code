-- Scrap Yard for Claude Code: the schema.
-- Yards, sellers, grades, buy prices, weigh tickets, copper holds, buyers, contracts,
-- load-outs and the dealer record the law asks for.
-- Plain Postgres. Runs the same on PGlite (embedded) and any Postgres 14+.
-- Weights are whole kilograms. Prices are cents per tonne. Money is whole cents in bigint.

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create table sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text not null check (country in ('NZ', 'AU')),
  state text not null check (state in ('NZ', 'NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  licence_no text not null default '',
  licence_expires_on date,
  manager text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sellers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  kind text not null default 'public' check (kind in ('public', 'trade')),
  name text not null,
  business_name text not null default '',
  business_no text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  date_of_birth date,
  id_type text not null default '',
  id_number text not null default '',
  id_expires_on date,
  banned boolean not null default false,
  notes text not null default '',
  external_id jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table grades (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  family text not null check (family in ('ferrous', 'non_ferrous', 'copper', 'vehicle', 'battery')),
  copper_pct int not null default 0 check (copper_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The price board. The current price is the newest row on or before today.
create table buy_prices (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  grade_id uuid not null references grades(id),
  seller_kind text not null default 'public' check (seller_kind in ('public', 'trade')),
  cents_per_tonne bigint not null check (cents_per_tonne >= 0),
  effective_on date not null default current_date,
  set_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, grade_id, seller_kind, effective_on)
);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  site_id uuid not null references sites(id),
  seller_id uuid not null references sellers(id),
  received_on date not null default current_date,
  received_at time not null default localtime(0),
  seller_vehicle_rego text not null default '',
  operator text not null default '',
  seller_signed boolean not null default false,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  payment_method text not null default 'none' check (payment_method in ('none', 'eft', 'cheque', 'cash')),
  payment_ref text not null default '',
  paid_on date,
  void_reason text not null default '',
  external_id jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references tickets(id) on delete cascade,
  line_no int not null,
  grade_id uuid not null references grades(id),
  description text not null default '',
  gross_kg int not null check (gross_kg >= 0),
  tare_kg int not null default 0 check (tare_kg >= 0),
  cents_per_tonne bigint not null check (cents_per_tonne >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  vehicle_vin text not null default '',
  vehicle_rego text not null default '',
  item_no text not null default '',
  photo_taken boolean not null default false,
  released_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ticket_id, line_no),
  check (tare_kg <= gross_kg)
);

create table buyers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text not null default '',
  contact text not null default '',
  email text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contracts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  buyer_id uuid not null references buyers(id),
  grade_id uuid not null references grades(id),
  tonnes numeric(10,2) not null check (tonnes > 0),
  cents_per_tonne bigint not null check (cents_per_tonne >= 0),
  currency text not null default 'NZD',
  signed_on date not null default current_date,
  deliver_by date not null,
  status text not null default 'open' check (status in ('open', 'filled', 'cancelled')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A load out of the yard: a truck to a local mill or a container for export.
create table loads (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  site_id uuid not null references sites(id),
  buyer_id uuid not null references buyers(id),
  contract_id uuid references contracts(id),
  grade_id uuid not null references grades(id),
  shipped_on date not null default current_date,
  container_no text not null default '',
  seal_no text not null default '',
  net_kg int not null check (net_kg > 0),
  cents_per_tonne bigint not null check (cents_per_tonne >= 0),
  amount_cents bigint not null check (amount_cents >= 0),
  invoiced boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table seller_notes (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references sellers(id),
  kind text not null default 'note' check (kind in ('note', 'call', 'police', 'visit', 'email')),
  body text not null,
  actor text not null default '',
  noted_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  filename text not null,
  fingerprint text not null unique,
  row_count int not null,
  actor text not null default '',
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key,
  entity text not null,
  record_id text not null,
  operation text not null,
  actor text not null default '',
  detail jsonb,
  created_at timestamptz not null default now()
);

create index ticket_lines_ticket on ticket_lines (ticket_id);
create index tickets_seller on tickets (seller_id, received_on);
create index loads_contract on loads (contract_id);

do $$
declare t text;
begin
  foreach t in array array['sites','sellers','grades','buy_prices','tickets','ticket_lines','buyers','contracts','loads','seller_notes'] loop
    execute format('create trigger %I before update on %I for each row execute function touch_updated_at()', t || '_touch', t);
  end loop;
  foreach t in array array['sites','sellers','grades','buy_prices','tickets','ticket_lines','buyers','contracts','loads','seller_notes','import_batches','audit_log'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------- views

-- Today's price board: newest price per site, grade and seller kind.
create view current_prices as
select s.code as site, g.code as grade, g.name as grade_name, g.family, p.seller_kind,
       p.cents_per_tonne, p.effective_on, current_date - p.effective_on as days_old
from (
  select distinct on (site_id, grade_id, seller_kind) *
  from buy_prices where effective_on <= current_date
  order by site_id, grade_id, seller_kind, effective_on desc
) p
join sites s on s.id = p.site_id
join grades g on g.id = p.grade_id
where g.active;

-- Every weighed line with its ticket, seller, yard and the hold the law puts on it.
create view line_detail as
select l.id, t.code as ticket, l.line_no, t.received_on, t.received_at, s.code as site, s.country, s.state,
       se.code as seller_code, se.name as seller, se.kind as seller_kind,
       g.code as grade, g.name as grade_name, g.family, g.copper_pct,
       l.gross_kg, l.tare_kg, l.gross_kg - l.tare_kg as net_kg, l.cents_per_tonne, l.amount_cents,
       l.vehicle_vin, l.vehicle_rego, l.item_no, l.photo_taken, l.released_on,
       t.status, t.payment_method, t.paid_on, t.seller_signed, t.operator,
       case
         when s.country = 'NZ' and g.family = 'copper' then t.received_on + 14
         when s.state = 'VIC' and g.copper_pct > 80 and not l.photo_taken then t.received_on + 7
       end as hold_until
from ticket_lines l
join tickets t on t.id = l.ticket_id
join sites s on s.id = t.site_id
join sellers se on se.id = t.seller_id
join grades g on g.id = l.grade_id
where t.status <> 'void';

create view ticket_summary as
select t.id, t.code, s.code as site, t.received_on, se.code as seller_code, se.name as seller, se.kind as seller_kind,
       count(l.id)::int as lines, coalesce(sum(l.gross_kg - l.tare_kg), 0)::int as net_kg,
       coalesce(sum(l.amount_cents), 0)::bigint as amount_cents,
       t.status, t.payment_method, t.payment_ref, t.paid_on, t.operator
from tickets t
join sites s on s.id = t.site_id
join sellers se on se.id = t.seller_id
left join ticket_lines l on l.ticket_id = t.id
group by t.id, s.code, se.code, se.name, se.kind;

create view unpaid_tickets as
select code as ticket, site, received_on, current_date - received_on as days_waiting, seller, seller_kind, net_kg, amount_cents
from ticket_summary
where status = 'open';

-- Copper and other items under a hold: what can be cut, baled or sold, and when.
create view held_items as
select ticket, line_no, site, state, seller, grade, net_kg, item_no, photo_taken, received_on, hold_until, released_on,
       hold_until - current_date as days_left,
       case when released_on is not null then 'released ' || released_on
            when hold_until > current_date then 'hold'
            else 'free to process' end as state_now
from line_detail
where hold_until is not null and (released_on is null or released_on >= current_date - 30);

-- Yard stock by site and grade: bought in, less shipped out.
create view yard_stock as
with bought as (
  select site, grade, sum(net_kg)::bigint as kg, sum(amount_cents)::bigint as cost_cents, max(received_on) as last_in
  from line_detail group by site, grade
), shipped as (
  select s.code as site, g.code as grade, sum(ld.net_kg)::bigint as kg, max(ld.shipped_on) as last_out
  from loads ld join sites s on s.id = ld.site_id join grades g on g.id = ld.grade_id group by s.code, g.code
)
select b.site, b.grade, g.name as grade_name, g.family,
       b.kg as bought_kg, coalesce(sh.kg, 0)::bigint as shipped_kg, (b.kg - coalesce(sh.kg, 0))::bigint as on_hand_kg,
       case when b.kg > 0 then round(b.cost_cents * 1000.0 / b.kg)::bigint end as avg_cost_cents_per_tonne,
       b.last_in, sh.last_out,
       current_date - coalesce(sh.last_out, b.last_in) as days_since_moved
from bought b
join grades g on g.code = b.grade
left join shipped sh on sh.site = b.site and sh.grade = b.grade;

-- Contracts against what has shipped and what is in the yard.
create view contract_position as
select c.code, b.name as buyer, g.code as grade, c.tonnes, c.cents_per_tonne, c.currency, c.deliver_by,
       c.deliver_by - current_date as days_left,
       round(coalesce((select sum(net_kg) from loads l where l.contract_id = c.id), 0) / 1000.0, 2) as shipped_t,
       round(c.tonnes - coalesce((select sum(net_kg) from loads l where l.contract_id = c.id), 0) / 1000.0, 2) as remaining_t,
       round(coalesce((select sum(on_hand_kg) from yard_stock ys where ys.grade = g.code), 0) / 1000.0, 2) as in_yard_t,
       c.status
from contracts c
join buyers b on b.id = c.buyer_id
join grades g on g.id = c.grade_id
where c.status = 'open';

-- What each grade cost to buy and sold for over the last 30 days.
create view grade_margin as
with b as (
  select grade, sum(net_kg)::bigint as kg, sum(amount_cents)::bigint as cents from line_detail
  where received_on >= current_date - 30 group by grade
), s as (
  select g.code as grade, sum(l.net_kg)::bigint as kg, sum(l.amount_cents)::bigint as cents from loads l join grades g on g.id = l.grade_id
  where l.shipped_on >= current_date - 30 group by g.code
)
select g.code as grade, g.name as grade_name,
       coalesce(b.kg, 0)::bigint as bought_kg,
       case when b.kg > 0 then round(b.cents * 1000.0 / b.kg)::bigint end as avg_buy_cents_per_tonne,
       coalesce(s.kg, 0)::bigint as sold_kg,
       case when s.kg > 0 then round(s.cents * 1000.0 / s.kg)::bigint end as avg_sell_cents_per_tonne,
       case when b.kg > 0 and s.kg > 0 then round(s.cents * 1000.0 / s.kg - b.cents * 1000.0 / b.kg)::bigint end as margin_cents_per_tonne
from grades g
left join b on b.grade = g.code
left join s on s.grade = g.code
where b.kg is not null or s.kg is not null;

-- Seller patterns worth a second look: frequent copper, banned sellers still selling, high volume public sellers.
create view seller_watch as
with recent as (
  select seller_code, seller, seller_kind,
         count(distinct ticket)::int as tickets_30d,
         count(distinct ticket) filter (where family = 'copper')::int as copper_tickets_30d,
         sum(net_kg) filter (where family = 'copper')::bigint as copper_kg_30d,
         sum(amount_cents)::bigint as paid_30d_cents,
         max(received_on) as last_ticket_on
  from line_detail where received_on >= current_date - 30 group by seller_code, seller, seller_kind
)
select r.seller_code, r.seller, r.seller_kind, r.tickets_30d, r.copper_tickets_30d, coalesce(r.copper_kg_30d, 0)::bigint as copper_kg_30d,
       r.paid_30d_cents, r.last_ticket_on,
       case when se.banned then 'banned seller still trading'
            when r.seller_kind = 'public' and r.copper_tickets_30d >= 4 then 'public seller, copper 4 or more times in 30 days'
            when r.seller_kind = 'public' and r.paid_30d_cents >= 500000 then 'public seller paid over $5,000 in 30 days'
       end as reason
from recent r join sellers se on se.code = r.seller_code
where se.banned
   or (r.seller_kind = 'public' and (r.copper_tickets_30d >= 4 or r.paid_30d_cents >= 500000));

-- The rules in docs/compliance.md, checked against the records. Each row cites its source.
create view compliance_findings as
-- R01 No cash for scrap metal in NSW and Victoria. In Victoria, goods over 80% copper are second-hand goods, not scrap.
select 'R01' as rule, ticket as record,
       seller || ' paid cash for ' || grade || ' at ' || site as detail,
       received_on as due_on, null::int as days_left,
       case when state = 'NSW' then 'Scrap Metal Industry Act 2016 (NSW) s 12' else 'Second-Hand Dealers and Pawnbrokers Act 1989 (Vic), Consumer Affairs Victoria scrap metal laws' end as source
from line_detail
where payment_method = 'cash' and (state = 'NSW' or (state = 'VIC' and copper_pct <= 80))
union all
-- R02 The seller's identity, address and the way it was checked are on record for every purchase.
select 'R02', t.code,
       se.name || ': ' || concat_ws(', ',
         case when se.id_type = '' or se.id_number = '' then 'no ID recorded' end,
         case when se.address = '' then 'no address' end,
         case when s.country = 'NZ' and se.date_of_birth is null then 'no date of birth' end,
         case when s.country = 'NZ' and not t.seller_signed then 'ticket not signed' end),
       t.received_on, null::int,
       case when s.country = 'NZ' then 'Secondhand Dealers and Pawnbrokers Act 2004 (NZ), NZ Police scrap metal guidance'
            when s.state = 'NSW' then 'Scrap Metal Industry Act 2016 (NSW) s 16'
            else 'Second-Hand Dealers and Pawnbrokers Act 1989 (Vic), Consumer Affairs Victoria scrap metal laws' end
from tickets t join sites s on s.id = t.site_id join sellers se on se.id = t.seller_id
where t.status <> 'void' and t.received_on >= current_date - 365
  and (se.id_type = '' or se.id_number = '' or se.address = ''
       or (s.country = 'NZ' and (se.date_of_birth is null or not t.seller_signed)))
union all
-- R03 A vehicle bought for scrap carries its identifier on the record.
select 'R03', ticket || '/' || line_no, seller || ': ' || grade_name || ' with no VIN or identifier', received_on, null::int,
       case when state = 'NSW' then 'Scrap Metal Industry Act 2016 (NSW) s 16'
            when country = 'NZ' then 'Secondhand Dealers and Pawnbrokers Act 2004 (NZ)'
            else 'Consumer Affairs Victoria scrap metal laws' end
from line_detail
where family = 'vehicle' and vehicle_vin = ''
union all
-- R04 NZ copper is an article: label it, record the price, keep it unaltered for 14 days.
select 'R04', ticket || '/' || line_no,
       grade || ' from ' || seller || ': ' ||
       case when released_on is not null and released_on < hold_until then 'released ' || (released_on - received_on) || ' days after purchase'
            else 'no item number on the label' end,
       hold_until, hold_until - current_date,
       'NZ Police scrap metal guidance: copper (Secondhand Dealers and Pawnbrokers Act 2004)'
from line_detail
where country = 'NZ' and family = 'copper'
  and ((released_on is not null and released_on < hold_until) or item_no = '')
union all
-- R05 Victoria: goods over 80% copper are held 7 days unless a photo is kept.
select 'R05', ticket || '/' || line_no, grade || ' from ' || seller || ': released ' || (released_on - received_on) || ' days after purchase with no photo',
       hold_until, hold_until - current_date, 'Consumer Affairs Victoria scrap metal laws (copper over 80%)'
from line_detail
where state = 'VIC' and copper_pct > 80 and not photo_taken and released_on is not null and released_on < hold_until
union all
-- R06 Each yard's dealer licence or registration is current.
select 'R06', code, name || ': licence ' || coalesce(nullif(licence_no, ''), 'not recorded') ||
       case when licence_expires_on is null then ', no expiry recorded'
            when licence_expires_on < current_date then ', expired ' || licence_expires_on
            else ', expires ' || licence_expires_on end,
       licence_expires_on, licence_expires_on - current_date,
       case when country = 'NZ' then 'Secondhand Dealers and Pawnbrokers Act 2004 (NZ)'
            when state = 'NSW' then 'Scrap Metal Industry Act 2016 (NSW)'
            else 'Second-Hand Dealers and Pawnbrokers Act 1989 (Vic)' end
from sites
where licence_no = '' or licence_expires_on is null or licence_expires_on < current_date + 60;

-- The dealer's record, one row per line, in the order police ask for it.
create view dealer_register as
select t.code as ticket, t.received_on, t.received_at, s.code as site, s.licence_no,
       se.name as seller, se.business_name, se.address, se.date_of_birth, se.id_type, se.id_number, t.seller_vehicle_rego,
       g.name as description, l.description as detail, l.gross_kg - l.tare_kg as net_kg, l.amount_cents,
       l.vehicle_vin, l.vehicle_rego, l.item_no, t.payment_method, t.payment_ref, t.seller_signed, t.operator
from ticket_lines l
join tickets t on t.id = l.ticket_id
join sites s on s.id = t.site_id
join sellers se on se.id = t.seller_id
join grades g on g.id = l.grade_id
where t.status <> 'void';
