create table public.todo_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null check (char_length(trim(title)) > 0),
  note text not null default '',
  due_at timestamptz,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  remind_before_minutes integer not null default 10 check (remind_before_minutes >= 0 and remind_before_minutes <= 10080),
  tags text[] not null default '{}',
  is_done boolean not null default false,
  is_notified boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint todo_plans_completed_at_check check (
    (is_done = true and completed_at is not null)
    or (is_done = false)
  )
);

comment on table public.todo_plans is 'Stores user todo plan items written by the backend through PostgreSQL Session Pool connections.';
comment on column public.todo_plans.user_id is 'Application user identifier. Backend should set this from authenticated session context.';
comment on column public.todo_plans.remind_before_minutes is 'How many minutes before due_at the reminder should trigger.';

create index todo_plans_user_created_at_idx on public.todo_plans (user_id, created_at desc);
create index todo_plans_user_due_at_idx on public.todo_plans (user_id, due_at) where due_at is not null;
create index todo_plans_user_done_idx on public.todo_plans (user_id, is_done);
create index todo_plans_tags_gin_idx on public.todo_plans using gin (tags);

create or replace function public.set_todo_plans_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();

  if new.is_done = true and old.is_done = false and new.completed_at is null then
    new.completed_at = now();
  elsif new.is_done = false then
    new.completed_at = null;
  end if;

  return new;
end;
$$;

create trigger set_todo_plans_updated_at
before update on public.todo_plans
for each row
execute function public.set_todo_plans_updated_at();

alter table public.todo_plans enable row level security;

create policy "backend_service_role_full_access"
on public.todo_plans
for all
to service_role
using (true)
with check (true);
