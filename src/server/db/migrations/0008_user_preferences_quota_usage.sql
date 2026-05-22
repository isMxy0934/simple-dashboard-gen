create table if not exists user_preferences (
  user_id text primary key,
  locale text not null default 'zh',
  theme text not null default 'system',
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint user_preferences_locale_check check (locale in ('zh', 'en'))
);

insert into user_preferences (user_id, locale)
select distinct on (user_id) user_id, locale
from workspace_user_settings
order by user_id, updated_at desc
on conflict (user_id)
do update set
  locale = excluded.locale,
  updated_at = now();

create table if not exists quota_usage (
  workspace_id text primary key references workspaces(id) on delete cascade,
  dashboards_count integer not null default 0 check (dashboards_count >= 0),
  datasources_count integer not null default 0 check (datasources_count >= 0),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  last_calculated_at timestamptz not null default now(),
  usage jsonb not null default '{}'::jsonb
);

insert into quota_usage (workspace_id)
select id
from workspaces
on conflict (workspace_id)
do nothing;
