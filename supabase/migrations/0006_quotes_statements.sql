-- Morekisi week 4: quotations, converting them to sales, customer statements
-- Depends on 0001–0005

alter table quotations
  add column subtotal_excl bigint not null default 0,
  add column vat_amount    bigint not null default 0,
  add column notes         text;

/**
 * Creates a quotation. p_items: [{"product_id","qty","unit_price"?}] (price defaults to the
 * product's selling price). Either an existing customer, or just a name for someone not yet a customer.
 */
create function create_quote(
  p_business uuid, p_user uuid, p_customer uuid, p_customer_name text, p_items jsonb, p_valid_days int default 14
) returns quotations
language plpgsql as $$
declare
  b       businesses;
  q       quotations;
  it      jsonb;
  pr      products;
  v_qty   numeric;
  v_price bigint;
  v_line  bigint;
  v_total bigint := 0;
  v_vat   bigint;
begin
  select * into b from businesses where id = p_business;
  if not found then raise exception 'business not found'; end if;
  if jsonb_array_length(p_items) = 0 then raise exception 'quotation has no items'; end if;

  insert into quotations (business_id, quote_no, customer_id, customer_name, total, valid_until, created_by)
  values (p_business, next_doc_no(p_business, 'QT'), p_customer, nullif(trim(p_customer_name), ''), 0,
          current_date + greatest(p_valid_days, 1), p_user)
  returning * into q;

  for it in select * from jsonb_array_elements(p_items) loop
    select * into pr from products where id = (it->>'product_id')::uuid and business_id = p_business;
    if not found then raise exception 'product % not found', it->>'product_id'; end if;
    v_qty   := (it->>'qty')::numeric;
    v_price := coalesce((it->>'unit_price')::bigint, pr.sell_price);
    v_line  := round(v_qty * v_price);
    insert into quotation_items (quotation_id, product_id, description, qty, unit_price, line_total)
    values (q.id, pr.id, pr.name, v_qty, v_price, v_line);
    v_total := v_total + v_line;
  end loop;

  if not b.vat_registered then
    v_vat := 0;
  elsif b.prices_include_vat then
    v_vat := round(v_total * b.vat_rate_bp / (10000.0 + b.vat_rate_bp));
  else
    v_vat := round(v_total * b.vat_rate_bp / 10000.0);
    v_total := v_total + v_vat;
  end if;

  update quotations set total = v_total, vat_amount = v_vat, subtotal_excl = v_total - v_vat
  where id = q.id returning * into q;
  return q;
end $$;

/**
 * The customer accepted: becomes a sale at the QUOTED prices (even if prices changed since).
 * A quote for a name-only customer becomes a cash/card sale, or adds them as a customer for credit.
 */
create function convert_quote(p_quote uuid, p_user uuid, p_method payment_method) returns sales
language plpgsql as $$
declare
  q       quotations;
  v_cust  uuid;
  v_items jsonb;
begin
  select * into q from quotations where id = p_quote for update;
  if not found then raise exception 'quotation not found'; end if;
  if q.status <> 'open' then raise exception 'quotation % is %', q.quote_no, q.status; end if;

  v_cust := q.customer_id;
  if v_cust is null and p_method = 'credit' then
    if q.customer_name is null then raise exception 'a credit sale needs a customer'; end if;
    insert into customers (business_id, name, source) values (q.business_id, q.customer_name, 'manual')
    returning id into v_cust;
    update quotations set customer_id = v_cust where id = q.id;
  end if;

  select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty, 'unit_price', unit_price,
                                      'description', description) order by id)
  into v_items from quotation_items where quotation_id = q.id;

  return create_sale(q.business_id, p_user, v_cust, p_method, v_items, 'whatsapp', q.id);
end $$;

-- Everything needed to draw a quotation PDF (same shape as invoice_data, plus validity)
create function quote_data(p_quote uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'kind', 'quote',
    'business', jsonb_build_object(
      'name', b.name, 'trading_name', b.trading_name, 'address', b.address, 'phone', b.phone,
      'email', b.email, 'vat_registered', b.vat_registered, 'vat_number', b.vat_number,
      'vat_rate_bp', b.vat_rate_bp, 'invoice_footer', b.invoice_footer),
    'sale', jsonb_build_object(
      'id', q.id, 'invoice_no', q.quote_no, 'created_at', q.created_at, 'payment_method', null,
      'subtotal_excl', q.subtotal_excl, 'vat_amount', q.vat_amount, 'total', q.total,
      'status', case when q.status = 'open' and q.valid_until < current_date then 'expired' else q.status::text end),
    'valid_until', q.valid_until,
    'customer', case
      when c.id is not null then jsonb_build_object('name', c.name, 'phone', c.phone, 'company', c.company)
      when q.customer_name is not null then jsonb_build_object('name', q.customer_name, 'phone', null, 'company', null)
      else null end,
    'served_by', u.name,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'description', i.description, 'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total)
                order by i.id), '[]'::jsonb)
              from quotation_items i where i.quotation_id = q.id),
    'balance_after', null
  )
  from quotations q
  join businesses b on b.id = q.business_id
  left join customers c on c.id = q.customer_id
  left join business_users u on u.id = q.created_by
  where q.id = p_quote;
$$;

/** Credit sales (debit) and payments (credit) for one customer, oldest first. Runs as the caller (RLS). */
create function customer_statement(p_customer uuid)
returns table (at timestamptz, kind text, ref text, debit bigint, credit bigint, detail text)
language sql stable security invoker as $$
  select s.created_at, 'invoice', s.invoice_no, s.total, 0::bigint,
         case when s.payment_method = 'credit' then 'On account'
              else 'Paid: ' || replace(s.payment_method::text, '_', ' ') end
  from sales s
  where s.customer_id = p_customer and s.status = 'completed' and s.payment_method = 'credit'
  union all
  select p.created_at, 'payment', p.receipt_no, 0::bigint, p.amount, replace(p.method::text, '_', ' ')
  from payments p
  where p.customer_id = p_customer
  order by 1, 3;
$$;

-- Dashboard actions on sales/quotes go through the server (service role), never the browser.
revoke execute on function create_quote, convert_quote, quote_data from public, anon, authenticated;
grant execute on function customer_statement to authenticated;

-- ───────────────────────── Cost/profit privacy on sales (completes 0004's product cost rule) ─────────────────────────
-- Signed-in users can read sales and their lines, but not what the goods cost the shop.
-- Profit figures reach owners/managers only through server-side reports.
revoke select on sales from anon, authenticated;
grant select (id, business_id, branch_id, invoice_no, customer_id, payment_method, status, subtotal_excl, vat_amount,
              total, quotation_id, channel, created_by, void_reason, pdf_path, created_at)
  on sales to authenticated;

revoke select on sale_items from anon, authenticated;
grant select (id, sale_id, product_id, description, qty, unit_price, line_total) on sale_items to authenticated;

revoke select on stock_movements from anon, authenticated;
grant select (id, business_id, branch_id, product_id, qty, type, reason, sale_id, supplier, created_by, created_at)
  on stock_movements to authenticated;
-- (inserting adjustments from the dashboard stays allowed for managers, per 0004)
grant insert on stock_movements to authenticated;

-- ───────────────────────── Recognise existing customers on WhatsApp ─────────────────────────
-- Customers added with a phone number but no WhatsApp id get one, so the bot links their
-- messages to their account (skipped if another customer of the shop already has that id).
update customers c
set wa_id = regexp_replace(c.phone, '\D', '', 'g')
where c.wa_id is null
  and c.phone ~ '^\+\d{8,15}$'
  and not exists (
    select 1 from customers o
    where o.business_id = c.business_id and o.wa_id = regexp_replace(c.phone, '\D', '', 'g')
  );
