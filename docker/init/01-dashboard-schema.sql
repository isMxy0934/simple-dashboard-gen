create table if not exists dashboards (
  id text primary key,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists dashboard_drafts (
  id text primary key,
  dashboard_id text not null references dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  saved_at timestamptz not null default now(),
  unique (dashboard_id, version)
);

create table if not exists dashboard_published (
  id text primary key,
  dashboard_id text not null references dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  published_at timestamptz not null default now(),
  unique (dashboard_id, version)
);

create index if not exists idx_dashboard_drafts_dashboard_id_saved_at
  on dashboard_drafts (dashboard_id, saved_at desc);

create index if not exists idx_dashboard_published_dashboard_id_published_at
  on dashboard_published (dashboard_id, published_at desc);

create table if not exists workspaces (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_users (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  name text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_user_settings (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  verbose boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists workspace_dashboards (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_dashboard_drafts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  saved_by_user_id text,
  saved_at timestamptz not null default now(),
  unique (workspace_id, dashboard_id, version)
);

create table if not exists workspace_dashboard_published (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  published_by_user_id text,
  published_at timestamptz not null default now(),
  unique (workspace_id, dashboard_id, version)
);

create table if not exists editing_sessions (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  session_id text not null,
  payload jsonb not null,
  dirty boolean not null default false,
  base_version integer not null,
  focus_view_id text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, dashboard_id, session_id)
);

create table if not exists editing_presence (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  user_id text not null,
  session_id text not null,
  last_seen_at timestamptz not null default now(),
  last_saved_at timestamptz,
  primary key (workspace_id, dashboard_id, user_id, session_id)
);

create table if not exists worker_checks (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  view_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, dashboard_id, view_id)
);

insert into workspaces (id, name)
values ('ws_default', 'Default Workspace')
on conflict (id) do nothing;

insert into workspace_users (workspace_id, user_id, name, email)
values
  ('ws_default', 'usr_alice', 'Alice', 'alice@example.com'),
  ('ws_default', 'usr_bob', 'Bob', 'bob@example.com'),
  ('ws_default', 'usr_chen', 'Chen', 'chen@example.com')
on conflict (workspace_id, user_id) do nothing;

insert into workspace_user_settings (workspace_id, user_id, verbose)
values
  ('ws_default', 'usr_alice', false),
  ('ws_default', 'usr_bob', false),
  ('ws_default', 'usr_chen', false)
on conflict (workspace_id, user_id) do nothing;
