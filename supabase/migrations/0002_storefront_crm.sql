-- Morekisi v0.2: storefront, CRM, order approval, cash-up
-- Depends on 0001_init.sql

-- ───────────────────────── Business settings ─────────────────────────
alter table businesses
  add column slug                   text unique,
  add column opening_hours          jsonb not null default '{}',   -- {"mon":["07:30","17:30"], ...}
  add column delivery_areas         jsonb not null default '[]',   -- [{"name":"Tlokweng","fee":15000}]
  add column require_order_approval boolean not null default true,
  add column max_discount_bp        integer not null default 1000, -- discounts above 10% need owner approval
  add column credit_approval_limit  bigint not null default 500000, -- credit sales above P5,000 need owner approval
  add column welcome_message        text;

-- ───────────────────────── Shop WhatsApp numbers ─────────────────────────
create table wa_accounts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  phone_number_id  text not null unique,      -- Meta's id; webhooks are routed by this
  waba_id          text not null,
  display_phone    text not null,
  token_secret_id  uuid,                      -- Supabase Vault secret holding the access token (null → env token, dev only)
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);
create unique index wa_accounts_one_active_per_business on wa_accounts (business_id) where active;

-- Each shop now has its own number, so a staff phone may belong to several businesses.
drop index business_users_active_phone;

-- ───────────────────────── Catalogue for the storefront ─────────────────────────
create table categories (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name        text not null,
  sort_order  integer not null default 0,
  unique (business_id, name)
);

alter table products
  add column category_id  uuid references categories(id) on delete set null,
  add column description  text,
  add column image_path   text,
  add column show_in_shop boolean not null default true,
  add column track_stock  boolean not null default true;      -- false for services such as "Delivery"

-- ───────────────────────── CRM ─────────────────────────
alter table customers
  add column wa_id        text,                               -- WhatsApp id (digits, e.g. 26771234567)
  add column tags         text[] not null default '{}',
  add column source       text not null default 'manual',     -- manual | whatsapp | import | ad
  add column last_seen_at timestamptz;
create unique index customers_wa_id on customers (business_id, wa_id) where wa_id is not null;

create type conversation_mode as enum ('bot', 'human');

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references businesses(id) on delete cascade,
  wa_id           text not null,                         -- the other party's WhatsApp id
  customer_id     uuid references customers(id) on delete set null,
  user_id         uuid references business_users(id) on delete set null,   -- set when it's a staff member
  mode            conversation_mode not null default 'bot',
  assigned_to     uuid references business_users(id) on delete set null,
  state           jsonb not null default '{}',           -- current flow step (browsing category, checkout step, ...)
  last_inbound_at timestamptz,                           -- for the 24-hour customer service window
  unread_count    integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, wa_id)
);
create index conversations_inbox on conversations (business_id, updated_at desc);

alter table wa_messages
  add column conversation_id uuid references conversations(id) on delete cascade,
  add column sent_by         uuid references business_users(id),  -- staff reply from the inbox (null = bot or inbound)
  add column status          text;                                 -- sent | delivered | read | failed
create index wa_messages_conversation on wa_messages (conversation_id, created_at);

-- ───────────────────────── Cart ─────────────────────────
create table carts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (customer_id)
);

create table cart_items (
  cart_id    uuid not null references carts(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  qty        numeric not null check (qty > 0),
  primary key (cart_id, product_id)
);

-- ───────────────────────── Orders ─────────────────────────
create type order_status as enum
  ('pending_approval', 'confirmed', 'ready', 'out_for_delivery', 'completed', 'rejected', 'cancelled');
create type fulfilment_type as enum ('collection', 'delivery');

create table orders (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  order_no         text not null,
  customer_id      uuid not null references customers(id),
  status           order_status not null default 'pending_approval',
  fulfilment       fulfilment_type not null default 'collection',
  delivery_address text,
  delivery_lat     double precision,
  delivery_lng     double precision,
  delivery_fee     bigint not null default 0,
  items_total      bigint not null,
  total            bigint not null,
  customer_note    text,
  staff_note       text,
  reject_reason    text,
  approved_by      uuid references business_users(id),
  approved_at      timestamptz,
  sale_id          uuid references sales(id),
  channel          channel not null default 'whatsapp',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, order_no)
);
create index orders_queue on orders (business_id, status, created_at desc);

create table order_items (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders(id) on delete cascade,
  product_id  uuid not null references products(id),
  description text not null,
  qty         numeric not null check (qty > 0),
  unit_price  bigint not null,
  line_total  bigint not null
);

-- Stock: on hand, reserved by confirmed (not yet completed) orders, available
drop view product_stock;
create view product_stock with (security_invoker = true) as
select p.id as product_id, p.business_id, p.name, p.unit, p.reorder_level, p.track_stock,
       coalesce(m.on_hand, 0)                         as on_hand,
       coalesce(r.reserved, 0)                        as reserved,
       coalesce(m.on_hand, 0) - coalesce(r.reserved, 0) as available,
       p.track_stock and coalesce(m.on_hand, 0) - coalesce(r.reserved, 0) <= p.reorder_level as low_stock
from products p
left join (select product_id, sum(qty) as on_hand from stock_movements group by product_id) m
       on m.product_id = p.id
left join (select oi.product_id, sum(oi.qty) as reserved
           from order_items oi join orders o on o.id = oi.order_id
           where o.status in ('confirmed', 'ready', 'out_for_delivery')
           group by oi.product_id) r
       on r.product_id = p.id;

-- ───────────────────────── Cash-up ─────────────────────────
create table cash_ups (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references businesses(id) on delete cascade,
  branch_id         uuid references branches(id),
  trading_date      date not null,
  declared_cash     bigint not null default 0,
  declared_card     bigint not null default 0,
  declared_mobile   bigint not null default 0,
  expected_cash     bigint not null,
  expected_card     bigint not null,
  expected_mobile   bigint not null,
  difference        bigint generated always as
                      ((declared_cash + declared_card + declared_mobile)
                       - (expected_cash + expected_card + expected_mobile)) stored,
  notes             text,
  submitted_by      uuid references business_users(id),
  created_at        timestamptz not null default now(),
  unique (business_id, trading_date)
);

-- ───────────────────────── Functions ─────────────────────────

-- create_sale v2: skips stock movements for non-stock items (services such as delivery)
create or replace function create_sale(
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
    values (s.id, pr.id, coalesce(it->>'description', pr.name), v_qty, v_price, pr.cost_price, v_line);

    if pr.track_stock then
      insert into stock_movements (business_id, product_id, qty, type, sale_id, created_by)
      values (p_business, pr.id, -v_qty, 'sale', s.id, p_user);
    end if;

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

-- The per-business "Delivery" service product used for delivery fees on invoices
create function delivery_product(p_business uuid) returns uuid
language plpgsql as $$
declare v_id uuid;
begin
  select id into v_id from products where business_id = p_business and sku = 'DELIVERY';
  if v_id is null then
    insert into products (business_id, sku, name, unit, sell_price, show_in_shop, track_stock)
    values (p_business, 'DELIVERY', 'Delivery', 'trip', 0, false, false)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Customer checks out their cart → order waiting for approval (or confirmed if approval is off)
create function place_order(
  p_business uuid, p_customer uuid, p_fulfilment fulfilment_type,
  p_address text default null, p_lat double precision default null, p_lng double precision default null,
  p_note text default null
) returns orders
language plpgsql as $$
declare
  b       businesses;
  c       carts;
  o       orders;
  v_total bigint;
begin
  select * into b from businesses where id = p_business;
  select * into c from carts where customer_id = p_customer and business_id = p_business;
  if not found or not exists (select 1 from cart_items where cart_id = c.id) then
    raise exception 'cart is empty';
  end if;

  insert into orders (business_id, order_no, customer_id, status, fulfilment,
                      delivery_address, delivery_lat, delivery_lng, items_total, total, customer_note)
  values (p_business, next_doc_no(p_business, 'ORD'), p_customer,
          case when b.require_order_approval then 'pending_approval' else 'confirmed' end::order_status,
          p_fulfilment, p_address, p_lat, p_lng, 0, 0, p_note)
  returning * into o;

  insert into order_items (order_id, product_id, description, qty, unit_price, line_total)
  select o.id, p.id, p.name, ci.qty, p.sell_price, round(ci.qty * p.sell_price)
  from cart_items ci join products p on p.id = ci.product_id
  where ci.cart_id = c.id and p.active;

  select coalesce(sum(line_total), 0) into v_total from order_items where order_id = o.id;
  update orders set items_total = v_total, total = v_total where id = o.id returning * into o;

  delete from cart_items where cart_id = c.id;
  return o;
end $$;

-- Staff approve an order, optionally setting the delivery fee
create function approve_order(p_order uuid, p_user uuid, p_delivery_fee bigint default null) returns orders
language plpgsql as $$
declare o orders;
begin
  update orders set
    status       = 'confirmed',
    delivery_fee = coalesce(p_delivery_fee, delivery_fee),
    total        = items_total + coalesce(p_delivery_fee, delivery_fee),
    approved_by  = p_user,
    approved_at  = now(),
    updated_at   = now()
  where id = p_order and status = 'pending_approval'
  returning * into o;
  if not found then raise exception 'order not found or not waiting for approval'; end if;
  return o;
end $$;

create function reject_order(p_order uuid, p_user uuid, p_reason text) returns orders
language plpgsql as $$
declare o orders;
begin
  update orders set status = 'rejected', reject_reason = p_reason, approved_by = p_user, updated_at = now()
  where id = p_order and status = 'pending_approval'
  returning * into o;
  if not found then raise exception 'order not found or not waiting for approval'; end if;
  return o;
end $$;

-- Move a confirmed order through ready / out_for_delivery / cancelled
create function set_order_status(p_order uuid, p_status order_status) returns orders
language plpgsql as $$
declare o orders;
begin
  if p_status not in ('ready', 'out_for_delivery', 'cancelled') then
    raise exception 'use approve_order / reject_order / complete_order for status %', p_status;
  end if;
  update orders set status = p_status, updated_at = now()
  where id = p_order and status in ('confirmed', 'ready', 'out_for_delivery')
  returning * into o;
  if not found then raise exception 'order not found or not active'; end if;
  return o;
end $$;

-- Delivered/collected → becomes a sale (invoice + stock out)
create function complete_order(p_order uuid, p_user uuid, p_method payment_method) returns sales
language plpgsql as $$
declare
  o       orders;
  s       sales;
  v_items jsonb;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.status not in ('confirmed', 'ready', 'out_for_delivery') then
    raise exception 'order not found or not active';
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty,
                                      'unit_price', unit_price, 'description', description))
  into v_items from order_items where order_id = o.id;

  if o.delivery_fee > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', delivery_product(o.business_id), 'qty', 1,
      'unit_price', o.delivery_fee, 'description', 'Delivery'));
  end if;

  s := create_sale(o.business_id, p_user, o.customer_id, p_method, v_items, o.channel);
  update orders set status = 'completed', sale_id = s.id, updated_at = now() where id = o.id;
  return s;
end $$;

-- Expected takings for a day, split by tender type (sales + customer payments received)
create function expected_takings(p_business uuid, p_date date)
returns table (cash bigint, card bigint, mobile bigint, credit bigint)
language sql stable as $$
  with b as (select timezone from businesses where id = p_business),
  bounds as (select (p_date::timestamp at time zone b.timezone) as t0,
                    ((p_date + 1)::timestamp at time zone b.timezone) as t1 from b),
  money_in as (
    select payment_method as m, total as amt from sales, bounds
     where business_id = p_business and status = 'completed' and created_at >= t0 and created_at < t1
    union all
    select method, amount from payments, bounds
     where business_id = p_business and created_at >= t0 and created_at < t1
  )
  select coalesce(sum(amt) filter (where m = 'cash'), 0)::bigint,
         coalesce(sum(amt) filter (where m in ('card', 'eft')), 0)::bigint,
         coalesce(sum(amt) filter (where m in ('orange_money', 'myzaka', 'smega')), 0)::bigint,
         coalesce(sum(amt) filter (where m = 'credit'), 0)::bigint
  from money_in;
$$;

create function submit_cash_up(
  p_business uuid, p_user uuid, p_date date,
  p_cash bigint, p_card bigint, p_mobile bigint, p_notes text default null
) returns cash_ups
language plpgsql as $$
declare e record; c cash_ups;
begin
  select * into e from expected_takings(p_business, p_date);
  insert into cash_ups (business_id, trading_date, declared_cash, declared_card, declared_mobile,
                        expected_cash, expected_card, expected_mobile, notes, submitted_by)
  values (p_business, p_date, p_cash, p_card, p_mobile, e.cash, e.card, e.mobile, p_notes, p_user)
  on conflict (business_id, trading_date) do update set
    declared_cash = excluded.declared_cash, declared_card = excluded.declared_card,
    declared_mobile = excluded.declared_mobile, expected_cash = excluded.expected_cash,
    expected_card = excluded.expected_card, expected_mobile = excluded.expected_mobile,
    notes = excluded.notes, submitted_by = excluded.submitted_by, created_at = now()
  returning * into c;
  return c;
end $$;

-- Storefront catalogue: what customers can see (never exposes cost)
create function shop_products(p_business uuid, p_category uuid default null)
returns table (id uuid, name text, description text, unit text, price bigint, available numeric, image_path text)
language sql stable as $$
  select p.id, p.name, p.description, p.unit, p.sell_price, ps.available, p.image_path
  from products p join product_stock ps on ps.product_id = p.id
  where p.business_id = p_business and p.active and p.show_in_shop
    and (p_category is null or p.category_id = p_category)
    and (not p.track_stock or ps.available > 0)
  order by p.name;
$$;

-- ───────────────────────── Row Level Security ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array['wa_accounts','categories','conversations','carts','orders','cash_ups']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy tenant_isolation on %I using (business_id in (select my_business_ids()))', t);
  end loop;
end $$;

alter table cart_items enable row level security;
create policy tenant_isolation on cart_items
  using (cart_id in (select id from carts where business_id in (select my_business_ids())));

alter table order_items enable row level security;
create policy tenant_isolation on order_items
  using (order_id in (select id from orders where business_id in (select my_business_ids())));

revoke execute on function
  create_sale, delivery_product, place_order, approve_order, reject_order,
  set_order_status, complete_order, submit_cash_up
from public, anon, authenticated;
