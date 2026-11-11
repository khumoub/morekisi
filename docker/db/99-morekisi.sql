-- Runs once, when the local database volume is first created.
-- Gives the Supabase service roles the local password (the Supabase image creates the roles).
\set pgpass `echo "$POSTGRES_PASSWORD"`
alter user authenticator with password :'pgpass';
alter user supabase_auth_admin with password :'pgpass';
