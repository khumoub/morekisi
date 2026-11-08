-- Inbox helpers

create function increment_unread(p_conversation uuid) returns void
language sql as $$
  update conversations set unread_count = unread_count + 1 where id = p_conversation;
$$;

create function mark_conversation_read(p_conversation uuid) returns void
language sql as $$
  update conversations set unread_count = 0
  where id = p_conversation and business_id in (select my_business_ids());
$$;

revoke execute on function increment_unread from public, anon, authenticated;
