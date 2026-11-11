-- Week 4: quotations and statements.
\o /dev/null
begin;

create function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;

insert into businesses (id, name, vat_registered) values ('10000000-0000-0000-0000-000000000001', 'Molefe Hardware', true);
insert into business_users (id, business_id, name, phone, role)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Neo', '+26771000001', 'staff');
insert into products (id, business_id, name, unit, sell_price, cost_price) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Bricks Cement 140mm', 'each', 650, 480),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Cement 42.5N 50kg', 'bag', 9500, 7800);
insert into customers (id, business_id, name) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Tlotlo Ntsima');

do $$
declare q quotations; q2 quotations; s sales; d jsonb;
begin
  -- Quote for an existing customer, one line at a negotiated price
  q := create_quote('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                    '40000000-0000-0000-0000-000000000001', null,
                    '[{"product_id":"30000000-0000-0000-0000-000000000001","qty":1000,"unit_price":600},
                      {"product_id":"30000000-0000-0000-0000-000000000002","qty":10}]');
  perform pg_temp.eq(q.quote_no, 'QT-00001', 'quote number');
  perform pg_temp.eq(q.total, 695000::bigint, 'quote total 1000×6.00 + 10×95');
  perform pg_temp.eq(q.vat_amount, 85351::bigint, 'VAT inside the total');
  perform pg_temp.eq(q.valid_until, current_date + 14, 'valid 14 days');

  d := quote_data(q.id);
  perform pg_temp.eq(d ->> 'kind', 'quote', 'quote_data kind');
  perform pg_temp.eq(d #>> '{customer,name}', 'Tlotlo Ntsima', 'quote customer');
  perform pg_temp.eq(d #>> '{sale,status}', 'open', 'open');

  -- Price goes up before the customer accepts: the sale keeps the quoted price
  update products set sell_price = 700 where id = '30000000-0000-0000-0000-000000000001';
  s := convert_quote(q.id, '20000000-0000-0000-0000-000000000001', 'credit');
  perform pg_temp.eq(s.total, 695000::bigint, 'sale at quoted prices');
  perform pg_temp.eq(s.quotation_id, q.id, 'sale linked to quote');
  perform pg_temp.eq((select status from quotations where id = q.id), 'accepted'::quote_status, 'quote accepted');

  -- Can't convert twice
  begin
    perform convert_quote(q.id, '20000000-0000-0000-0000-000000000001', 'cash');
    raise exception 'FAIL: converted twice';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Name-only quote → credit sale adds them as a customer
  q2 := create_quote('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, 'Mpho Kgosi',
                     '[{"product_id":"30000000-0000-0000-0000-000000000002","qty":2}]');
  perform pg_temp.eq(quote_data(q2.id) #>> '{customer,name}', 'Mpho Kgosi', 'name-only customer on quote');
  s := convert_quote(q2.id, '20000000-0000-0000-0000-000000000001', 'credit');
  perform pg_temp.eq((select name from customers where id = s.customer_id), 'Mpho Kgosi', 'customer created on credit');

  -- Expired quotes show as expired
  update quotations set valid_until = current_date - 1, status = 'open' where id = q2.id;
  perform pg_temp.eq(quote_data(q2.id) #>> '{sale,status}', 'expired', 'expired display');

  -- Statement: credit invoice then payment
  perform record_payment('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                         '40000000-0000-0000-0000-000000000001', 200000, 'eft');
  perform pg_temp.eq((select count(*) from customer_statement('40000000-0000-0000-0000-000000000001')), 2::bigint, 'statement rows');
  perform pg_temp.eq((select sum(debit) - sum(credit) from customer_statement('40000000-0000-0000-0000-000000000001')),
                     495000::numeric, 'statement balance');
  perform pg_temp.eq((select balance from customer_balances where customer_id = '40000000-0000-0000-0000-000000000001'),
                     495000::bigint, 'matches customer_balances');
end $$;

rollback;
\o
\echo '  quotes & statements: all assertions passed'
