create table if not exists datasource_connections (
  id text primary key,
  workspace_id text not null default 'ws_default' references workspaces(id) on delete cascade,
  kind text not null check (kind in ('postgres', 'athena')),
  label text not null,
  description text not null default '',
  secret_ciphertext bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists datasource_connections_workspace_idx
  on datasource_connections(workspace_id, created_at);
