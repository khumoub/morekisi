-- End-to-end checks of the core business flows. Any failed assert aborts the run.
\o /dev/null
begin;

create function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;

-- Fixtures ---------------------------------------------------------------
insert into businesses (id, name, vat_registered, slug, timezone)
values ('10000000-0000-0000-0000-000000000001', 'Molefe Hardware', true, 'molefe-hardware', 'Africa/Gaborone'),
       ('10000000-0000-0000-0000-000000000002', 'Other Shop', false, 'other-shop', 'Africa/Gaborone');
insert into auth.users values ('a0000000-0000-0000-0000-000000000001');
insert into business_users (id, business_id, auth_user_id, name, phone, role)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000001', 'Neo', '+26771000001', 'owner'),
       ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002',
        null, 'Neo (other shop)', '+26771000001', 'owner');   -- same phone, two shops: allowed in v0.2
insert into products (id, business_id, sku, name, aliases, unit, sell_price, cost_price, reorder_level) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'CEM425', 'Cement 42.5N 50kg', '{cem}', 'bag', 9500, 7800, 50),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'CEM325', 'Cement 32.5N 50kg', '{cem}', 'bag', 8900, 7200, 50),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Y12', 'Rebar Y12 6m', '{12mm}', 'each', 12000, 9000, 20),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'X', 'Other shop cement', '{}', 'bag', 100, 50, 0);
insert into customers (id, business_id, name, credit_limit)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Kabelo Molefe', 500000);

select stock_in('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                '30000000-0000-0000-0000-000000000001', 54, 7800, 'Builders Depot');
select stock_in('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                '30000000-0000-0000-0000-000000000003', 30);

-- 1. Back-office credit sale: totals, VAT, profit, stock, numbering --------------------------
do $$
declare s sales;
begin
  s := create_sale('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                   '40000000-0000-0000-0000-000000000001', 'credit',
                   '[{"product_id":"30000000-0000-0000-0000-000000000001","qty":20},
                     {"product_id":"30000000-0000-0000-0000-000000000003","qty":5}]');
  perform pg_temp.eq(s.invoice_no, 'INV-00001', 'first invoice number');
  perform pg_temp.eq(s.total, 250000::bigint, 'sale total P2,500.00');
  perform pg_temp.eq(s.vat_amount, 30702::bigint, 'VAT 14% inclusive = P307.02');
  perform pg_temp.eq(s.cost_total, 201000::bigint, 'cost snapshot');
  perform pg_temp.eq((select on_hand from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     34::numeric, 'cement stock after sale');
  perform pg_temp.eq((select low_stock from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     true, 'cement flagged low');
end $$;

-- 2. Payment reduces balance ----------------------------------------------------------------
select record_payment('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                      '40000000-0000-0000-0000-000000000001', 50000, 'orange_money');
select pg_temp.eq((select balance from customer_balances where customer_id = '40000000-0000-0000-0000-000000000001'),
                  200000::bigint, 'balance after P500 payment');

-- 3. Credit sale without a customer is rejected -----------------------------------------------
do $$
begin
  perform create_sale('10000000-0000-0000-0000-000000000001', null, null, 'credit',
                      '[{"product_id":"30000000-0000-0000-0000-000000000003","qty":1}]');
  raise exception 'FAIL: credit sale without customer was accepted';
exception when check_violation then null;
end $$;

-- 4. Fuzzy matching ---------------------------------------------------------------------------
select pg_temp.eq((select count(*) from match_products('10000000-0000-0000-0000-000000000001', 'cem 42')),
                  2::bigint, 'ambiguous cement → 2 candidates');
select pg_temp.eq((select name from match_products('10000000-0000-0000-0000-000000000001', '12mm') limit 1),
                  'Rebar Y12 6m', 'alias match');
select pg_temp.eq((select count(*) from match_products('10000000-0000-0000-0000-000000000001', 'paint')),
                  0::bigint, 'no false matches');
select pg_temp.eq((select count(*) from match_products('10000000-0000-0000-0000-000000000001', 'other shop cement')),
                  2::bigint, 'never matches another shop''s products (only the 2 own cements)');

-- 5. Storefront: catalogue, cart → order → approval → reserved stock → completion ----------------
insert into customers (id, business_id, name, wa_id, source)
values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Tumelo', '26772000002', 'whatsapp');

select pg_temp.eq((select count(*) from shop_products('10000000-0000-0000-0000-000000000001')),
                  2::bigint, 'shop shows only in-stock items (32.5N has no stock)');

insert into carts (id, business_id, customer_id)
values ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002');
insert into cart_items values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 30);

do $$
declare o orders; s sales;
begin
  o := place_order('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002',
                   'delivery', 'Plot 123, Tlokweng');
  perform pg_temp.eq(o.order_no, 'ORD-00001', 'order number');
  perform pg_temp.eq(o.status, 'pending_approval'::order_status, 'order waits for approval');
  perform pg_temp.eq(o.total, 285000::bigint, 'order total 30 × P95');
  perform pg_temp.eq((select count(*) from cart_items where cart_id = '50000000-0000-0000-0000-000000000001'),
                     0::bigint, 'cart emptied');
  perform pg_temp.eq((select reserved from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     0::numeric, 'pending order does not reserve stock');

  o := approve_order(o.id, '20000000-0000-0000-0000-000000000001', 15000);
  perform pg_temp.eq(o.total, 300000::bigint, 'total incl. P150 delivery');
  perform pg_temp.eq((select reserved from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     30::numeric, 'confirmed order reserves stock');
  perform pg_temp.eq((select available from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     4::numeric, 'available = 34 on hand − 30 reserved');

  o := set_order_status(o.id, 'out_for_delivery');
  s := complete_order(o.id, '20000000-0000-0000-0000-000000000001', 'cash');
  perform pg_temp.eq(s.total, 300000::bigint, 'invoice includes delivery fee');
  perform pg_temp.eq(s.invoice_no, 'INV-00002', 'invoice numbering continues');
  perform pg_temp.eq((select status from orders where id = o.id), 'completed'::order_status, 'order completed');
  perform pg_temp.eq((select on_hand from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     4::numeric, 'stock out on completion');
  perform pg_temp.eq((select reserved from product_stock where product_id = '30000000-0000-0000-0000-000000000001'),
                     0::numeric, 'reservation released');
  perform pg_temp.eq((select count(*) from stock_movements m join products p on p.id = m.product_id
                      where p.sku = 'DELIVERY'), 0::bigint, 'delivery fee creates no stock movement');
end $$;

-- 6. Order rejection and wrong transitions -----------------------------------------------------
insert into cart_items values ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 2);
do $$
declare o orders;
begin
  o := place_order('10000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', 'collection');
  o := reject_order(o.id, '20000000-0000-0000-0000-000000000001', 'Out of stock at branch');
  perform pg_temp.eq(o.status, 'rejected'::order_status, 'order rejected');
  begin
    perform complete_order(o.id, '20000000-0000-0000-0000-000000000001', 'cash');
    raise exception 'FAIL: completed a rejected order';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 7. Cash-up: expected takings and difference ---------------------------------------------------
-- Today: cash sale P3,000 (order) + Orange Money payment P500; the credit sale is not money in.
do $$
declare c cash_ups; d date := (now() at time zone 'Africa/Gaborone')::date;
begin
  c := submit_cash_up('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                      d, 290000, 0, 50000, 'P100 short?');
  perform pg_temp.eq(c.expected_cash, 300000::bigint, 'expected cash');
  perform pg_temp.eq(c.expected_mobile, 50000::bigint, 'expected mobile money');
  perform pg_temp.eq(c.difference, -10000::bigint, 'P100 short');
  -- resubmitting the same day updates the row instead of duplicating it
  c := submit_cash_up('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                      d, 300000, 0, 50000);
  perform pg_temp.eq(c.difference, 0::bigint, 'corrected cash-up balances');
  perform pg_temp.eq((select count(*) from cash_ups), 1::bigint, 'one cash-up per day');
end $$;

-- 8. Void returns stock -----------------------------------------------------------------------
do $$
declare s sales;
begin
  s := create_sale('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'cash',
                   '[{"product_id":"30000000-0000-0000-0000-000000000003","qty":3}]');
  perform void_sale(s.id, '20000000-0000-0000-0000-000000000001', 'Wrong item');
  perform pg_temp.eq((select on_hand from product_stock where product_id = '30000000-0000-0000-0000-000000000003'),
                     25::numeric, 'void restores rebar stock');
end $$;

-- 9. Row Level Security -----------------------------------------------------------------------
set local role authenticated;
select pg_temp.eq((select count(*) from products), 0::bigint, 'anonymous-ish user sees no products');
set local request.uid = 'a0000000-0000-0000-0000-000000000001';
select pg_temp.eq((select count(*) from products where business_id = '10000000-0000-0000-0000-000000000002'),
                  0::bigint, 'owner cannot see other shop');
select pg_temp.eq((select count(*) from orders), 2::bigint, 'owner sees own orders');
do $$
begin
  perform approve_order(gen_random_uuid(), null);
  raise exception 'FAIL: browser role could call approve_order';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;
\o
\echo '  core flows: all assertions passed'
