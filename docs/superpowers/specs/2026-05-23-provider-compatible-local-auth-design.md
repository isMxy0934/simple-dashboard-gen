# Provider-Compatible Local Auth Design

Date: 2026-05-23

## Decision

Use a provider-compatible authentication model:

- Current provider: `local`, backed by local database credentials.
- Future provider: `auth0`, backed by Auth0 token/callback verification.
- Business authorization remains local in this app database.
- Auth0 roles are not required for the initial Auth0 integration. If needed later, Auth0 roles can be synchronized into local roles instead of becoming the runtime source of truth.

This keeps local testing and future Auth0 login on the same application flow:

1. Verify identity with a provider.
2. Normalize the external identity.
3. Resolve that identity to a local workspace user.
4. Expand local roles/permissions.
5. Issue the same `sds_session` app JWT.

## Goals

- Remove the current mock login behavior that accepts any password.
- Make local login real enough for development and internal testing.
- Keep the future Auth0 migration smooth by sharing the same identity mapping and session issuing flow.
- Let the user management UI update local roles and permissions without coupling the app to Auth0 roles.
- Preserve the current single-workspace product shape: `ws_default` remains the only active workspace.

## Non-Goals

- Do not build a production-grade identity provider.
- Do not make Auth0 roles the runtime authorization source.
- Do not add multi-workspace product behavior.
- Do not implement full user registration in this phase.

## Data Model

### `auth_identities`

Maps provider identities to local workspace users.

```sql
create table auth_identities (
  provider text not null,
  subject text not null,
  workspace_id text not null,
  user_id text not null,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, subject),
  foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade
);
```

For local login:

- `provider = 'local'`
- `subject = lower(email)` or a stable local subject derived from email

For Auth0 later:

- `provider = 'auth0'`
- `subject = Auth0 sub`

### `local_user_credentials`

Stores local-only password material for the local provider.

```sql
create table local_user_credentials (
  provider text not null default 'local',
  subject text not null,
  password_hash text not null,
  password_updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  primary key (provider, subject),
  foreign key (provider, subject)
    references auth_identities(provider, subject)
    on delete cascade
);
```

Password hashes should use Node built-in `crypto.scrypt` to avoid adding native dependencies. The stored format is versioned so it can be migrated later.

### Local Roles And Permissions

Add local role binding tables:

```sql
create table workspace_roles (
  workspace_id text not null,
  role_id text not null,
  name text not null,
  primary key (workspace_id, role_id),
  foreign key (workspace_id) references workspaces(id) on delete cascade
);

create table workspace_role_permissions (
  workspace_id text not null,
  role_id text not null,
  permission text not null,
  primary key (workspace_id, role_id, permission),
  foreign key (workspace_id, role_id)
    references workspace_roles(workspace_id, role_id)
    on delete cascade
);

create table workspace_user_roles (
  workspace_id text not null,
  user_id text not null,
  role_id text not null,
  primary key (workspace_id, user_id, role_id),
  foreign key (workspace_id, user_id)
    references workspace_users(workspace_id, user_id)
    on delete cascade,
  foreign key (workspace_id, role_id)
    references workspace_roles(workspace_id, role_id)
    on delete cascade
);
```

Seed roles:

- `admin`: all current permissions.
- `editor`: dashboard read/edit/publish plus datasource read.
- `viewer`: dashboard read plus datasource read.

The app session JWT contains expanded permissions from local roles. Existing `requireApiSession` and `requirePermission` behavior remains unchanged.

## Login Flow

```text
POST /api/auth/login
  -> parse identity/password
  -> local provider verifies password
  -> returns NormalizedIdentity(provider, subject, email, displayName)
  -> resolve auth_identities(provider, subject)
  -> load local workspace roles and permissions
  -> sign sds_session JWT
```

Invalid email, unknown identity, missing credentials, wrong password, and disabled credentials all return the same public error:

```text
401 INVALID_CREDENTIALS
```

This avoids leaking whether a user exists.

## Future Auth0 Flow

```text
Auth0 callback or token verification
  -> Auth0 provider verifies Auth0 token
  -> returns NormalizedIdentity(provider="auth0", subject=auth0 sub, email, displayName)
  -> resolve auth_identities(provider, subject)
  -> load local workspace roles and permissions
  -> sign sds_session JWT
```

Auth0 roles can be added later as a sync source:

```text
Auth0 roles -> auth_role_mappings -> workspace_user_roles
```

The runtime API authorization still reads local permissions from the app session.

## User Management Implication

The user management UI should manage local users, identity links, roles, and permissions in the app database.

For Auth0 later, a newly seen Auth0 identity can either:

- remain pending until an admin links or approves it, or
- be auto-created with the `viewer` role.

Default recommendation: pending or viewer only. Do not auto-grant editor/admin permissions.

## Testing

Required coverage:

- Correct local credentials issue an app session.
- Wrong password returns `401 INVALID_CREDENTIALS`.
- Unknown user returns `401 INVALID_CREDENTIALS`.
- Disabled local credential returns `401 INVALID_CREDENTIALS`.
- Session permissions come from local roles, not hardcoded login permissions.
- Existing protected API routes continue to authorize through `requireApiSession`.
- Auth0-ready contract test verifies provider identity resolution is separate from session issuing.

## Documentation Updates

Update `docs/architecture.md` and `docs/migration.md` to state:

- Current login is local DB credential provider, not mock.
- Auth0 is a future provider using the same identity mapping and session issuing flow.
- Roles and permissions are local application data.
- Auth0 roles are optional future sync input, not the initial runtime authorization source.
