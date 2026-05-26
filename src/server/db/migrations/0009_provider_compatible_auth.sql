create table if not exists auth_identities (
  provider text not null,
  subject text not null,
  workspace_id text not null,
  user_id text not null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, subject),
  constraint auth_identities_workspace_user_fk
    foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade
);

create index if not exists auth_identities_workspace_user_idx
  on auth_identities (workspace_id, user_id);

create index if not exists auth_identities_email_idx
  on auth_identities (provider, lower(email))
  where email is not null;

create table if not exists local_user_credentials (
  provider text not null default 'local',
  subject text not null,
  password_hash text not null,
  password_updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  primary key (provider, subject),
  constraint local_user_credentials_identity_fk
    foreign key (provider, subject)
    references auth_identities(provider, subject)
    on delete cascade
);

create table if not exists workspace_roles (
  workspace_id text not null references workspaces(id) on delete cascade,
  role_id text not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, role_id)
);

create table if not exists workspace_role_permissions (
  workspace_id text not null,
  role_id text not null,
  permission text not null,
  primary key (workspace_id, role_id, permission),
  constraint workspace_role_permissions_role_fk
    foreign key (workspace_id, role_id)
    references workspace_roles(workspace_id, role_id)
    on delete cascade
);

create table if not exists workspace_user_roles (
  workspace_id text not null,
  user_id text not null,
  role_id text not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id, role_id),
  constraint workspace_user_roles_user_fk
    foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade,
  constraint workspace_user_roles_role_fk
    foreign key (workspace_id, role_id)
    references workspace_roles(workspace_id, role_id)
    on delete cascade
);

insert into auth_identities (
  provider,
  subject,
  workspace_id,
  user_id,
  email,
  display_name
)
values
  ('local', 'alice@example.com', 'ws_default', 'usr_alice', 'alice@example.com', 'Alice'),
  ('local', 'bob@example.com', 'ws_default', 'usr_bob', 'bob@example.com', 'Bob'),
  ('local', 'chen@example.com', 'ws_default', 'usr_chen', 'chen@example.com', 'Chen')
on conflict (provider, subject)
do update set
  workspace_id = excluded.workspace_id,
  user_id = excluded.user_id,
  email = excluded.email,
  display_name = excluded.display_name,
  updated_at = now();

insert into local_user_credentials (
  provider,
  subject,
  password_hash
)
values
  (
    'local',
    'alice@example.com',
    'scrypt$v1$16384$8$1$64$bG9jYWwtYXV0aC1hbGljZS1zYWx0LXYx$Ucd9WaULAz0XIq6sL4MFX1EyOXMpkDEXeA4bd6qfPuViXLWshhktERfMLKvPkZb-tUylZnTLvYgOb9CO7cuu2A'
  ),
  (
    'local',
    'bob@example.com',
    'scrypt$v1$16384$8$1$64$bG9jYWwtYXV0aC1ib2Itc2FsdC12MQ$RymoidJ6vcip-s7R8WPQ_9x3sZjFkiEVZMUrCTnXEL8za7vWajEB_dxeowQOJgZlE5uAimdxe7Xy2cDkr95Ivg'
  ),
  (
    'local',
    'chen@example.com',
    'scrypt$v1$16384$8$1$64$bG9jYWwtYXV0aC1jaGVuLXNhbHQtdjE$WQBrw--gG3U3fArVk3lu9wNTYveBdJ3u-59Ax_k8tgoXKN_RfzwTZSPi4ncz_9nc6RXJ4eZq67RhahIRUA57PQ'
  )
on conflict (provider, subject)
do update set
  password_hash = excluded.password_hash,
  password_updated_at = now(),
  disabled_at = null;

insert into workspace_roles (workspace_id, role_id, name)
values
  ('ws_default', 'admin', 'Admin'),
  ('ws_default', 'editor', 'Editor'),
  ('ws_default', 'viewer', 'Viewer')
on conflict (workspace_id, role_id)
do update set
  name = excluded.name,
  updated_at = now();

insert into workspace_role_permissions (workspace_id, role_id, permission)
values
  ('ws_default', 'admin', 'dashboard.read'),
  ('ws_default', 'admin', 'dashboard.edit'),
  ('ws_default', 'admin', 'dashboard.publish'),
  ('ws_default', 'admin', 'datasource.read'),
  ('ws_default', 'admin', 'datasource.manage'),
  ('ws_default', 'admin', 'workspace.admin'),
  ('ws_default', 'editor', 'dashboard.read'),
  ('ws_default', 'editor', 'dashboard.edit'),
  ('ws_default', 'editor', 'dashboard.publish'),
  ('ws_default', 'editor', 'datasource.read'),
  ('ws_default', 'viewer', 'dashboard.read'),
  ('ws_default', 'viewer', 'datasource.read')
on conflict (workspace_id, role_id, permission)
do nothing;

insert into workspace_user_roles (workspace_id, user_id, role_id)
values
  ('ws_default', 'usr_alice', 'admin'),
  ('ws_default', 'usr_bob', 'editor'),
  ('ws_default', 'usr_chen', 'viewer')
on conflict (workspace_id, user_id, role_id)
do nothing;
