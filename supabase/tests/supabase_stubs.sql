-- Minimal stand-ins for what Supabase provides, so migrations can run on plain Postgres in tests.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- auth: users (Supabase stores phone without "+") and auth.uid() from a test setting
create schema auth;
create table auth.users (id uuid primary key, phone text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

-- vault: same function/view names as Supabase Vault (no real encryption in tests)
create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique, description text, secret text not null
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as
  $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                    new_description text default null)
returns void language sql as
  $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
