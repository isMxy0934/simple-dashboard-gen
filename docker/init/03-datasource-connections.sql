create table if not exists datasource_connections (
  id text primary key,
  kind text not null check (kind in ('postgres', 'athena')),
  label text not null,
  description text not null default '',
  secret_ciphertext bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
