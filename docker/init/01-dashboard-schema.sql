drop table if exists dashboard_published;
drop table if exists dashboard_drafts;
drop table if exists dashboards;

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
  verbose_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_user_settings_workspace_user_fk
    foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade
);

create table if not exists workspace_dashboards (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_dashboards_created_by_fk
    foreign key (workspace_id, created_by_user_id)
    references workspace_users(workspace_id, user_id)
    on delete set null
);

create table if not exists workspace_dashboard_drafts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  saved_by_user_id text,
  saved_at timestamptz not null default now(),
  unique (workspace_id, dashboard_id, version),
  constraint workspace_dashboard_drafts_saved_by_fk
    foreign key (workspace_id, saved_by_user_id)
    references workspace_users(workspace_id, user_id)
    on delete set null
);

create table if not exists workspace_dashboard_published (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  version integer not null,
  dashboard_document jsonb not null,
  published_by_user_id text,
  published_at timestamptz not null default now(),
  unique (workspace_id, dashboard_id, version),
  constraint workspace_dashboard_published_published_by_fk
    foreign key (workspace_id, published_by_user_id)
    references workspace_users(workspace_id, user_id)
    on delete set null
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
  primary key (workspace_id, user_id, dashboard_id, session_id),
  constraint editing_sessions_workspace_user_fk
    foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade
);

create table if not exists editing_presence (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  user_id text not null,
  session_id text not null,
  last_seen_at timestamptz not null default now(),
  last_saved_at timestamptz,
  primary key (workspace_id, dashboard_id, user_id, session_id),
  constraint editing_presence_workspace_user_fk
    foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade
);

create table if not exists worker_checks (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  session_id text not null,
  view_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, dashboard_id, session_id, view_id)
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

insert into workspace_user_settings (workspace_id, user_id, verbose_enabled)
values
  ('ws_default', 'usr_alice', false),
  ('ws_default', 'usr_bob', false),
  ('ws_default', 'usr_chen', false)
on conflict (workspace_id, user_id) do nothing;
