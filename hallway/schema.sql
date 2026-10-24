-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run
create table if not exists otps (
  email text primary key, code_hash text not null, expires_at timestamptz not null,
  tries int not null default 0, last_sent timestamptz not null);
create table if not exists sessions (
  token_hash text primary key, email text not null, uni text not null,
  expires_at timestamptz not null, created_at timestamptz default now());
create table if not exists bans (email text primary key, created_at timestamptz default now());
create table if not exists reports (
  reported_email text not null, reporter_email text not null, created_at timestamptz default now(),
  primary key (reported_email, reporter_email));
-- Lock tables from the public anon key; only the server (service key) can touch them.
alter table otps enable row level security;
alter table sessions enable row level security;
alter table bans enable row level security;
alter table reports enable row level security;
