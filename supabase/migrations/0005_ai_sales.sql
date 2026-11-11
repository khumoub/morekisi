-- Morekisi week 3: AI-driven sales over WhatsApp
-- Depends on 0001–0004

-- Fuzzy customer match: "kabelo" → "Kabelo Molefe", "tlotlo construction" → "Tlotlo Construction (Pty) Ltd"
create function match_customers(p_business uuid, p_query text, p_limit int default 5)
returns table (id uuid, name text, phone text, score real)
language sql stable as $$
  select * from (
    select c.id, c.name, c.phone,
           greatest(word_similarity(lower(p_query), c.search_text), similarity(lower(c.name), lower(p_query))) as score
    from customers c
    where c.business_id = p_business
  ) m
  where m.score >= 0.35
  order by m.score desc, m.name
  limit p_limit;
$$;

-- Everything needed to draw an invoice, in one call (server/service role)
create function invoice_data(p_sale uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'business', jsonb_build_object(
      'name', b.name, 'trading_name', b.trading_name, 'address', b.address, 'phone', b.phone,
      'email', b.email, 'vat_registered', b.vat_registered, 'vat_number', b.vat_number,
      'vat_rate_bp', b.vat_rate_bp, 'invoice_footer', b.invoice_footer),
    'sale', jsonb_build_object(
      'id', s.id, 'invoice_no', s.invoice_no, 'created_at', s.created_at, 'payment_method', s.payment_method,
      'subtotal_excl', s.subtotal_excl, 'vat_amount', s.vat_amount, 'total', s.total, 'status', s.status),
    'customer', case when c.id is null then null else jsonb_build_object(
      'name', c.name, 'phone', c.phone, 'company', c.company) end,
    'served_by', u.name,
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'description', i.description, 'qty', i.qty, 'unit_price', i.unit_price, 'line_total', i.line_total)
                order by i.id), '[]'::jsonb)
              from sale_items i where i.sale_id = s.id),
    'balance_after', case when s.payment_method = 'credit' then
      (select balance from customer_balances cb where cb.customer_id = s.customer_id) end
  )
  from sales s
  join businesses b on b.id = s.business_id
  left join customers c on c.id = s.customer_id
  left join business_users u on u.id = s.created_by
  where s.id = p_sale;
$$;

revoke execute on function invoice_data from public, anon, authenticated;
