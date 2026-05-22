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
);

alter table authoring_chat_events
  add column if not exists sequence bigint;

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
  e.event_seq = ranked.event_seq;

alter table authoring_chat_events
  alter column sequence set not null;

create index if not exists authoring_chat_events_session_created_idx
  on authoring_chat_events (session_id, created_at asc, turn_id asc, event_seq asc);

create unique index if not exists authoring_chat_events_session_sequence_uidx
  on authoring_chat_events (session_id, sequence);

create index if not exists authoring_chat_events_dashboard_updated_idx
  on authoring_chat_events (dashboard_id, created_at desc)
  where dashboard_id is not null;

create index if not exists authoring_chat_events_dashboard_session_updated_idx
  on authoring_chat_events (dashboard_id, session_id, created_at desc)
  where dashboard_id is not null;

create unique index if not exists authoring_chat_events_message_uidx
  on authoring_chat_events (session_id, message_id)
  where message_id is not null;

create table if not exists authoring_stream_leases (
  session_id text primary key,
  owner_id text not null,
  dashboard_id text,
  turn_id text,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists authoring_tasks (
  session_id text primary key,
  dashboard_id text,
  payload jsonb not null,
  revision integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table authoring_tasks
  add column if not exists revision integer not null default 0;
