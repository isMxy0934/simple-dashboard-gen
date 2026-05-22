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
  locale text not null default 'zh',
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table workspace_user_settings
  add column if not exists verbose_enabled boolean not null default false;

alter table workspace_user_settings
  add column if not exists locale text not null default 'zh';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_user_settings_locale_check'
  ) then
    alter table workspace_user_settings
      add constraint workspace_user_settings_locale_check
      check (locale in ('zh', 'en'));
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'workspace_user_settings'
      and column_name = 'verbose'
  ) then
    execute 'update workspace_user_settings set verbose_enabled = coalesce(verbose_enabled, verbose)';
    execute 'alter table workspace_user_settings drop column verbose';
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workspace_user_settings_workspace_user_fk'
  ) then
    alter table workspace_user_settings
      add constraint workspace_user_settings_workspace_user_fk
      foreign key (workspace_id, user_id)
      references workspace_users(workspace_id, user_id)
      on delete cascade;
  end if;
end
$$;

insert into workspaces (id, name)
values ('ws_default', 'Default Workspace')
on conflict (id)
do update set name = excluded.name, updated_at = now();

insert into workspace_users (workspace_id, user_id, name, email)
values
  ('ws_default', 'usr_alice', 'Alice', 'alice@example.com'),
  ('ws_default', 'usr_bob', 'Bob', 'bob@example.com'),
  ('ws_default', 'usr_chen', 'Chen', 'chen@example.com')
on conflict (workspace_id, user_id)
do update set
  name = excluded.name,
  email = excluded.email,
  updated_at = now();

insert into workspace_user_settings (workspace_id, user_id, verbose_enabled, locale)
values
  ('ws_default', 'usr_alice', false, 'zh'),
  ('ws_default', 'usr_bob', false, 'zh'),
  ('ws_default', 'usr_chen', false, 'zh')
on conflict (workspace_id, user_id)
do nothing;
