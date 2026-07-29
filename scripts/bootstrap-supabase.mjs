import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const envPath = path.resolve(repoRoot, 'artifacts/api-server/.env');

dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
const BACKUP_PATH = path.resolve(repoRoot, 'artifacts/api-server/mybackup.json');
const BOOTSTRAP_SQL_PATH = path.resolve(repoRoot, 'artifacts/api-server/supabase-bootstrap.sql');
const SEED_SQL_PATH = path.resolve(repoRoot, 'artifacts/api-server/seed-supabase.sql');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase URL or service key. Set SUPABASE_URL and SUPABASE_SERVICE_KEY/SUPABASE_SECRET_KEY in artifacts/api-server/.env');
  process.exit(1);
}

function buildBootstrapSql() {
  return `
create extension if not exists "uuid-ossp";

create table if not exists public.profiles (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  username text,
  phone text,
  email text,
  avatar_url text,
  game_handle text,
  wallet_balance numeric default 0,
  is_verified boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  referral_code text,
  bio text,
  followers_count integer default 0,
  following_count integer default 0
);

create table if not exists public.achievements (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  description text,
  icon text,
  points integer default 0,
  category text,
  requirement_type text,
  requirement_value integer default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tournaments (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  description text,
  game text,
  format text,
  status text,
  entry_fee numeric default 0,
  prize_pool numeric default 0,
  max_participants integer default 0,
  current_participants integer default 0,
  start_date timestamptz,
  end_date timestamptz,
  registration_deadline timestamptz,
  rules text,
  image_url text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  group_link text
);

create table if not exists public.marketplace_listings (
  id uuid primary key default uuid_generate_v4(),
  seller_id uuid not null,
  title text not null,
  description text,
  category text,
  price numeric default 0,
  image_url text,
  status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  tournament_id uuid not null,
  amount numeric default 0,
  method text,
  status text,
  transaction_code text,
  screenshot_url text,
  verified_by uuid,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.registrations (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null,
  user_id uuid not null,
  status text,
  payment_id uuid,
  game_handle text,
  seed_number integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  lobby_id text
);

create table if not exists public.user_statuses (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null,
  content text,
  media_url text,
  media_type text,
  likes_count integer default 0,
  views_count integer default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  comments_count integer default 0,
  post_type text,
  game text,
  tournament_id uuid,
  tags jsonb default '[]'::jsonb
);

create table if not exists public.matches (
  id uuid primary key default uuid_generate_v4(),
  tournament_id uuid not null,
  match_number integer not null,
  round integer default 1,
  player1_id uuid,
  player2_id uuid,
  player1_score integer,
  player2_score integer,
  status text,
  scheduled_at timestamptz,
  completed_at timestamptz,
  winner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists tournaments_created_by_idx on public.tournaments (created_by);
create index if not exists payments_user_id_idx on public.payments (user_id);
create index if not exists payments_tournament_id_idx on public.payments (tournament_id);
create index if not exists registrations_tournament_id_idx on public.registrations (tournament_id);
create index if not exists registrations_user_id_idx on public.registrations (user_id);
create index if not exists user_statuses_user_id_idx on public.user_statuses (user_id);
create index if not exists matches_tournament_id_idx on public.matches (tournament_id);

create or replace function public.trigger_set_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace trigger set_updated_at
before update on public.profiles
for each row execute function public.trigger_set_timestamp();

create or replace trigger set_updated_at
before update on public.tournaments
for each row execute function public.trigger_set_timestamp();

create or replace trigger set_updated_at
before update on public.marketplace_listings
for each row execute function public.trigger_set_timestamp();

create or replace trigger set_updated_at
before update on public.payments
for each row execute function public.trigger_set_timestamp();

create or replace trigger set_updated_at
before update on public.registrations
for each row execute function public.trigger_set_timestamp();

create or replace trigger set_updated_at
before update on public.matches
for each row execute function public.trigger_set_timestamp();

alter table public.profiles enable row level security;
alter table public.achievements enable row level security;
alter table public.tournaments enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.payments enable row level security;
alter table public.registrations enable row level security;
alter table public.user_statuses enable row level security;
alter table public.matches enable row level security;

drop policy if exists "profiles_select_public" on public.profiles;
create policy "profiles_select_public" on public.profiles for select using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = user_id);

drop policy if exists "tournaments_select_public" on public.tournaments;
create policy "tournaments_select_public" on public.tournaments for select using (true);

drop policy if exists "tournaments_manage_own" on public.tournaments;
create policy "tournaments_manage_own" on public.tournaments for all using (auth.uid() = created_by) with check (auth.uid() = created_by);

drop policy if exists "marketplace_select_public" on public.marketplace_listings;
create policy "marketplace_select_public" on public.marketplace_listings for select using (true);

drop policy if exists "marketplace_manage_own" on public.marketplace_listings;
create policy "marketplace_manage_own" on public.marketplace_listings for all using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

drop policy if exists "payments_manage_own" on public.payments;
create policy "payments_manage_own" on public.payments for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "registrations_manage_own" on public.registrations;
create policy "registrations_manage_own" on public.registrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_statuses_select_public" on public.user_statuses;
create policy "user_statuses_select_public" on public.user_statuses for select using (true);

drop policy if exists "user_statuses_manage_own" on public.user_statuses;
create policy "user_statuses_manage_own" on public.user_statuses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "matches_select_public" on public.matches;
create policy "matches_select_public" on public.matches for select using (true);

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.achievements, public.tournaments, public.marketplace_listings, public.payments, public.registrations, public.user_statuses, public.matches to anon, authenticated;
grant insert, update, delete on public.profiles, public.tournaments, public.marketplace_listings, public.payments, public.registrations, public.user_statuses, public.matches to authenticated;

do $$
begin
  if not exists (select 1 from pg_database where datname = current_database()) then
    raise notice 'skipping publication setup';
  end if;
exception when others then
  null;
end $$;

create publication if not exists supabase_realtime;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
      alter publication supabase_realtime add table public.profiles;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tournaments') then
      alter publication supabase_realtime add table public.tournaments;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
      alter publication supabase_realtime add table public.matches;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_statuses') then
      alter publication supabase_realtime add table public.user_statuses;
    end if;
  end if;
end $$;
`;
}

async function writeBootstrapFiles() {
  const sql = buildBootstrapSql();
  await mkdir(path.dirname(BOOTSTRAP_SQL_PATH), { recursive: true });
  await writeFile(BOOTSTRAP_SQL_PATH, sql, 'utf8');
  await writeFile(SEED_SQL_PATH, sql, 'utf8');
  console.log(`Wrote bootstrap SQL to ${path.relative(repoRoot, BOOTSTRAP_SQL_PATH)}`);
}

async function ensureStorageBuckets() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const buckets = ['avatars', 'tournament-images', 'marketplace-images'];
  for (const bucket of buckets) {
    const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: bucket, public: true }),
    });

    const text = await response.text();
    if (response.ok) {
      console.log(`Created storage bucket ${bucket}`);
      continue;
    }

    if (response.status === 400 && text.includes('already exists')) {
      console.log(`Storage bucket ${bucket} already exists`);
      continue;
    }

    console.warn(`Could not create storage bucket ${bucket}: ${response.status} ${text}`);
  }

  return supabase;
}

async function applySql(sql) {
  if (!DATABASE_URL) {
    console.log('No database connection string found. The SQL bootstrap was written to artifacts/api-server/supabase-bootstrap.sql for manual execution.');
    return false;
  }

  try {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    await client.query(sql);
    await client.end();
    console.log('Applied bootstrap SQL to the connected database.');
    return true;
  } catch (error) {
    console.warn('Direct SQL application failed:', error instanceof Error ? error.message : error);
    return false;
  }
}

async function importBackup() {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'import-supabase-backup.mjs'), BACKUP_PATH, '--copy-storage'], {
    cwd: repoRoot,
    env: { ...process.env, SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_SECRET_KEY: SUPABASE_SERVICE_KEY },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.warn('Backup import finished with a non-zero exit code. If the schema is not yet available, apply the SQL from artifacts/api-server/supabase-bootstrap.sql in the Supabase SQL editor.');
  }
}

async function main() {
  await writeBootstrapFiles();
  await ensureStorageBuckets();
  const applied = await applySql(buildBootstrapSql());
  if (applied) {
    await importBackup();
  } else {
    console.log('Skipping import because the database schema could not be applied automatically.');
  }
}

main().catch((error) => {
  console.error('Bootstrap failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
