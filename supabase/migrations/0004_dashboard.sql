-- Morekisi week 2: dashboard sign-in, onboarding, role enforcement, product import, WhatsApp connection
-- Depends on 0001–0003

-- ───────────────────────── Who is signed in ─────────────────────────
-- Supabase stores auth phones without "+"; business_users uses E.164.
create function my_phone() returns text
language sql stable security definer set search_path = public as $$
  select '+' || ltrim(phone, '+') from auth.users where id = auth.uid() and phone is not null and phone <> '';
$$;

/**
 * Called after each sign-in: links this login to every business_users row with the same phone
 * (staff added by an owner before they ever signed in). Returns how many memberships were linked.
 */
create function claim_memberships() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or my_phone() is null then return 0; end if;
  update business_users set auth_user_id = auth.uid()
  where phone = my_phone() and active and auth_user_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Lower-case, dash-separated, unique slug for the public shop link.
create function unique_slug(p_name text) returns text
language plpgsql as $$
declare base text; candidate text; i integer := 1;
begin
  base := trim(both '-' from regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'));
  if base = '' then base := 'shop'; end if;
  candidate := base;
  while exists (select 1 from businesses where slug = candidate) loop
    i := i + 1;
    candidate := base || '-' || i;
  end loop;
  return candidate;
end $$;

/** A signed-in person creates their shop and becomes its owner. */
create function create_business(p_name text, p_owner_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text := my_phone();
begin
  if auth.uid() is null or v_phone is null then raise exception 'sign in with a phone number first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'shop name is required'; end if;

  insert into businesses (name, slug) values (trim(p_name), unique_slug(p_name)) returning id into v_id;
  insert into business_users (business_id, auth_user_id, name, phone, role)
  values (v_id, auth.uid(), coalesce(nullif(trim(p_owner_name), ''), 'Owner'), v_phone, 'owner');
  return v_id;
end $$;

revoke execute on function unique_slug from public, anon, authenticated;
revoke execute on function create_business, claim_memberships from public, anon;
grant execute on function create_business, claim_memberships to authenticated;

-- ───────────────────────── Role enforcement (restrictive policies) ─────────────────────────
-- tenant_isolation (0001/0002) decides WHICH business; these decide WHO in it may write.
-- Restrictive policies are AND-ed with the permissive ones.

create function is_manager(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role(p_business) in ('owner', 'manager'), false);
$$;

create function is_owner(p_business uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role(p_business) = 'owner', false);
$$;

-- Catalogue: owners and managers
create policy managers_insert on products as restrictive for insert with check (is_manager(business_id));
create policy managers_update on products as restrictive for update using (is_manager(business_id));
create policy managers_delete on products as restrictive for delete using (is_manager(business_id));
create policy managers_insert on categories as restrictive for insert with check (is_manager(business_id));
create policy managers_update on categories as restrictive for update using (is_manager(business_id));
create policy managers_delete on categories as restrictive for delete using (is_manager(business_id));

-- Stock ledger: dashboard inserts by owners/managers only; never edited or deleted
create policy managers_insert on stock_movements as restrictive for insert with check (is_manager(business_id));
create policy ledger_no_update on stock_movements as restrictive for update using (false);
create policy ledger_no_delete on stock_movements as restrictive for delete using (false);

-- Settings and staff: owners only
create policy owners_update on businesses as restrictive for update using (is_owner(id));
create policy owners_insert on business_users as restrictive for insert with check (is_owner(business_id));
create policy owners_update on business_users as restrictive for update using (is_owner(business_id));
create policy owners_delete on business_users as restrictive for delete using (is_owner(business_id));

-- WhatsApp accounts are only changed through connect_wa_account (below)
revoke insert, update, delete on wa_accounts from anon, authenticated;

-- Sales, payments, orders etc. are written only by server functions (service role).
revoke insert, update, delete on sales, sale_items, payments, quotations, quotation_items,
  orders, order_items, cash_ups, doc_counters from anon, authenticated;

-- ───────────────────────── Cost prices: owners and managers only ─────────────────────────
-- Staff can read products but not cost_price. Writing cost_price is still allowed (managers only, by policy).
revoke select on products from anon, authenticated;
grant select (id, business_id, sku, name, aliases, unit, sell_price, reorder_level, active, created_at,
              search_text, category_id, description, image_path, show_in_shop, track_stock)
  on products to authenticated;

create function product_costs(p_business uuid) returns table (product_id uuid, cost_price bigint)
language sql stable security definer set search_path = public as $$
  select p.id, p.cost_price from products p where p.business_id = p_business and is_manager(p_business);
$$;

-- ───────────────────────── Product import (CSV) ─────────────────────────
/**
 * p_rows: [{"sku","name","category","unit","sell_price","cost_price","reorder_level","stock"}]
 * Money in thebe. Matches existing products by SKU, else by name (case-insensitive).
 * "stock" is the counted quantity on hand: new products get an opening movement, existing ones
 * get an adjustment to reach the count (so re-importing a stock-take file works).
 * Runs as the caller, so RLS and the manager-only policies apply.
 */
create function import_products(p_business uuid, p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  r          jsonb;
  v_cat      uuid;
  v_id       uuid;
  v_on_hand  numeric;
  v_target   numeric;
  v_created  integer := 0;
  v_updated  integer := 0;
  v_user     uuid;
begin
  if not is_manager(p_business) then raise exception 'only owners and managers can import products'; end if;
  select id into v_user from business_users where business_id = p_business and auth_user_id = auth.uid();

  for r in select * from jsonb_array_elements(p_rows) loop
    v_cat := null;
    if coalesce(r->>'category', '') <> '' then
      insert into categories (business_id, name) values (p_business, trim(r->>'category'))
      on conflict (business_id, name) do nothing;
      select id into v_cat from categories where business_id = p_business and name = trim(r->>'category');
    end if;

    v_id := null;
    if coalesce(r->>'sku', '') <> '' then
      select id into v_id from products where business_id = p_business and sku = trim(r->>'sku');
    end if;
    if v_id is null then
      select id into v_id from products
      where business_id = p_business and lower(name) = lower(trim(r->>'name')) and sku is not distinct from nullif(trim(r->>'sku'), '')
      limit 1;
    end if;

    if v_id is null then
      insert into products (business_id, sku, name, unit, sell_price, cost_price, reorder_level, category_id)
      values (p_business, nullif(trim(r->>'sku'), ''), trim(r->>'name'), coalesce(nullif(r->>'unit', ''), 'each'),
              (r->>'sell_price')::bigint, coalesce((r->>'cost_price')::bigint, 0),
              coalesce((r->>'reorder_level')::numeric, 0), v_cat)
      returning id into v_id;
      v_created := v_created + 1;
    else
      update products set
        name          = trim(r->>'name'),
        unit          = coalesce(nullif(r->>'unit', ''), unit),
        sell_price    = (r->>'sell_price')::bigint,
        reorder_level = coalesce((r->>'reorder_level')::numeric, reorder_level),
        category_id   = coalesce(v_cat, category_id),
        active        = true
      where id = v_id;
      -- cost_price is written without reading it (callers may not have SELECT on that column)
      if r->>'cost_price' is not null then
        update products set cost_price = (r->>'cost_price')::bigint where id = v_id;
      end if;
      v_updated := v_updated + 1;
    end if;

    if r ? 'stock' and r->>'stock' is not null then
      v_target := (r->>'stock')::numeric;
      select coalesce(sum(qty), 0) into v_on_hand from stock_movements where product_id = v_id;
      if v_target <> v_on_hand then
        insert into stock_movements (business_id, product_id, qty, type, reason, created_by)
        values (p_business, v_id, v_target - v_on_hand,
                case when v_on_hand = 0 and not exists (select 1 from stock_movements where product_id = v_id)
                     then 'opening' else 'adjustment' end::movement_type,
                'CSV import', v_user);
      end if;
    end if;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated);
end $$;

grant execute on function import_products to authenticated;

-- ───────────────────────── Connecting a shop's WhatsApp number ─────────────────────────
/**
 * Owner connects (or reconnects) the shop's WhatsApp number. The access token goes straight into
 * Supabase Vault; only the server (service role) can read it back, via wa_account_token().
 */
create function connect_wa_account(
  p_business uuid, p_phone_number_id text, p_waba_id text, p_display_phone text, p_token text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare a wa_accounts; v_secret uuid; v_id uuid;
begin
  if not is_owner(p_business) then raise exception 'only the owner can connect WhatsApp'; end if;
  if exists (select 1 from wa_accounts where phone_number_id = p_phone_number_id and business_id <> p_business) then
    raise exception 'this WhatsApp number is already connected to another business';
  end if;

  update wa_accounts set active = false where business_id = p_business and phone_number_id <> p_phone_number_id;

  select * into a from wa_accounts where phone_number_id = p_phone_number_id;
  if p_token is not null and p_token <> '' then
    if a.token_secret_id is not null then
      perform vault.update_secret(a.token_secret_id, p_token);
      v_secret := a.token_secret_id;
    else
      v_secret := vault.create_secret(p_token, 'wa_token_' || p_phone_number_id, 'WhatsApp access token');
    end if;
  else
    v_secret := a.token_secret_id;
  end if;

  insert into wa_accounts (business_id, phone_number_id, waba_id, display_phone, token_secret_id, active)
  values (p_business, p_phone_number_id, p_waba_id, p_display_phone, v_secret, true)
  on conflict (phone_number_id) do update set
    waba_id = excluded.waba_id, display_phone = excluded.display_phone,
    token_secret_id = excluded.token_secret_id, active = true
  returning id into v_id;
  return v_id;
end $$;

create function disconnect_wa_account(p_business uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner(p_business) then raise exception 'only the owner can disconnect WhatsApp'; end if;
  update wa_accounts set active = false where business_id = p_business;
end $$;

/** Server only: the decrypted token for a shop's number (null → fall back to the platform token). */
create function wa_account_token(p_phone_number_id text) returns text
language sql stable security definer set search_path = public as $$
  select ds.decrypted_secret
  from wa_accounts a join vault.decrypted_secrets ds on ds.id = a.token_secret_id
  where a.phone_number_id = p_phone_number_id and a.active;
$$;

revoke execute on function connect_wa_account, disconnect_wa_account from public, anon;
grant execute on function connect_wa_account, disconnect_wa_account to authenticated;
revoke execute on function wa_account_token from public, anon, authenticated;
grant execute on function wa_account_token to service_role;
