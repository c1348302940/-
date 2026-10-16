begin;

create extension if not exists pgcrypto;
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public;

create type public.app_role as enum ('admin', 'member');
create type public.task_status as enum ('todo', 'doing', 'done');
create type public.task_source as enum ('assigned', 'self', 'schedule');
create type public.schedule_stage as enum ('make', 'publish');

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  team_id uuid not null references public.teams(id) on delete restrict,
  name text not null,
  role public.app_role not null default 'member',
  title text not null default '',
  color text not null default '#6a7ae0',
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.versions (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  name text not null,
  description text not null default '',
  status text not null default 'active' check (status in ('active', 'planned', 'archived')),
  color text not null default '#6a7ae0',
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  title text not null,
  description text not null default '',
  target_value text not null default '',
  version_id uuid,
  published boolean not null default false,
  draft_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (version_id) references public.versions(id) on delete restrict
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  version_id uuid,
  name text not null,
  date date,
  description text not null default '',
  status text not null default 'pending' check (status in ('pending', 'done')),
  published boolean not null default false,
  draft_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (version_id) references public.versions(id) on delete restrict
);

create table public.schedule_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  title text not null,
  version_id uuid,
  description text not null default '',
  make_date date,
  publish_date date,
  make_assignee_id uuid references public.profiles(id) on delete restrict,
  publish_assignee_id uuid references public.profiles(id) on delete restrict,
  published boolean not null default false,
  draft_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (version_id) references public.versions(id) on delete restrict
);

create table public.selling_points (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  version_id uuid,
  title text not null,
  one_liner text not null default '',
  applicable_content text not null default '',
  material_link text not null default '',
  notes text not null default '',
  published boolean not null default false,
  draft_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  foreign key (version_id) references public.versions(id) on delete restrict
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete restrict,
  title text not null,
  description text not null default '',
  source public.task_source not null default 'assigned',
  created_by uuid not null references public.profiles(id) on delete restrict,
  assignee_id uuid not null references public.profiles(id) on delete restrict,
  version_id uuid,
  goal_id uuid references public.goals(id) on delete set null,
  milestone_id uuid references public.milestones(id) on delete set null,
  schedule_item_id uuid references public.schedule_items(id) on delete restrict,
  schedule_stage public.schedule_stage,
  schedule_detached boolean not null default false,
  schedule_detach_reason text not null default '',
  due_date date,
  priority smallint not null default 2 check (priority between 0 and 2),
  personal_order numeric not null default 0,
  status public.task_status not null default 'todo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (version_id) references public.versions(id) on delete restrict,
  unique (schedule_item_id, schedule_stage),
  check ((source = 'schedule' and schedule_item_id is not null and schedule_stage is not null)
      or (source <> 'schedule' and schedule_item_id is null and schedule_stage is null))
);

create table public.task_steps (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.content_updates (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  entity_type text not null check (entity_type in ('goal', 'milestone', 'schedule', 'selling_point')),
  entity_id uuid not null,
  title text not null default '',
  published_at timestamptz not null default now()
);

create table public.update_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  update_id uuid not null references public.content_updates(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (user_id, update_id)
);

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('douyin', 'xiaohongshu')),
  status text not null default 'disconnected',
  status_detail text not null default '',
  connected_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, platform)
);

create table public.trend_items (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  collected_by uuid not null references public.profiles(id) on delete restrict,
  platform text not null check (platform in ('douyin', 'xiaohongshu')),
  title text not null,
  category text not null default '',
  heat text not null default '',
  link text not null default '',
  source_kind text not null default 'hotlist',
  query text not null default '',
  competitor_key text not null default '',
  note_published_at timestamptz,
  note_like_count text,
  note_comment_count text,
  topic_post_count integer,
  topic_summary text,
  topic_evidence jsonb,
  sample_count integer,
  body_read_count integer,
  is_real boolean not null default true,
  discovered_at timestamptz not null default now()
);

create table public.saved_topics (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('douyin', 'xiaohongshu')),
  keyword text not null,
  created_at timestamptz not null default now(),
  unique (user_id, platform, keyword)
);

create table public.settings (
  team_id uuid not null references public.teams(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (team_id, key)
);

create table public.daily_stats (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  snapshot_date date not null,
  member_id uuid references public.profiles(id) on delete cascade,
  version_id uuid references public.versions(id) on delete cascade,
  total integer not null default 0,
  todo integer not null default 0,
  doing integer not null default 0,
  done integer not null default 0,
  overdue integer not null default 0,
  completion_rate numeric(7,4) not null default 0,
  created_at timestamptz not null default now(),
  constraint daily_stats_unique unique nulls not distinct (team_id, snapshot_date, member_id, version_id)
);

create index tasks_team_assignee_idx on public.tasks(team_id, assignee_id);
create index tasks_team_version_idx on public.tasks(team_id, version_id);
create index tasks_goal_idx on public.tasks(goal_id);
create index tasks_milestone_idx on public.tasks(milestone_id);
create index task_steps_task_idx on public.task_steps(task_id);
create index content_updates_team_idx on public.content_updates(team_id, published_at desc);
create index trend_items_team_platform_idx on public.trend_items(team_id, platform, discovered_at desc);
create index daily_stats_lookup_idx on public.daily_stats(team_id, snapshot_date, member_id, version_id);

create or replace function private.current_team_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.team_id from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  )
$$;

grant usage on schema private to authenticated;
grant execute on function private.current_team_id() to authenticated;
grant execute on function private.is_active_user() to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

create or replace function private.enforce_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_admin() then
    return new;
  end if;
  if old.assignee_id <> (select auth.uid()) then
    raise exception 'Only the assignee may update this task';
  end if;
  if new.team_id is distinct from old.team_id
     or new.source is distinct from old.source
     or new.created_by is distinct from old.created_by
     or new.assignee_id is distinct from old.assignee_id
     or new.schedule_item_id is distinct from old.schedule_item_id
     or new.schedule_stage is distinct from old.schedule_stage then
    raise exception 'Task identity fields are immutable';
  end if;
  if old.source <> 'self' and (
     new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.version_id is distinct from old.version_id
     or new.goal_id is distinct from old.goal_id
     or new.milestone_id is distinct from old.milestone_id
     or new.due_date is distinct from old.due_date
     or new.priority is distinct from old.priority) then
    raise exception 'Assigned task business fields are admin-only';
  end if;
  return new;
end
$$;

create or replace function private.validate_task_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.version_id is not null and not exists (select 1 from public.versions v where v.id = new.version_id and v.team_id = new.team_id) then
    raise exception 'Version belongs to another team';
  end if;
  if new.goal_id is not null and not exists (select 1 from public.goals g where g.id = new.goal_id and g.team_id = new.team_id and g.published) then
    raise exception 'Goal is unavailable';
  end if;
  if new.milestone_id is not null and not exists (select 1 from public.milestones m where m.id = new.milestone_id and m.team_id = new.team_id and m.published) then
    raise exception 'Milestone is unavailable';
  end if;
  if new.schedule_item_id is not null and not exists (select 1 from public.schedule_items s where s.id = new.schedule_item_id and s.team_id = new.team_id) then
    raise exception 'Schedule belongs to another team';
  end if;
  return new;
end
$$;

create trigger profiles_touch before update on public.profiles for each row execute function private.touch_updated_at();
create trigger versions_touch before update on public.versions for each row execute function private.touch_updated_at();
create trigger goals_touch before update on public.goals for each row execute function private.touch_updated_at();
create trigger milestones_touch before update on public.milestones for each row execute function private.touch_updated_at();
create trigger schedules_touch before update on public.schedule_items for each row execute function private.touch_updated_at();
create trigger selling_points_touch before update on public.selling_points for each row execute function private.touch_updated_at();
create trigger tasks_touch before update on public.tasks for each row execute function private.touch_updated_at();
create trigger steps_touch before update on public.task_steps for each row execute function private.touch_updated_at();
create trigger connections_touch before update on public.social_connections for each row execute function private.touch_updated_at();
create trigger settings_touch before update on public.settings for each row execute function private.touch_updated_at();
create trigger tasks_enforce before update on public.tasks for each row execute function private.enforce_task_update();
create trigger tasks_validate_links before insert or update on public.tasks for each row execute function private.validate_task_links();

create or replace function public.take_daily_stats_snapshot(p_date date default (timezone('Asia/Shanghai', now()))::date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_stats (team_id, snapshot_date, member_id, version_id, total, todo, doing, done, overdue, completion_rate)
  select t.team_id, p_date, null, null,
    count(*)::int,
    count(*) filter (where t.status = 'todo')::int,
    count(*) filter (where t.status = 'doing')::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status <> 'done' and t.due_date < p_date)::int,
    coalesce(round(count(*) filter (where t.status = 'done')::numeric / nullif(count(*), 0), 4), 0)
  from public.tasks t group by t.team_id
  on conflict on constraint daily_stats_unique do update set
    total = excluded.total, todo = excluded.todo, doing = excluded.doing,
    done = excluded.done, overdue = excluded.overdue,
    completion_rate = excluded.completion_rate, created_at = now();

  insert into public.daily_stats (team_id, snapshot_date, member_id, version_id, total, todo, doing, done, overdue, completion_rate)
  select t.team_id, p_date, t.assignee_id, null,
    count(*)::int,
    count(*) filter (where t.status = 'todo')::int,
    count(*) filter (where t.status = 'doing')::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status <> 'done' and t.due_date < p_date)::int,
    coalesce(round(count(*) filter (where t.status = 'done')::numeric / nullif(count(*), 0), 4), 0)
  from public.tasks t group by t.team_id, t.assignee_id
  on conflict on constraint daily_stats_unique do update set
    total = excluded.total, todo = excluded.todo, doing = excluded.doing,
    done = excluded.done, overdue = excluded.overdue,
    completion_rate = excluded.completion_rate, created_at = now();

  insert into public.daily_stats (team_id, snapshot_date, member_id, version_id, total, todo, doing, done, overdue, completion_rate)
  select t.team_id, p_date, null, t.version_id,
    count(*)::int,
    count(*) filter (where t.status = 'todo')::int,
    count(*) filter (where t.status = 'doing')::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status <> 'done' and t.due_date < p_date)::int,
    coalesce(round(count(*) filter (where t.status = 'done')::numeric / nullif(count(*), 0), 4), 0)
  from public.tasks t where t.version_id is not null group by t.team_id, t.version_id
  on conflict on constraint daily_stats_unique do update set
    total = excluded.total, todo = excluded.todo, doing = excluded.doing,
    done = excluded.done, overdue = excluded.overdue,
    completion_rate = excluded.completion_rate, created_at = now();

  insert into public.daily_stats (team_id, snapshot_date, member_id, version_id, total, todo, doing, done, overdue, completion_rate)
  select t.team_id, p_date, t.assignee_id, t.version_id,
    count(*)::int,
    count(*) filter (where t.status = 'todo')::int,
    count(*) filter (where t.status = 'doing')::int,
    count(*) filter (where t.status = 'done')::int,
    count(*) filter (where t.status <> 'done' and t.due_date < p_date)::int,
    coalesce(round(count(*) filter (where t.status = 'done')::numeric / nullif(count(*), 0), 4), 0)
  from public.tasks t where t.version_id is not null group by t.team_id, t.assignee_id, t.version_id
  on conflict on constraint daily_stats_unique do update set
    total = excluded.total, todo = excluded.todo, doing = excluded.doing,
    done = excluded.done, overdue = excluded.overdue,
    completion_rate = excluded.completion_rate, created_at = now();

  delete from public.daily_stats where snapshot_date < (p_date - interval '12 months')::date;
end
$$;

revoke all on function public.take_daily_stats_snapshot(date) from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'marketing-workbench-daily-stats') then
    perform cron.schedule('marketing-workbench-daily-stats', '5 16 * * *', 'select public.take_daily_stats_snapshot()');
  end if;
end
$$;

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.versions enable row level security;
alter table public.goals enable row level security;
alter table public.milestones enable row level security;
alter table public.schedule_items enable row level security;
alter table public.selling_points enable row level security;
alter table public.tasks enable row level security;
alter table public.task_steps enable row level security;
alter table public.content_updates enable row level security;
alter table public.update_reads enable row level security;
alter table public.social_connections enable row level security;
alter table public.trend_items enable row level security;
alter table public.saved_topics enable row level security;
alter table public.settings enable row level security;
alter table public.daily_stats enable row level security;

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

create policy teams_read on public.teams for select to authenticated
using (private.is_active_user() and id = private.current_team_id());
create policy profiles_read on public.profiles for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id());
create policy profiles_admin_write on public.profiles for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());

create policy versions_read on public.versions for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id());
create policy versions_admin_write on public.versions for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());

create policy goals_read on public.goals for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or published));
create policy goals_admin_write on public.goals for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy milestones_read on public.milestones for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or published));
create policy milestones_admin_write on public.milestones for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy schedules_read on public.schedule_items for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or published));
create policy schedules_admin_write on public.schedule_items for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy selling_points_read on public.selling_points for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or published));
create policy selling_points_admin_write on public.selling_points for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());

create policy tasks_read on public.tasks for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or assignee_id = (select auth.uid())));
create policy tasks_insert on public.tasks for insert to authenticated
with check (private.is_active_user() and team_id = private.current_team_id() and
  (private.is_admin() or (source = 'self' and assignee_id = (select auth.uid()) and created_by = (select auth.uid()))));
create policy tasks_update on public.tasks for update to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or assignee_id = (select auth.uid())))
with check (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or assignee_id = (select auth.uid())));
create policy tasks_delete on public.tasks for delete to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or (assignee_id = (select auth.uid()) and source = 'self')));

create policy steps_read on public.task_steps for select to authenticated
using (private.is_active_user() and exists (
  select 1 from public.tasks t where t.id = task_id and t.team_id = private.current_team_id()
    and (private.is_admin() or t.assignee_id = (select auth.uid()))));
create policy steps_insert on public.task_steps for insert to authenticated
with check (private.is_active_user() and exists (
  select 1 from public.tasks t where t.id = task_id and t.assignee_id = (select auth.uid())));
create policy steps_update on public.task_steps for update to authenticated
using (private.is_active_user() and exists (
  select 1 from public.tasks t where t.id = task_id and t.assignee_id = (select auth.uid())));
create policy steps_delete on public.task_steps for delete to authenticated
using (private.is_active_user() and exists (
  select 1 from public.tasks t where t.id = task_id and t.assignee_id = (select auth.uid())));

create policy updates_read on public.content_updates for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id());
create policy updates_admin_write on public.content_updates for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy reads_own on public.update_reads for all to authenticated
using (private.is_active_user() and user_id = (select auth.uid()))
with check (private.is_active_user() and user_id = (select auth.uid()));

create policy connections_read on public.social_connections for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or user_id = (select auth.uid())));
create policy connections_admin_write on public.social_connections for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy trends_read on public.trend_items for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id());
create policy trends_admin_write on public.trend_items for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy topics_own on public.saved_topics for all to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and user_id = (select auth.uid()))
with check (private.is_active_user() and team_id = private.current_team_id() and user_id = (select auth.uid()));
create policy settings_read on public.settings for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id());
create policy settings_admin_write on public.settings for all to authenticated
using (private.is_admin() and team_id = private.current_team_id())
with check (private.is_admin() and team_id = private.current_team_id());
create policy stats_read on public.daily_stats for select to authenticated
using (private.is_active_user() and team_id = private.current_team_id() and (private.is_admin() or member_id = (select auth.uid())));

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','versions','goals','milestones','schedule_items','selling_points','tasks','task_steps','content_updates','trend_items','daily_stats']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

commit;
