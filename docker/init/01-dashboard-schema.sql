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
