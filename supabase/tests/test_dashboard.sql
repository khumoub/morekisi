-- Dashboard rules: sign-in linking, onboarding, roles, cost privacy, CSV import, WhatsApp connection.
\o /dev/null
begin;

create function pg_temp.eq(actual anyelement, expected anyelement, label text) returns void
language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
end $$;

-- Runs SQL as the current role and asserts that it raises an error whose message contains p_like.
create function pg_temp.fails(p_sql text, p_like text, label text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAIL %: expected an error', label;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  if sqlerrm not ilike '%' || p_like || '%' then
    raise exception 'FAIL %: expected error like "%", got "%"', label, p_like, sqlerrm;
  end if;
end $$;
grant execute on function pg_temp.eq(anyelement, anyelement, text), pg_temp.fails(text, text, text) to authenticated;

insert into auth.users (id, phone) values
  ('a0000000-0000-0000-0000-00000000000a', '26771000009'),   -- owner (Supabase stores no "+")
  ('a0000000-0000-0000-0000-00000000000b', '26771000010'),   -- staff
  ('a0000000-0000-0000-0000-00000000000c', '26771000011');   -- stranger

-- 1. Owner signs in and creates the shop ------------------------------------------------------
set local role authenticated;
set local request.uid = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.eq(my_phone(), '+26771000009', 'phone from auth.users with +');
select create_business('Molefe Hardware & Supplies', 'Neo') as biz \gset
select pg_temp.eq((select slug from businesses), 'molefe-hardware-supplies', 'slug generated');
select pg_temp.eq((select role::text from business_users where auth_user_id = auth.uid()), 'owner', 'creator is owner');

-- 2. Owner adds a staff member by phone; staff signs in and is linked ------------------------
insert into business_users (business_id, name, phone, role) values (:'biz', 'Kago', '+26771000010', 'staff');
set local request.uid = 'a0000000-0000-0000-0000-00000000000b';
select pg_temp.eq(claim_memberships(), 1, 'staff linked on first sign-in');
select pg_temp.eq(claim_memberships(), 0, 'second sign-in links nothing new');
select pg_temp.eq((select count(*) from businesses), 1::bigint, 'staff sees their shop');

-- 3. Owner imports products from CSV (categories created, opening stock) ------------------------
set local request.uid = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.eq(import_products(:'biz', '[
  {"sku":"CEM425","name":"Cement 42.5N 50kg","category":"Cement","unit":"bag","sell_price":9500,"cost_price":7800,"reorder_level":50,"stock":120},
  {"sku":"","name":"Rebar Y12 6m","category":"Steel","unit":"each","sell_price":12000,"cost_price":9000,"stock":40},
  {"sku":"NAIL75","name":"Nails 75mm 1kg","category":"Cement","unit":"kg","sell_price":3500}
]'::jsonb), '{"created": 3, "updated": 0}'::jsonb, 'first import creates 3');
select pg_temp.eq((select count(*) from categories), 2::bigint, 'categories created once');
select pg_temp.eq((select on_hand from product_stock where name = 'Cement 42.5N 50kg'), 120::numeric, 'opening stock');
select pg_temp.eq((select type::text from stock_movements m join products p on p.id = m.product_id where p.sku = 'CEM425'),
                  'opening', 'first stock is an opening movement');

-- Re-import a stock take: price change + new count → update + adjustment, matched by SKU and by name
select pg_temp.eq(import_products(:'biz', '[
  {"sku":"CEM425","name":"Cement 42.5N 50kg","sell_price":9900,"stock":100},
  {"sku":"","name":"rebar y12 6M","sell_price":12000,"stock":40}
]'::jsonb), '{"created": 0, "updated": 2}'::jsonb, 're-import updates');
select pg_temp.eq((select sell_price from products where sku = 'CEM425'), 9900::bigint, 'price updated');
select pg_temp.eq((select on_hand from product_stock where name = 'Cement 42.5N 50kg'), 100::numeric, 'stock adjusted to count');
select pg_temp.eq((select count(*) from stock_movements where reason = 'CSV import' and type = 'adjustment'),
                  1::bigint, 'only one adjustment (rebar count unchanged)');

-- 4. Staff: can see products, cannot see costs or change the catalogue -------------------------
set local request.uid = 'a0000000-0000-0000-0000-00000000000b';
select pg_temp.eq((select count(*) from products), 3::bigint, 'staff sees products');
select pg_temp.fails('select cost_price from products', 'permission denied', 'staff cannot read cost_price');
select pg_temp.eq((select count(*) from product_costs(:'biz')), 0::bigint, 'product_costs empty for staff');
select pg_temp.fails(format('insert into products (business_id, name, sell_price) values (%L, %L, 1)', :'biz', 'X'),
                     'row-level security', 'staff cannot add products');
select pg_temp.fails(format('select import_products(%L, %L)', :'biz', '[]'), 'only owners and managers', 'staff cannot import');
update products set sell_price = 1 where sku = 'CEM425';
select pg_temp.eq((select sell_price from products where sku = 'CEM425'), 9900::bigint, 'staff update silently blocked');
update businesses set name = 'Hacked';
select pg_temp.eq((select name from businesses), 'Molefe Hardware & Supplies', 'staff cannot change settings');
select pg_temp.fails(format('insert into business_users (business_id, name, phone) values (%L, %L, %L)', :'biz', 'Y', '+26770000000'),
                     'row-level security', 'staff cannot add staff');
select pg_temp.fails(format('select connect_wa_account(%L, %L, %L, %L, %L)', :'biz', 'PN1', 'W1', '+267', 'tok'),
                     'only the owner', 'staff cannot connect WhatsApp');
select pg_temp.fails('insert into sales (business_id) values (gen_random_uuid())', 'permission denied',
                     'sales are never written from the browser');

-- 5. Owner: costs visible, ledger immutable, WhatsApp connection -------------------------------
set local request.uid = 'a0000000-0000-0000-0000-00000000000a';
select pg_temp.eq((select c.cost_price from product_costs(:'biz') c join products p on p.id = c.product_id where p.sku = 'CEM425'),
                  7800::bigint, 'owner sees cost');
update stock_movements set qty = 999;
select pg_temp.eq((select max(qty) from stock_movements), 120::numeric, 'ledger rows cannot be edited');
delete from stock_movements;
select pg_temp.eq((select count(*) from stock_movements), 3::bigint, 'ledger rows cannot be deleted');

select connect_wa_account(:'biz', 'PN-MOLEFE', 'WABA-1', '+267 71 000 009', 'EAAG-secret-token');
select pg_temp.eq((select display_phone from wa_accounts where active), '+267 71 000 009', 'number connected');
select pg_temp.eq((select token_secret_id is not null from wa_accounts), true, 'token stored in vault');
select pg_temp.fails('select wa_account_token(''PN-MOLEFE'')', 'permission denied', 'browser cannot read tokens');
select pg_temp.fails(format('update wa_accounts set waba_id = %L', 'X'), 'permission denied', 'no direct edits to wa_accounts');
-- reconnecting without a token keeps the existing one
select connect_wa_account(:'biz', 'PN-MOLEFE', 'WABA-1', '+267 71 000 009');

-- 6. Stranger sees nothing and cannot claim the number ----------------------------------------
set local request.uid = 'a0000000-0000-0000-0000-00000000000c';
select pg_temp.eq((select count(*) from products), 0::bigint, 'stranger sees no products');
select create_business('Other Shop', 'Mpho') as other \gset
select pg_temp.fails(format('select connect_wa_account(%L, %L, %L, %L)', :'other', 'PN-MOLEFE', 'W', '+267'),
                     'already connected to another business', 'number cannot be stolen');
select pg_temp.fails(format('select import_products(%L, %L)', :'biz', '[]'), 'only owners and managers',
                     'cannot import into someone else''s shop');

-- 7. Server side: token readable --------------------------------------------------------------
reset role;
select pg_temp.eq(wa_account_token('PN-MOLEFE'), 'EAAG-secret-token', 'server reads token; reconnect kept it');

rollback;
\o
\echo '  dashboard rules: all assertions passed'
