-- Demo data for Scrap Yard for Claude Code. Every name, business and record is fictional.
-- Dates are relative to today so the demo always has something held, unpaid, short or overdue.
-- Idempotent: a second run does nothing. Never run this against a working database.
do $$
begin
  if exists (select 1 from sites where code = 'AKL') then
    return;
  end if;

  insert into sites (code, name, country, state, licence_no, licence_expires_on, manager) values
    ('AKL', 'Onehunga Yard', 'NZ', 'NZ', 'SHD-0412-AKL', current_date + 40, 'Tama Rewiri'),
    ('CHC', 'Hornby Yard', 'NZ', 'NZ', 'SHD-0377-CHC', current_date + 400, 'Jo Mackay'),
    ('SYD', 'Smithfield Yard', 'AU', 'NSW', 'SMD-12045', current_date + 300, 'Nick Petrakis'),
    ('MEL', 'Dandenong Yard', 'AU', 'VIC', 'SHD-VIC-88213', current_date + 500, 'Amira Haddad');

  insert into grades (code, name, family, copper_pct) values
    ('HMS', 'Heavy melting steel 1 and 2', 'ferrous', 0),
    ('SHRD', 'Shredder feed, light iron', 'ferrous', 0),
    ('CAST', 'Cast iron', 'ferrous', 0),
    ('CU1', 'Bright copper wire, No. 1', 'copper', 99),
    ('CU2', 'Copper, No. 2', 'copper', 94),
    ('INSW', 'Insulated copper cable', 'copper', 40),
    ('BRASS', 'Yellow brass', 'non_ferrous', 65),
    ('ALEX', 'Aluminium extrusion', 'non_ferrous', 0),
    ('ALCAN', 'Aluminium cans', 'non_ferrous', 0),
    ('SS304', 'Stainless steel 304', 'non_ferrous', 0),
    ('BATT', 'Lead acid batteries', 'battery', 0),
    ('CAR', 'End of life vehicle, by weight', 'vehicle', 0);

  -- The price board: an older board, the current board two weeks ago, and a copper move yesterday.
  insert into buy_prices (site_id, grade_id, seller_kind, cents_per_tonne, effective_on, set_by)
  select s.id, g.id, k.kind,
         round(b.base * case when k.kind = 'trade' then 1.06 else 1 end * d.factor)::bigint,
         current_date - d.days_ago, 'Yard manager'
  from sites s
  cross join (values ('public'), ('trade')) k(kind)
  join (values ('HMS', 38000), ('SHRD', 25000), ('CAST', 33000), ('CU1', 1150000), ('CU2', 1050000), ('INSW', 380000),
               ('BRASS', 620000), ('ALEX', 260000), ('ALCAN', 150000), ('SS304', 140000), ('BATT', 120000), ('CAR', 20000)) b(code, base) on true
  join grades g on g.code = b.code
  cross join (values (90, 0.95), (14, 1.0)) d(days_ago, factor);
  insert into buy_prices (site_id, grade_id, seller_kind, cents_per_tonne, effective_on, set_by)
  select p.site_id, p.grade_id, p.seller_kind, round(p.cents_per_tonne * 1.03)::bigint, current_date - 1, 'Yard manager'
  from buy_prices p join grades g on g.id = p.grade_id
  where g.family = 'copper' and p.effective_on = current_date - 14;

  insert into sellers (code, kind, name, business_name, business_no, address, phone, email, date_of_birth, id_type, id_number, id_expires_on, banned, notes) values
    ('P01', 'public', 'Kyle Brennan', '', '', '14 Mahia Road, Manurewa, Auckland', '021 555 0101', '', '1991-04-12', 'NZ driver licence', 'DL482211', current_date + 900, false, ''),
    ('P02', 'public', 'Darren Hollis', '', '', '7 Cumberland Road, Greystanes NSW 2145', '0400 555 202', '', '1984-09-30', '', '', null, false, ''),
    ('P03', 'public', 'Mere Tane', '', '', '22 Church Street, Onehunga, Auckland', '022 555 0303', '', null, 'NZ passport', 'LP991204', current_date + 1500, false, ''),
    ('P04', 'public', 'Jason Wu', '', '', '31 Lonsdale Street, Dandenong VIC 3175', '0411 555 404', '', '1979-02-18', 'VIC driver licence', '051882301', current_date + 600, false, ''),
    ('P05', 'public', 'Lachlan Price', '', '', '5 Bourke Street, Smithfield NSW 2164', '0422 555 505', '', '1996-11-03', 'NSW driver licence', '18834502', current_date + 700, false, ''),
    ('P06', 'public', 'Sam Fale', '', '', '9 Shands Road, Hornby, Christchurch', '027 555 0606', '', '1988-06-21', 'NZ driver licence', 'DM110934', current_date + 300, true, 'Banned after the stolen cable enquiry. Do not buy.'),
    ('P07', 'public', 'Ruby Collins', '', '', '41 Main South Road, Islington, Christchurch', '021 555 0707', '', '1972-12-09', 'NZ driver licence', 'DK558120', current_date + 1200, false, ''),
    ('T01', 'trade', 'Hemi Walker', 'Sparkline Electrical Ltd', 'NZBN 9429041234567', '3 Station Road, Penrose, Auckland', '09 555 0111', 'accounts@sparkline.example', '1980-03-15', 'NZ driver licence', 'DH203311', current_date + 800, false, 'Monthly statement, pays by EFT.'),
    ('T02', 'trade', 'Mark Delaney', 'Westside Demolition Pty Ltd', 'ABN 51 824 753 556', '120 Woodpark Road, Smithfield NSW 2164', '02 5550 0222', 'office@westsidedemo.example', '1975-08-01', 'NSW driver licence', '12093844', current_date + 400, false, ''),
    ('T03', 'trade', 'Priya Shah', 'Bayside Plumbing Pty Ltd', 'ABN 33 615 220 914', '8 Frankston Dandenong Road, Dandenong South VIC 3175', '03 5550 0333', 'admin@baysideplumb.example', '1986-05-27', 'VIC driver licence', '044913377', current_date + 500, false, ''),
    ('T04', 'trade', 'Greg Hollis', 'Canterbury Auto Dismantlers Ltd', 'NZBN 9429047654321', '60 Halswell Junction Road, Hornby, Christchurch', '03 555 0444', 'parts@cantauto.example', '1969-10-10', 'NZ driver licence', 'DB771402', current_date + 200, false, ''),
    ('T05', 'trade', 'Leanne Moore', 'Metro Fabrication Ltd', 'NZBN 9429049988776', '18 Galway Street, Onehunga, Auckland', '09 555 0555', 'accounts@metrofab.example', '1983-01-22', 'NZ driver licence', 'DF664120', current_date + 700, false, 'Collects offcuts weekly.');

  -- Tickets: code, yard, seller, days ago, status, payment, reference, signed, operator.
  insert into tickets (code, site_id, seller_id, received_on, received_at, seller_vehicle_rego, operator, seller_signed, status, payment_method, payment_ref, paid_on)
  select v.code, s.id, se.id, current_date - v.days_ago, v.at::time, v.rego, v.operator, v.signed, v.status, v.method, v.ref,
         case when v.status = 'paid' then current_date - v.days_ago end
  from (values
    ('T-1001', 'AKL', 'P01', 28, '09:12', 'LMN482', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 88120'),
    ('T-1002', 'AKL', 'P01', 21, '10:40', 'LMN482', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 88174'),
    ('T-1003', 'AKL', 'P01', 12, '14:05', 'LMN482', 'Rangi Hohaia', true, 'paid', 'eft', 'EFT 88231'),
    ('T-1004', 'AKL', 'P01', 6, '08:55', 'LMN482', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 88302'),
    ('T-1005', 'AKL', 'P01', 2, '15:30', 'LMN482', 'Rangi Hohaia', true, 'open', 'none', ''),
    ('T-1006', 'AKL', 'P03', 10, '11:20', 'QRT119', 'Rangi Hohaia', true, 'paid', 'eft', 'EFT 88250'),
    ('T-1007', 'AKL', 'T01', 8, '07:45', 'SPK001', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 88266'),
    ('T-1008', 'AKL', 'T05', 15, '13:10', 'MTF220', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 88205'),
    ('T-1009', 'AKL', 'T05', 3, '13:25', 'MTF220', 'Rangi Hohaia', true, 'open', 'none', ''),
    ('T-1010', 'AKL', 'P01', 1, '16:02', 'LMN482', 'Rangi Hohaia', true, 'paid', 'eft', 'EFT 88340'),
    ('T-1020', 'AKL', 'T05', 50, '09:00', 'MTF220', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 87650'),
    ('T-1021', 'AKL', 'T01', 42, '07:50', 'SPK001', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 87790'),
    ('T-1022', 'AKL', 'T05', 78, '10:15', 'MTF220', 'Tama Rewiri', true, 'paid', 'eft', 'EFT 87120'),
    ('T-2001', 'CHC', 'T04', 20, '10:00', 'CAD777', 'Jo Mackay', true, 'paid', 'eft', 'EFT 40112'),
    ('T-2002', 'CHC', 'P06', 5, '12:45', 'FAL900', 'Ben Tuilagi', true, 'paid', 'eft', 'EFT 40188'),
    ('T-2003', 'CHC', 'P07', 4, '09:35', 'RCL410', 'Ben Tuilagi', false, 'paid', 'eft', 'EFT 40190'),
    ('T-2004', 'CHC', 'T04', 1, '14:20', 'CAD777', 'Jo Mackay', true, 'open', 'none', ''),
    ('T-3001', 'SYD', 'P02', 9, '11:05', 'DHL22X', 'Nick Petrakis', true, 'paid', 'eft', 'EFT 7702'),
    ('T-3002', 'SYD', 'P05', 7, '15:50', 'LPR96Z', 'Kris Lee', true, 'paid', 'cash', ''),
    ('T-3003', 'SYD', 'T02', 14, '07:30', 'WSD01', 'Nick Petrakis', true, 'paid', 'eft', 'EFT 7655'),
    ('T-3004', 'SYD', 'T02', 3, '07:40', 'WSD01', 'Kris Lee', true, 'paid', 'eft', 'EFT 7731'),
    ('T-3005', 'SYD', 'P05', 60, '10:10', 'LPR96Z', 'Nick Petrakis', true, 'paid', 'eft', 'EFT 7302'),
    ('T-3020', 'SYD', 'T02', 45, '07:20', 'WSD01', 'Nick Petrakis', true, 'paid', 'eft', 'EFT 7410'),
    ('T-3021', 'SYD', 'T02', 40, '07:25', 'WSD01', 'Nick Petrakis', true, 'paid', 'eft', 'EFT 7455'),
    ('T-4001', 'MEL', 'P04', 11, '10:30', 'JWU888', 'Amira Haddad', true, 'paid', 'cash', ''),
    ('T-4002', 'MEL', 'P04', 11, '10:34', 'JWU888', 'Amira Haddad', true, 'paid', 'cash', ''),
    ('T-4003', 'MEL', 'T03', 6, '08:15', 'BSP303', 'Amira Haddad', true, 'paid', 'eft', 'EFT 5521'),
    ('T-4004', 'MEL', 'T03', 2, '08:20', 'BSP303', 'Tom Nguyen', true, 'open', 'none', ''),
    ('T-4020', 'MEL', 'T03', 38, '08:05', 'BSP303', 'Amira Haddad', true, 'paid', 'eft', 'EFT 5390')
  ) v(code, site, seller, days_ago, at, rego, operator, signed, status, method, ref)
  join sites s on s.code = v.site
  join sellers se on se.code = v.seller;

  -- Lines: ticket, line, grade, gross, tare, VIN, vehicle rego, item number, photo, days after purchase it was released.
  insert into ticket_lines (ticket_id, line_no, grade_id, description, gross_kg, tare_kg, cents_per_tonne, amount_cents, vehicle_vin, vehicle_rego, item_no, photo_taken, released_on)
  select t.id, v.line_no, g.id, v.descr, v.gross, v.tare, p.cents_per_tonne,
         round((v.gross - v.tare) * p.cents_per_tonne / 1000.0)::bigint,
         v.vin, v.vrego, v.item, v.photo,
         case when v.released_after is not null then t.received_on + v.released_after end
  from (values
    ('T-1001', 1, 'CU1', 'Stripped house wire', 62, 2, '', '', 'AKL-C-1001', false, 20),
    ('T-1002', 1, 'CU2', 'Mixed copper pipe and wire', 48, 0, '', '', 'AKL-C-1002', false, 9),
    ('T-1003', 1, 'INSW', 'Insulated cable offcuts', 85, 3, '', '', '', false, null),
    ('T-1004', 1, 'CU1', 'Bright wire', 40, 0, '', '', 'AKL-C-1004', false, null),
    ('T-1005', 1, 'CU2', 'Copper pipe', 55, 1, '', '', 'AKL-C-1005', false, null),
    ('T-1006', 1, 'ALCAN', 'Bagged cans', 120, 0, '', '', '', false, null),
    ('T-1007', 1, 'INSW', 'Site cable offcuts', 640, 20, '', '', 'AKL-C-1007', false, null),
    ('T-1007', 2, 'CU1', 'Stripped site wire', 210, 10, '', '', 'AKL-C-1008', false, null),
    ('T-1008', 1, 'HMS', 'Plate and beam offcuts', 4100, 0, '', '', '', false, null),
    ('T-1009', 1, 'HMS', 'Plate offcuts', 3800, 0, '', '', '', false, null),
    ('T-1010', 1, 'CU1', 'Bright wire', 22, 0, '', '', 'AKL-C-1010', false, null),
    ('T-1020', 1, 'HMS', 'Bin swap, structural steel', 64000, 0, '', '', '', false, null),
    ('T-1021', 1, 'CU1', 'Stripped site wire', 1200, 0, '', '', 'AKL-C-0950', false, 20),
    ('T-1021', 2, 'INSW', 'Site cable', 2400, 0, '', '', 'AKL-C-0951', false, 20),
    ('T-1022', 1, 'SS304', 'Stainless offcuts', 9000, 0, '', '', '', false, null),
    ('T-2001', 1, 'CAR', '2002 Toyota Corolla, stripped', 1250, 0, 'JTDBR32E720012345', 'BXK412', '', false, null),
    ('T-2001', 2, 'BATT', 'Batteries on pallet', 600, 0, '', '', '', false, null),
    ('T-2002', 1, 'HMS', 'Fence posts and frames', 380, 0, '', '', '', false, null),
    ('T-2003', 1, 'ALEX', 'Window frames', 90, 0, '', '', '', false, null),
    ('T-2004', 1, 'CAR', '2005 Mazda Demio, stripped', 1180, 0, '7AT0H63SX12345678', 'DEM505', '', false, null),
    ('T-3001', 1, 'HMS', 'Trailer of mixed steel', 450, 0, '', '', '', false, null),
    ('T-3002', 1, 'HMS', 'Ute load of steel', 700, 0, '', '', '', false, null),
    ('T-3003', 1, 'HMS', 'Demolition steel', 18500, 0, '', '', '', false, null),
    ('T-3003', 2, 'CAR', 'Car body from site clearance', 1320, 0, '', 'CXY12B', '', false, null),
    ('T-3004', 1, 'HMS', 'Demolition steel', 22100, 0, '', '', '', false, null),
    ('T-3005', 1, 'CAST', 'Cast iron baths', 300, 0, '', '', '', false, null),
    ('T-3020', 1, 'HMS', 'Demolition steel', 88000, 0, '', '', '', false, null),
    ('T-3021', 1, 'HMS', 'Demolition steel', 52000, 0, '', '', '', false, null),
    ('T-4001', 1, 'CU1', 'Bright wire', 30, 0, '', '', '', false, 2),
    ('T-4002', 1, 'BRASS', 'Taps and fittings', 45, 0, '', '', '', false, null),
    ('T-4003', 1, 'CU2', 'Copper pipe offcuts', 180, 0, '', '', '', true, 1),
    ('T-4003', 2, 'BRASS', 'Valves and fittings', 260, 0, '', '', '', false, null),
    ('T-4004', 1, 'CU1', 'Bright wire', 95, 0, '', '', '', false, null),
    ('T-4020', 1, 'BRASS', 'Valves and fittings', 1800, 0, '', '', '', false, null),
    ('T-4020', 2, 'CU2', 'Copper pipe', 900, 0, '', '', '', true, 2)
  ) v(ticket, line_no, grade, descr, gross, tare, vin, vrego, item, photo, released_after)
  join tickets t on t.code = v.ticket
  join sellers se on se.id = t.seller_id
  join grades g on g.code = v.grade
  cross join lateral (
    select bp.cents_per_tonne from buy_prices bp
    where bp.site_id = t.site_id and bp.grade_id = g.id and bp.seller_kind = se.kind and bp.effective_on <= t.received_on
    order by bp.effective_on desc limit 1
  ) p;

  insert into buyers (code, name, country, contact, email) values
    ('B01', 'Harbour Metals Trading Ltd', 'NZ', 'Daniel Ho', 'trading@harbourmetals.example'),
    ('B02', 'Southern Steel Mill Pty Ltd', 'AU', 'Kate Rourke', 'intake@southernsteel.example'),
    ('B03', 'Pacific Nonferrous Pte Ltd', 'SG', 'Wei Lin', 'purchasing@pacnf.example');

  insert into contracts (code, buyer_id, grade_id, tonnes, cents_per_tonne, currency, signed_on, deliver_by, notes)
  select v.code, b.id, g.id, v.tonnes, v.price, v.currency, current_date - v.signed_ago, current_date + v.due_in, v.notes
  from (values
    ('K-2611', 'B01', 'HMS', 300, 46000, 'NZD', 40, 10, 'Export, 20 ft containers, Port of Auckland'),
    ('K-2612', 'B03', 'CU1', 5, 1290000, 'USD', 20, 45, 'Bright wire, CIF Singapore'),
    ('K-2613', 'B02', 'SHRD', 100, 30500, 'AUD', 10, 30, 'Delivered to mill by truck')
  ) v(code, buyer, grade, tonnes, price, currency, signed_ago, due_in, notes)
  join buyers b on b.code = v.buyer
  join grades g on g.code = v.grade;

  insert into loads (code, site_id, buyer_id, contract_id, grade_id, shipped_on, container_no, seal_no, net_kg, cents_per_tonne, amount_cents, invoiced)
  select v.code, s.id, b.id, c.id, g.id, current_date - v.days_ago, v.container, v.seal, v.kg, v.price, round(v.kg::bigint * v.price / 1000.0)::bigint, v.invoiced
  from (values
    ('L-501', 'AKL', 'B01', 'K-2611', 'HMS', 20, 'MSKU1234567', 'SL-88201', 26000, 46000, true),
    ('L-502', 'AKL', 'B01', 'K-2611', 'HMS', 12, 'TGHU7654321', 'SL-88245', 25500, 46000, true),
    ('L-503', 'SYD', 'B02', null, 'HMS', 30, '', '', 60000, 43000, true),
    ('L-504', 'SYD', 'B01', 'K-2611', 'HMS', 5, 'CAIU3344556', 'SL-77120', 68500, 46000, false),
    ('L-505', 'AKL', 'B03', 'K-2612', 'CU1', 10, 'MRKU9988776', 'SL-88290', 1100, 1290000, false),
    ('L-506', 'MEL', 'B03', null, 'BRASS', 8, 'SEGU1122334', 'SL-66012', 1500, 700000, true)
  ) v(code, site, buyer, contract, grade, days_ago, container, seal, kg, price, invoiced)
  join sites s on s.code = v.site
  join buyers b on b.code = v.buyer
  join grades g on g.code = v.grade
  left join contracts c on c.code = v.contract;

  insert into seller_notes (seller_id, kind, body, actor, noted_on)
  select se.id, v.kind, v.body, v.actor, current_date - v.days_ago
  from (values
    ('P06', 'police', 'Police enquiry about stolen cable from a Hornby substation. Seller banned.', 'Jo Mackay', 60),
    ('P01', 'note', 'Says he strips cable for a mate who does house rewires. Asked for the electrician''s name next time.', 'Tama Rewiri', 6),
    ('T02', 'call', 'Mark expects two more demolition loads before Christmas.', 'Nick Petrakis', 4)
  ) v(seller, kind, body, actor, days_ago)
  join sellers se on se.code = v.seller;
end
$$;
