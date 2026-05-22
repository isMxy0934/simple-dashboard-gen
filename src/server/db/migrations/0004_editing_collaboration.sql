create table if not exists editing_sessions (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  session_id text not null,
  payload jsonb not null,
  dirty boolean not null default false,
  base_version integer not null,
  focus_view_id text,
  revision integer not null default 0,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id, dashboard_id, session_id)
);

alter table editing_sessions
  add column if not exists revision integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'editing_sessions_workspace_user_fk'
  ) then
    alter table editing_sessions
      add constraint editing_sessions_workspace_user_fk
      foreign key (workspace_id, user_id)
      references workspace_users(workspace_id, user_id)
      on delete cascade;
  end if;
end
$$;

create table if not exists editing_presence (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  user_id text not null,
  session_id text not null,
  last_seen_at timestamptz not null default now(),
  last_saved_at timestamptz,
  primary key (workspace_id, dashboard_id, user_id, session_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'editing_presence_workspace_user_fk'
  ) then
    alter table editing_presence
      add constraint editing_presence_workspace_user_fk
      foreign key (workspace_id, user_id)
      references workspace_users(workspace_id, user_id)
      on delete cascade;
  end if;
end
$$;

create table if not exists authoring_checks (
  workspace_id text not null references workspaces(id) on delete cascade,
  dashboard_id text not null references workspace_dashboards(id) on delete cascade,
  session_id text not null,
  view_id text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, dashboard_id, session_id, view_id)
);

alter table authoring_checks
  add column if not exists session_id text;

update authoring_checks
set session_id = coalesce(session_id, 'migrated')
where session_id is null;

alter table authoring_checks
  alter column session_id set not null;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'authoring_checks_pkey'
  ) then
    alter table authoring_checks drop constraint authoring_checks_pkey;
  end if;
  alter table authoring_checks
    add constraint authoring_checks_pkey
    primary key (workspace_id, dashboard_id, session_id, view_id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end
$$;
