create table if not exists workspace_dashboards (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  created_by_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_dashboards_created_by_fk'
  ) then
    alter table workspace_dashboards
      add constraint workspace_dashboards_created_by_fk
      foreign key (workspace_id, created_by_user_id)
      references workspace_users(workspace_id, user_id)
      on delete set null;
  end if;
end
$$;

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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_dashboard_drafts_saved_by_fk'
  ) then
    alter table workspace_dashboard_drafts
      add constraint workspace_dashboard_drafts_saved_by_fk
      foreign key (workspace_id, saved_by_user_id)
      references workspace_users(workspace_id, user_id)
      on delete set null;
  end if;
end
$$;

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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_dashboard_published_published_by_fk'
  ) then
    alter table workspace_dashboard_published
      add constraint workspace_dashboard_published_published_by_fk
      foreign key (workspace_id, published_by_user_id)
      references workspace_users(workspace_id, user_id)
      on delete set null;
  end if;
end
$$;
