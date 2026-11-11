-- Week 3: customer matching and invoice data.
\o /dev/null
begin;

create function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;

insert into businesses (id, name, vat_registered, vat_number, invoice_footer)
values ('10000000-0000-0000-0000-000000000001', 'Molefe Hardware', true, 'P01234567', 'FNB 6200000');
insert into business_users (id, business_id, name, phone, role)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Neo', '+26771000001', 'staff');
insert into products (id, business_id, name, unit, sell_price, cost_price)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cement 42.5N 50kg', 'bag', 9500, 7800);
insert into customers (id, business_id, name, company) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Kabelo Molefe', null),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Kabelo Sebina', null),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Tlotlo Ntsima', 'Tlotlo Construction (Pty) Ltd');

-- Matching
select pg_temp.eq((select count(*) from match_customers('10000000-0000-0000-0000-000000000001', 'kabelo')), 2::bigint,
                  'first name only → both Kabelos (bot must ask)');
select pg_temp.eq((select name from match_customers('10000000-0000-0000-0000-000000000001', 'kabelo molefe') limit 1),
                  'Kabelo Molefe', 'full name ranks first');
select pg_temp.eq((select name from match_customers('10000000-0000-0000-0000-000000000001', 'tlotlo construction') limit 1),
                  'Tlotlo Ntsima', 'company name matches');
select pg_temp.eq((select count(*) from match_customers('10000000-0000-0000-0000-000000000001', 'mpho')), 0::bigint,
                  'unknown name → no match (bot offers to add)');

-- Invoice data
do $$
declare s sales; d jsonb;
begin
  s := create_sale('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                   '40000000-0000-0000-0000-000000000001', 'credit',
                   '[{"product_id":"30000000-0000-0000-0000-000000000001","qty":20}]');
  d := invoice_data(s.id);
  perform pg_temp.eq(d #>> '{sale,invoice_no}', 'INV-00001', 'invoice no');
  perform pg_temp.eq((d #>> '{sale,total}')::bigint, 190000::bigint, 'total');
  perform pg_temp.eq(d #>> '{business,vat_number}', 'P01234567', 'vat number');
  perform pg_temp.eq(d #>> '{customer,name}', 'Kabelo Molefe', 'customer');
  perform pg_temp.eq(d ->> 'served_by', 'Neo', 'served by');
  perform pg_temp.eq(jsonb_array_length(d -> 'items'), 1, 'one line');
  perform pg_temp.eq((d ->> 'balance_after')::bigint, 190000::bigint, 'balance after credit sale');
end $$;

rollback;
\o
\echo '  AI sales: all assertions passed'
