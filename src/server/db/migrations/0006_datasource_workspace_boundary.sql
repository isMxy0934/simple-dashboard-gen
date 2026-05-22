alter table datasource_connections
  add column if not exists workspace_id text not null default 'ws_default';

update datasource_connections
set workspace_id = 'ws_default'
where workspace_id is null or workspace_id = '';

create index if not exists datasource_connections_workspace_idx
  on datasource_connections(workspace_id, created_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'datasource_connections_workspace_fk'
  ) then
    alter table datasource_connections
    add constraint datasource_connections_workspace_fk
    foreign key (workspace_id)
    references workspaces(id)
    on delete cascade;
  end if;
end
$$;
