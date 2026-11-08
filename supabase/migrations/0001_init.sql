-- Morekisi MVP schema
-- Money is stored as bigint thebe (1 BWP = 100 thebe). Quantities are numeric (allow 2.5 m, 0.5 kg).

create extension if not exists pg_trgm;

-- ───────────────────────── Tenancy ─────────────────────────
create table businesses (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  trading_name    text,
  address         text,
  phone           text,
  email           text,
  vat_registered  boolean not null default false,
  vat_number      text,
  vat_rate_bp     integer not null default 1400,      -- basis points: 1400 = 14%
  prices_include_vat boolean not null default true,
  currency        text not null default 'BWP',
  timezone        text not null default 'Africa/Gaborone',
  daily_report_time time not null default '18:00',
  invoice_footer  text,                               -- bank / mobile money details
  created_at      timestamptz not null default now()
);

create table branches (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);

create type user_role as enum ('owner', 'manager', 'staff');

create table business_users (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  auth_user_id uuid references auth.users(id) on delete set null,
  name        text not null,
  phone       text not null,                          -- E.164, e.g. +26771234567
  role        user_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (business_id, phone)
);
-- MVP uses one shared WhatsApp number, so a phone must map to exactly one active business.
create unique index business_users_active_phone on business_users (phone) where active;

-- ───────────────────────── Catalogue & stock ─────────────────────────
create table products (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  sku           text,
  name          text not null,
  aliases       text[] not null default '{}',         -- "cem", "42.5", "Y12"
  unit          text not null default 'each',         -- each, bag, m, kg, sheet
  sell_price    bigint not null check (sell_price >= 0),
  cost_price    bigint not null default 0 check (cost_price >= 0),  -- EXCL VAT (input VAT is reclaimable)
  reorder_level numeric not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  search_text   text generated always as (lower(name || ' ' || coalesce(sku, ''))) stored,
  unique (business_id, sku)
);
create index products_search_trgm on products using gin (search_text gin_trgm_ops);
create index products_business on products (business_id) where active;

create type movement_type as enum ('opening', 'purchase', 'sale', 'adjustment', 'return', 'void');

create table stock_movements (
  id          bigint generated always as identity primary key,
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id   uuid references branches(id),
  product_id  uuid not null references products(id),
  qty         numeric not null check (qty <> 0),      -- + in, - out
  type        movement_type not null,
  unit_cost   bigint,                                 -- for purchases
  reason      text,
  sale_id     uuid,
  supplier    text,
  created_by  uuid references business_users(id),
  created_at  timestamptz not null default now()
);
create index stock_movements_product on stock_movements (product_id);

create view product_stock with (security_invoker = true) as
select p.id as product_id, p.business_id, p.name, p.unit, p.reorder_level,
       coalesce(sum(m.qty), 0) as on_hand,
       coalesce(sum(m.qty), 0) <= p.reorder_level as low_stock
from products p
left join stock_movements m on m.product_id = p.id
group by p.id;

-- ───────────────────────── Customers ─────────────────────────
create table customers (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references businesses(id) on delete cascade,
  name         text not null,
  phone        text,
  company      text,
  credit_limit bigint not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  search_text  text generated always as (lower(name || ' ' || coalesce(company, '') || ' ' || coalesce(phone, ''))) stored
);
create index customers_search_trgm on customers using gin (search_text gin_trgm_ops);

-- ───────────────────────── Document numbering (gap-free) ─────────────────────────
create table doc_counters (
  business_id uuid not null references businesses(id) on delete cascade,
  doc_type    text not null,                          -- 'INV', 'QT', 'RCPT'
  last_no     integer not null default 0,
  primary key (business_id, doc_type)
);

create function next_doc_no(p_business uuid, p_type text) returns text
language plpgsql as $$
declare n integer;
begin
  insert into doc_counters (business_id, doc_type, last_no) values (p_business, p_type, 1)
  on conflict (business_id, doc_type) do update set last_no = doc_counters.last_no + 1
  returning last_no into n;
  return p_type || '-' || lpad(n::text, 5, '0');
end $$;

-- ───────────────────────── Sales ─────────────────────────
create type payment_method as enum ('cash', 'card', 'orange_money', 'myzaka', 'smega', 'eft', 'credit');
create type sale_status as enum ('completed', 'void');
create type channel as enum ('whatsapp', 'dashboard');

create table sales (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references businesses(id) on delete cascade,
  branch_id     uuid references branches(id),
  invoice_no    text not null,
  customer_id   uuid references customers(id),
  payment_method payment_method not null,
  status        sale_status not null default 'completed',
  subtotal_excl bigint not null,
  vat_amount    bigint not null,
  total         bigint not null,
  cost_total    bigint not null,                      -- snapshot for profit
  quotation_id  uuid,
  channel       channel not null,
  created_by    uuid references business_users(id),
  void_reason   text,
  pdf_path      text,
  created_at    timestamptz not null default now(),
  unique (business_id, invoice_no),
  check (payment_method <> 'credit' or customer_id is not null)
);
create index sales_business_date on sales (business_id, created_at desc);

create table sale_items (
  id          bigint generated always as identity primary key,
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid not null references products(id),
  description text not null,                          -- snapshot of product name
  qty         numeric not null check (qty > 0),
  unit_price  bigint not null,                        -- as charged (VAT-incl if business prices incl VAT)
  unit_cost   bigint not null,
  line_total  bigint not null
);

alter table stock_movements add constraint stock_movements_sale_fk foreign key (sale_id) references sales(id);

-- ───────────────────────── Quotations ─────────────────────────
create type quote_status as enum ('open', 'accepted', 'expired', 'cancelled');

create table quotations (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  quote_no    text not null,
  customer_id uuid references customers(id),
  customer_name text,                                 -- walk-in quote without a customer record
  status      quote_status not null default 'open',
  total       bigint not null,
  valid_until date not null default (current_date + 14),
  created_by  uuid references business_users(id),
  pdf_path    text,
  created_at  timestamptz not null default now(),
  unique (business_id, quote_no)
);

create table quotation_items (
  id           bigint generated always as identity primary key,
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id   uuid not null references products(id),
  description  text not null,
  qty          numeric not null check (qty > 0),
  unit_price   bigint not null,
  line_total   bigint not null
);

alter table sales add constraint sales_quotation_fk foreign key (quotation_id) references quotations(id);

-- ───────────────────────── Customer payments ─────────────────────────
create table payments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id),
  amount      bigint not null check (amount > 0),
  method      payment_method not null check (method <> 'credit'),
  reference   text,
  receipt_no  text not null,
  created_by  uuid references business_users(id),
  created_at  timestamptz not null default now(),
  unique (business_id, receipt_no)
);

create view customer_balances with (security_invoker = true) as
select c.id as customer_id, c.business_id, c.name, c.credit_limit,
       coalesce(s.owed, 0) - coalesce(p.paid, 0) as balance,
       s.oldest_unpaid
from customers c
left join (select customer_id, sum(total) as owed, min(created_at) as oldest_unpaid
           from sales where payment_method = 'credit' and status = 'completed'
           group by customer_id) s on s.customer_id = c.id
left join (select customer_id, sum(amount) as paid from payments group by customer_id) p
       on p.customer_id = c.id;

-- ───────────────────────── WhatsApp ─────────────────────────
create table wa_messages (
  id            bigint generated always as identity primary key,
  wa_message_id text unique,                          -- dedupe Meta retries
  business_id   uuid references businesses(id) on delete cascade,
  user_id       uuid references business_users(id),
  direction     text not null check (direction in ('in', 'out')),
  phone         text not null,
  body          text,
  payload       jsonb,
  intent        jsonb,                                -- AI interpretation (for accuracy review)
  created_at    timestamptz not null default now()
);

create table pending_actions (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id     uuid not null references business_users(id) on delete cascade,
  kind        text not null,                          -- 'create_sale', 'record_payment', 'stock_in', ...
  payload     jsonb not null,
  expires_at  timestamptz not null default now() + interval '15 minutes',
  created_at  timestamptz not null default now()
);
create unique index pending_actions_one_per_user on pending_actions (user_id);

-- ───────────────────────── Transactional write functions ─────────────────────────
-- p_items: [{"product_id": "...", "qty": 20, "unit_price": 9500}]  (unit_price optional → product sell_price)
create function create_sale(
  p_business uuid, p_user uuid, p_customer uuid, p_method payment_method,
  p_items jsonb, p_channel channel default 'whatsapp', p_quotation uuid default null
) returns sales
language plpgsql as $$
declare
  b        businesses;
  s        sales;
  it       jsonb;
  pr       products;
  v_qty    numeric;
  v_price  bigint;
  v_line   bigint;
  v_total  bigint := 0;
  v_cost   bigint := 0;
  v_vat    bigint;
begin
  select * into b from businesses where id = p_business;
  if not found then raise exception 'business not found'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'sale has no items'; end if;

  insert into sales (business_id, invoice_no, customer_id, payment_method,
                     subtotal_excl, vat_amount, total, cost_total, quotation_id, channel, created_by)
  values (p_business, next_doc_no(p_business, 'INV'), p_customer, p_method,
          0, 0, 0, 0, p_quotation, p_channel, p_user)
  returning * into s;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = p_business;
    if not found then raise exception 'product % not found', it->>'product_id'; end if;
    v_qty   := (it->>'qty')::numeric;
    v_price := coalesce((it->>'unit_price')::bigint, pr.sell_price);
    v_line  := round(v_qty * v_price);

    insert into sale_items (sale_id, product_id, description, qty, unit_price, unit_cost, line_total)
    values (s.id, pr.id, pr.name, v_qty, v_price, pr.cost_price, v_line);

    insert into stock_movements (business_id, product_id, qty, type, sale_id, created_by)
    values (p_business, pr.id, -v_qty, 'sale', s.id, p_user);

    v_total := v_total + v_line;
    v_cost  := v_cost + round(v_qty * pr.cost_price);
  end loop;

  if not b.vat_registered then
    v_vat := 0;
  elsif b.prices_include_vat then
    v_vat := round(v_total * b.vat_rate_bp / (10000.0 + b.vat_rate_bp));
  else
    v_vat := round(v_total * b.vat_rate_bp / 10000.0);
    v_total := v_total + v_vat;
  end if;

  update sales set
    total = v_total, vat_amount = v_vat, subtotal_excl = v_total - v_vat, cost_total = v_cost
  where id = s.id returning * into s;

  if p_quotation is not null then
    update quotations set status = 'accepted' where id = p_quotation and business_id = p_business;
  end if;
  return s;
end $$;

create function void_sale(p_sale uuid, p_user uuid, p_reason text) returns sales
language plpgsql as $$
declare s sales;
begin
  update sales set status = 'void', void_reason = p_reason
  where id = p_sale and status = 'completed' returning * into s;
  if not found then raise exception 'sale not found or already void'; end if;

  insert into stock_movements (business_id, product_id, qty, type, sale_id, reason, created_by)
  select s.business_id, product_id, qty, 'void', s.id, p_reason, p_user
  from sale_items where sale_id = s.id;
  return s;
end $$;

create function record_payment(
  p_business uuid, p_user uuid, p_customer uuid, p_amount bigint,
  p_method payment_method, p_reference text default null
) returns payments
language plpgsql as $$
declare p payments;
begin
  insert into payments (business_id, customer_id, amount, method, reference, receipt_no, created_by)
  values (p_business, p_customer, p_amount, p_method, p_reference,
          next_doc_no(p_business, 'RCPT'), p_user)
  returning * into p;
  return p;
end $$;

create function stock_in(
  p_business uuid, p_user uuid, p_product uuid, p_qty numeric,
  p_unit_cost bigint default null, p_supplier text default null
) returns stock_movements
language plpgsql as $$
declare m stock_movements;
begin
  if p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  insert into stock_movements (business_id, product_id, qty, type, unit_cost, supplier, created_by)
  values (p_business, p_product, p_qty, 'purchase', p_unit_cost, p_supplier, p_user)
  returning * into m;
  if p_unit_cost is not null then
    update products set cost_price = p_unit_cost where id = p_product and business_id = p_business;
  end if;
  return m;
end $$;

-- ───────────────────────── Read-only report functions (the only tools the AI "ask" intent gets) ─────────────────────────
create function sales_summary(p_business uuid, p_from timestamptz, p_to timestamptz)
returns table (sales_count bigint, revenue bigint, vat bigint, gross_profit bigint, credit_sales bigint)
language sql stable as $$
  select count(*), coalesce(sum(total), 0), coalesce(sum(vat_amount), 0),
         coalesce(sum(subtotal_excl - cost_total), 0),
         coalesce(sum(total) filter (where payment_method = 'credit'), 0)
  from sales
  where business_id = p_business and status = 'completed'
    and created_at >= p_from and created_at < p_to;
$$;

create function top_products(p_business uuid, p_from timestamptz, p_to timestamptz, p_limit int default 10)
returns table (product_id uuid, name text, qty numeric, revenue bigint)
language sql stable as $$
  select i.product_id, i.description, sum(i.qty), sum(i.line_total)::bigint
  from sale_items i join sales s on s.id = i.sale_id
  where s.business_id = p_business and s.status = 'completed'
    and s.created_at >= p_from and s.created_at < p_to
  group by i.product_id, i.description
  order by sum(i.line_total) desc
  limit p_limit;
$$;

-- Fuzzy match for the WhatsApp pipeline: "cem 42" → Cement 42.5N 50kg
create function match_products(p_business uuid, p_query text, p_limit int default 5)
returns table (id uuid, name text, sell_price bigint, score real)
language sql stable as $$
  select * from (
    select p.id, p.name, p.sell_price,
           greatest(word_similarity(lower(p_query), p.search_text),
                    coalesce((select max(similarity(lower(a), lower(p_query))) from unnest(p.aliases) a), 0)) as score
    from products p
    where p.business_id = p_business and p.active
  ) m
  where m.score >= 0.3
  order by m.score desc
  limit p_limit;
$$;

-- ───────────────────────── Row Level Security ─────────────────────────
-- Dashboard users (Supabase Auth) see only their own business.
-- The WhatsApp webhook runs server-side with the service role and passes business_id explicitly.
create function my_business_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select business_id from business_users where auth_user_id = auth.uid() and active;
$$;

create function my_role(p_business uuid) returns user_role
language sql stable security definer set search_path = public as $$
  select role from business_users where auth_user_id = auth.uid() and business_id = p_business and active;
$$;

do $$
declare t text;
begin
  foreach t in array array['branches','business_users','products','stock_movements','customers',
                           'sales','quotations','payments','doc_counters','wa_messages','pending_actions']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (business_id in (select my_business_ids()))', t);
  end loop;
end $$;

alter table businesses enable row level security;
create policy tenant_isolation on businesses using (id in (select my_business_ids()));

alter table sale_items enable row level security;
create policy tenant_isolation on sale_items
  using (sale_id in (select id from sales where business_id in (select my_business_ids())));

alter table quotation_items enable row level security;
create policy tenant_isolation on quotation_items
  using (quotation_id in (select id from quotations where business_id in (select my_business_ids())));

-- Write functions are called by the server only (service role), never directly by browsers.
revoke execute on function create_sale, void_sale, record_payment, stock_in from public, anon, authenticated;

-- TODO (week 6): hide cost_price / cost_total / unit_cost from role 'staff' via column-limited views for the dashboard.
