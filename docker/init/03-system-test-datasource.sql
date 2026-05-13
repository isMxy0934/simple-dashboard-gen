create schema if not exists system_test;

comment on schema system_test is 'Isolated schema with deterministic tables for dashboard system tests.';

create table if not exists system_test.sales_order_weekly (
  week_start date not null,
  region text not null,
  channel text not null,
  category text not null,
  gmv numeric(12, 2) not null,
  orders integer not null,
  units integer not null,
  refund_amount numeric(12, 2) not null,
  gross_margin numeric(12, 2) not null,
  conversion_rate double precision not null,
  promo_flag boolean not null,
  primary key (week_start, region, channel, category)
);

comment on table system_test.sales_order_weekly is 'Weekly ecommerce sales facts by region, channel, and product category.';
comment on column system_test.sales_order_weekly.week_start is 'Monday date for the reporting week.';
comment on column system_test.sales_order_weekly.region is 'Sales region.';
comment on column system_test.sales_order_weekly.channel is 'Acquisition or sales channel.';
comment on column system_test.sales_order_weekly.category is 'Product category.';
comment on column system_test.sales_order_weekly.gmv is 'Gross merchandise value.';
comment on column system_test.sales_order_weekly.orders is 'Order count.';
comment on column system_test.sales_order_weekly.units is 'Units sold.';
comment on column system_test.sales_order_weekly.refund_amount is 'Refunded value.';
comment on column system_test.sales_order_weekly.gross_margin is 'Gross margin value.';
comment on column system_test.sales_order_weekly.conversion_rate is 'Weekly conversion rate.';
comment on column system_test.sales_order_weekly.promo_flag is 'Whether the row belongs to a promotional week.';

insert into system_test.sales_order_weekly (
  week_start,
  region,
  channel,
  category,
  gmv,
  orders,
  units,
  refund_amount,
  gross_margin,
  conversion_rate,
  promo_flag
)
with weeks as (
  select
    row_number() over (order by week_start)::integer as week_index,
    week_start::date
  from generate_series(date '2026-01-05', date '2026-03-23', interval '1 week') as g(week_start)
),
regions(region, factor) as (
  values
    ('East', 1.12::numeric),
    ('West', 0.96::numeric),
    ('South', 1.04::numeric),
    ('North', 0.88::numeric)
),
channels(channel, factor) as (
  values
    ('Organic', 1.18::numeric),
    ('Paid Search', 1.02::numeric),
    ('Marketplace', 0.92::numeric),
    ('CRM', 1.09::numeric)
),
categories(category, factor) as (
  values
    ('Electronics', 1.34::numeric),
    ('Home', 0.92::numeric),
    ('Beauty', 0.86::numeric)
)
select
  w.week_start,
  r.region,
  c.channel,
  cat.category,
  round(((68000 + w.week_index * 4200) * r.factor * c.factor * cat.factor)::numeric, 2) as gmv,
  round(((420 + w.week_index * 18) * r.factor * c.factor * cat.factor)::numeric)::integer as orders,
  round(((620 + w.week_index * 24) * r.factor * c.factor * cat.factor)::numeric)::integer as units,
  round((((68000 + w.week_index * 4200) * r.factor * c.factor * cat.factor) * 0.026)::numeric, 2) as refund_amount,
  round((((68000 + w.week_index * 4200) * r.factor * c.factor * cat.factor) * (0.28 + (cat.factor - 0.9) * 0.08))::numeric, 2) as gross_margin,
  round((0.115 + w.week_index * 0.004 + (c.factor - 1) * 0.045)::numeric, 4)::double precision as conversion_rate,
  (cat.category = 'Electronics' and w.week_index in (4, 8)) as promo_flag
from weeks w
cross join regions r(region, factor)
cross join channels c(channel, factor)
cross join categories cat(category, factor)
on conflict (week_start, region, channel, category) do nothing;

create table if not exists system_test.marketing_campaign_weekly (
  week_start date not null,
  channel text not null,
  campaign_type text not null,
  impressions integer not null,
  clicks integer not null,
  spend numeric(12, 2) not null,
  conversions integer not null,
  revenue numeric(12, 2) not null,
  ctr double precision not null,
  cvr double precision not null,
  primary key (week_start, channel, campaign_type)
);

comment on table system_test.marketing_campaign_weekly is 'Weekly marketing campaign performance by channel and campaign type.';
comment on column system_test.marketing_campaign_weekly.week_start is 'Monday date for the reporting week.';
comment on column system_test.marketing_campaign_weekly.channel is 'Marketing channel.';
comment on column system_test.marketing_campaign_weekly.campaign_type is 'Campaign objective or type.';
comment on column system_test.marketing_campaign_weekly.impressions is 'Ad or content impressions.';
comment on column system_test.marketing_campaign_weekly.clicks is 'Click count.';
comment on column system_test.marketing_campaign_weekly.spend is 'Marketing spend.';
comment on column system_test.marketing_campaign_weekly.conversions is 'Conversion count.';
comment on column system_test.marketing_campaign_weekly.revenue is 'Attributed revenue.';
comment on column system_test.marketing_campaign_weekly.ctr is 'Click-through rate.';
comment on column system_test.marketing_campaign_weekly.cvr is 'Click-to-conversion rate.';

insert into system_test.marketing_campaign_weekly (
  week_start,
  channel,
  campaign_type,
  impressions,
  clicks,
  spend,
  conversions,
  revenue,
  ctr,
  cvr
)
with weeks as (
  select
    row_number() over (order by week_start)::integer as week_index,
    week_start::date
  from generate_series(date '2026-01-05', date '2026-03-23', interval '1 week') as g(week_start)
),
channels(channel, factor) as (
  values
    ('Paid Search', 1.18::numeric),
    ('Social', 1.06::numeric),
    ('Affiliate', 0.82::numeric),
    ('Email', 0.74::numeric)
),
campaigns(campaign_type, factor) as (
  values
    ('Prospecting', 1.16::numeric),
    ('Retargeting', 0.94::numeric),
    ('Lifecycle', 0.72::numeric)
),
base as (
  select
    w.week_start,
    c.channel,
    cp.campaign_type,
    round(((240000 + w.week_index * 8500) * c.factor * cp.factor)::numeric)::integer as impressions,
    round(((8200 + w.week_index * 260) * c.factor * cp.factor)::numeric)::integer as clicks,
    round(((14000 + w.week_index * 460) * c.factor * cp.factor)::numeric, 2) as spend,
    round(((450 + w.week_index * 18) * c.factor * cp.factor)::numeric)::integer as conversions,
    round(((36000 + w.week_index * 1300) * c.factor * cp.factor)::numeric, 2) as revenue
  from weeks w
  cross join channels c(channel, factor)
  cross join campaigns cp(campaign_type, factor)
)
select
  week_start,
  channel,
  campaign_type,
  impressions,
  clicks,
  spend,
  conversions,
  revenue,
  round((clicks::numeric / nullif(impressions, 0))::numeric, 4)::double precision as ctr,
  round((conversions::numeric / nullif(clicks, 0))::numeric, 4)::double precision as cvr
from base
on conflict (week_start, channel, campaign_type) do nothing;

create table if not exists system_test.support_ticket_weekly (
  week_start date not null,
  support_channel text not null,
  priority text not null,
  tickets_opened integer not null,
  tickets_resolved integer not null,
  backlog integer not null,
  avg_first_response_minutes numeric(10, 2) not null,
  csat_score numeric(4, 2),
  primary key (week_start, support_channel, priority)
);

comment on table system_test.support_ticket_weekly is 'Weekly customer support ticket metrics by support channel and priority.';
comment on column system_test.support_ticket_weekly.week_start is 'Monday date for the reporting week.';
comment on column system_test.support_ticket_weekly.support_channel is 'Support intake channel.';
comment on column system_test.support_ticket_weekly.priority is 'Ticket priority.';
comment on column system_test.support_ticket_weekly.tickets_opened is 'Tickets opened during the week.';
comment on column system_test.support_ticket_weekly.tickets_resolved is 'Tickets resolved during the week.';
comment on column system_test.support_ticket_weekly.backlog is 'Open backlog at week end.';
comment on column system_test.support_ticket_weekly.avg_first_response_minutes is 'Average first response time in minutes.';
comment on column system_test.support_ticket_weekly.csat_score is 'Average CSAT score; may be null when response volume is too low.';

insert into system_test.support_ticket_weekly (
  week_start,
  support_channel,
  priority,
  tickets_opened,
  tickets_resolved,
  backlog,
  avg_first_response_minutes,
  csat_score
)
with weeks as (
  select
    row_number() over (order by week_start)::integer as week_index,
    week_start::date
  from generate_series(date '2026-01-05', date '2026-03-23', interval '1 week') as g(week_start)
),
channels(support_channel, factor) as (
  values
    ('Chat', 1.24::numeric),
    ('Email', 1.00::numeric),
    ('Phone', 0.68::numeric)
),
priorities(priority, factor, response_factor) as (
  values
    ('High', 0.58::numeric, 0.72::numeric),
    ('Medium', 1.00::numeric, 1.00::numeric),
    ('Low', 1.36::numeric, 1.18::numeric)
)
select
  w.week_start,
  c.support_channel,
  p.priority,
  round(((86 + w.week_index * 3) * c.factor * p.factor)::numeric)::integer as tickets_opened,
  round(((80 + w.week_index * 4) * c.factor * p.factor)::numeric)::integer as tickets_resolved,
  round(((36 + w.week_index * 2) * c.factor * p.factor)::numeric)::integer as backlog,
  round(((42 - w.week_index * 1.4) * p.response_factor)::numeric, 2) as avg_first_response_minutes,
  case
    when c.support_channel = 'Phone' and p.priority = 'Low' and w.week_index in (2, 7) then null
    else round((4.15 + w.week_index * 0.025 - (p.response_factor - 1) * 0.18)::numeric, 2)
  end as csat_score
from weeks w
cross join channels c(support_channel, factor)
cross join priorities p(priority, factor, response_factor)
on conflict (week_start, support_channel, priority) do nothing;

create index if not exists idx_system_test_sales_order_weekly_week
  on system_test.sales_order_weekly (week_start);

create index if not exists idx_system_test_sales_order_weekly_region_channel
  on system_test.sales_order_weekly (region, channel);

create index if not exists idx_system_test_marketing_campaign_weekly_week
  on system_test.marketing_campaign_weekly (week_start);

create index if not exists idx_system_test_support_ticket_weekly_week
  on system_test.support_ticket_weekly (week_start);
