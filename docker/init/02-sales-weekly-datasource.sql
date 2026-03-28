create table if not exists sales_weekly_fact (
  week_start date not null,
  region text not null,
  gmv integer not null,
  orders integer not null,
  primary key (week_start, region)
);

create table if not exists sales_quality (
  week_start date not null,
  channel text not null,
  orders integer not null,
  conversion_rate double precision not null,
  primary key (week_start, channel)
);

insert into sales_weekly_fact (week_start, region, gmv, orders)
values
  ('2025-12-29', 'East', 194400, 252),
  ('2025-12-29', 'West', 170400, 234),
  ('2025-12-29', 'South', 186000, 250),
  ('2026-01-05', 'East', 204660, 259),
  ('2026-01-05', 'West', 179330, 241),
  ('2026-01-05', 'South', 195890, 257),
  ('2026-01-12', 'East', 214920, 267),
  ('2026-01-12', 'West', 188260, 247),
  ('2026-01-12', 'South', 205780, 264),
  ('2026-01-19', 'East', 225180, 274),
  ('2026-01-19', 'West', 197190, 254),
  ('2026-01-19', 'South', 215670, 271),
  ('2026-01-26', 'East', 235440, 281),
  ('2026-01-26', 'West', 206120, 261),
  ('2026-01-26', 'South', 225560, 278),
  ('2026-02-02', 'East', 245700, 289),
  ('2026-02-02', 'West', 215050, 267),
  ('2026-02-02', 'South', 235450, 285),
  ('2026-02-09', 'East', 255960, 296),
  ('2026-02-09', 'West', 223980, 274),
  ('2026-02-09', 'South', 245340, 292),
  ('2026-02-16', 'East', 266220, 303),
  ('2026-02-16', 'West', 232910, 281),
  ('2026-02-16', 'South', 255230, 299),
  ('2026-02-23', 'East', 276480, 311),
  ('2026-02-23', 'West', 241840, 287),
  ('2026-02-23', 'South', 265120, 306),
  ('2026-03-02', 'East', 286740, 318),
  ('2026-03-02', 'West', 250770, 294),
  ('2026-03-02', 'South', 275010, 313),
  ('2026-03-09', 'East', 297000, 325),
  ('2026-03-09', 'West', 259700, 301),
  ('2026-03-09', 'South', 284900, 320),
  ('2026-03-16', 'East', 307260, 333),
  ('2026-03-16', 'West', 268630, 307),
  ('2026-03-16', 'South', 294790, 327)
on conflict (week_start, region) do nothing;

insert into sales_quality (week_start, channel, orders, conversion_rate)
values
  ('2026-01-05', 'Organic', 120, 0.19),
  ('2026-01-12', 'Paid Search', 98, 0.14),
  ('2026-01-19', 'Affiliate', 84, 0.11),
  ('2026-01-26', 'CRM', 142, 0.24),
  ('2026-02-02', 'Organic', 133, 0.20),
  ('2026-02-09', 'Paid Search', 104, 0.15),
  ('2026-02-16', 'Affiliate', 88, 0.12),
  ('2026-02-23', 'CRM', 149, 0.25),
  ('2026-03-02', 'Organic', 138, 0.21),
  ('2026-03-09', 'Paid Search', 109, 0.16)
on conflict (week_start, channel) do nothing;

create index if not exists idx_sales_weekly_fact_week_start
  on sales_weekly_fact (week_start);

create index if not exists idx_sales_quality_week_start
  on sales_quality (week_start);
