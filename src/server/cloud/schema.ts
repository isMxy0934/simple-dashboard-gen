import "server-only";

import path from "path";
import { applyDbMigrations } from "@/server/db/migrations/runner";
import { getPgPool } from "@/server/datasource/postgres";
import {
  DEFAULT_WORKSPACE_ID,
  DEFAULT_WORKSPACE_USER_ID,
} from "@/shared/workspace-defaults";

const DEFAULT_WORKSPACE_NAME = "Default Workspace";
const DEFAULT_WORKSPACE_USERS = [
  {
    user_id: DEFAULT_WORKSPACE_USER_ID,
    name: "Alice",
    email: "alice@example.com",
  },
  {
    user_id: "usr_bob",
    name: "Bob",
    email: "bob@example.com",
  },
  {
    user_id: "usr_chen",
    name: "Chen",
    email: "chen@example.com",
  },
] as const;

declare global {
  var __cloudAuthoringSchemaReady: Promise<void> | undefined;
  var __cloudAuthoringMigrationsReady: Promise<void> | undefined;
}

export async function ensureCloudAuthoringSchema() {
  if (!globalThis.__cloudAuthoringSchemaReady) {
    globalThis.__cloudAuthoringSchemaReady = createCloudAuthoringSchema();
  }

  await globalThis.__cloudAuthoringSchemaReady;

  if (!globalThis.__cloudAuthoringMigrationsReady) {
    globalThis.__cloudAuthoringMigrationsReady = applyDbMigrations({
      pool: getPgPool(),
      migrationsDir: path.join(process.cwd(), "src/server/db/migrations"),
    });
  }

  await globalThis.__cloudAuthoringMigrationsReady;
}

async function createCloudAuthoringSchema() {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    await client.query(`
      create table if not exists workspaces (
        id text primary key,
        name text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table if not exists workspace_users (
        workspace_id text not null references workspaces(id) on delete cascade,
        user_id text not null,
        name text not null,
        email text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (workspace_id, user_id)
      )
    `);

    await client.query(`
      create table if not exists workspace_user_settings (
        workspace_id text not null references workspaces(id) on delete cascade,
        user_id text not null,
        verbose_enabled boolean not null default false,
        locale text not null default 'zh',
        updated_at timestamptz not null default now(),
        primary key (workspace_id, user_id)
      )
    `);
    await client.query(`
      alter table workspace_user_settings
      add column if not exists verbose_enabled boolean not null default false
    `);
    await client.query(`
      alter table workspace_user_settings
      add column if not exists locale text not null default 'zh'
    `);
    await client.query(`
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
    `);
    await client.query(`
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
    `);
    await client.query(`
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
    `);

    await client.query(`
      create table if not exists datasource_connections (
        id text primary key,
        workspace_id text not null default '${DEFAULT_WORKSPACE_ID}' references workspaces(id) on delete cascade,
        kind text not null check (kind in ('postgres', 'athena')),
        label text not null,
        description text not null default '',
        secret_ciphertext bytea not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      alter table datasource_connections
      add column if not exists workspace_id text not null default '${DEFAULT_WORKSPACE_ID}'
    `);
    await client.query(`
      update datasource_connections
      set workspace_id = '${DEFAULT_WORKSPACE_ID}'
      where workspace_id is null or workspace_id = ''
    `);
    await client.query(`
      create index if not exists datasource_connections_workspace_idx
      on datasource_connections(workspace_id, created_at)
    `);

    await client.query(`
      create table if not exists workspace_dashboards (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        name text not null,
        description text,
        created_by_user_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
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
    `);

    await client.query(`
      create table if not exists workspace_dashboard_drafts (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        version integer not null,
        dashboard_document jsonb not null,
        saved_by_user_id text,
        saved_at timestamptz not null default now(),
        unique (workspace_id, dashboard_id, version)
      )
    `);
    await client.query(`
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
    `);

    await client.query(`
      create table if not exists workspace_dashboard_published (
        id text primary key,
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        version integer not null,
        dashboard_document jsonb not null,
        published_by_user_id text,
        published_at timestamptz not null default now(),
        unique (workspace_id, dashboard_id, version)
      )
    `);
    await client.query(`
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
    `);

    await client.query(`
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
      )
    `);
    await client.query(`
      alter table editing_sessions
      add column if not exists revision integer not null default 0
    `);
    await client.query(`
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
    `);

    await client.query(`
      create table if not exists editing_presence (
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        user_id text not null,
        session_id text not null,
        last_seen_at timestamptz not null default now(),
        last_saved_at timestamptz,
        primary key (workspace_id, dashboard_id, user_id, session_id)
      )
    `);
    await client.query(`
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
    `);

    await client.query(`
      create table if not exists authoring_checks (
        workspace_id text not null references workspaces(id) on delete cascade,
        dashboard_id text not null references workspace_dashboards(id) on delete cascade,
        session_id text not null,
        view_id text not null,
        payload jsonb not null,
        updated_at timestamptz not null default now(),
        primary key (workspace_id, dashboard_id, session_id, view_id)
      )
    `);
    await client.query(`
      alter table authoring_checks
      add column if not exists session_id text
    `);
    await client.query(`
      update authoring_checks
      set session_id = coalesce(session_id, 'migrated')
      where session_id is null
    `);
    await client.query(`
      alter table authoring_checks
      alter column session_id set not null
    `);
    await client.query(`
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
    `);

    // Obsolete chat-session tables should be removed by an explicit schema change,
    // not by runtime schema ensure. Runtime DDL must never destroy data.

    await client.query(`
      create table if not exists authoring_chat_events (
        session_id text not null,
        dashboard_id text,
        turn_id text not null,
        event_seq integer not null,
        sequence bigint,
        event_type text not null,
        message_id text,
        payload jsonb not null,
        created_at timestamptz not null default now(),
        primary key (session_id, turn_id, event_seq)
      )
    `);
    await client.query(`
      alter table authoring_chat_events
      add column if not exists sequence bigint
    `);
    await client.query(`
      with ranked as (
        select
          session_id,
          turn_id,
          event_seq,
          coalesce(
            max(sequence) over (partition by session_id),
            0
          ) + row_number() over (
            partition by session_id
            order by created_at asc, turn_id asc, event_seq asc
          ) as next_sequence
        from authoring_chat_events
        where sequence is null
      )
      update authoring_chat_events e
      set sequence = ranked.next_sequence
      from ranked
      where
        e.session_id = ranked.session_id and
        e.turn_id = ranked.turn_id and
        e.event_seq = ranked.event_seq
    `);
    await client.query(`
      alter table authoring_chat_events
      alter column sequence set not null
    `);
    await client.query(`
      create index if not exists authoring_chat_events_session_created_idx
      on authoring_chat_events (session_id, created_at asc, turn_id asc, event_seq asc)
    `);
    await client.query(`
      create unique index if not exists authoring_chat_events_session_sequence_uidx
      on authoring_chat_events (session_id, sequence)
    `);
    await client.query(`
      create index if not exists authoring_chat_events_dashboard_updated_idx
      on authoring_chat_events (dashboard_id, created_at desc)
      where dashboard_id is not null
    `);
    await client.query(`
      create index if not exists authoring_chat_events_dashboard_session_updated_idx
      on authoring_chat_events (dashboard_id, session_id, created_at desc)
      where dashboard_id is not null
    `);
    await client.query(`
      create unique index if not exists authoring_chat_events_message_uidx
      on authoring_chat_events (session_id, message_id)
      where message_id is not null
    `);

    await client.query(`
      create table if not exists authoring_stream_leases (
        session_id text primary key,
        owner_id text not null,
        dashboard_id text,
        turn_id text,
        expires_at timestamptz not null,
        updated_at timestamptz not null default now()
      )
    `);

    await client.query(`
      create table if not exists authoring_tasks (
        session_id text primary key,
        dashboard_id text,
        payload jsonb not null,
        revision integer not null default 0,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      alter table authoring_tasks
      add column if not exists revision integer not null default 0
    `);

    await client.query(
      `
        insert into workspaces (id, name)
        values ($1, $2)
        on conflict (id)
        do update set name = excluded.name, updated_at = now()
      `,
      [DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME],
    );

    await client.query(`
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
    `);

    for (const user of DEFAULT_WORKSPACE_USERS) {
      await client.query(
        `
          insert into workspace_users (workspace_id, user_id, name, email)
          values ($1, $2, $3, $4)
          on conflict (workspace_id, user_id)
          do update set
            name = excluded.name,
            email = excluded.email,
            updated_at = now()
        `,
        [DEFAULT_WORKSPACE_ID, user.user_id, user.name, user.email],
      );
    }

    for (const user of DEFAULT_WORKSPACE_USERS) {
      await client.query(
        `
          insert into workspace_user_settings (workspace_id, user_id, verbose_enabled, locale)
          values ($1, $2, false, 'zh')
          on conflict (workspace_id, user_id)
          do nothing
        `,
        [DEFAULT_WORKSPACE_ID, user.user_id],
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
