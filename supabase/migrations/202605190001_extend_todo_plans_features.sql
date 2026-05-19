alter table public.todo_plans
  add column if not exists recurrence text not null default 'none'
    check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  add column if not exists folder text not null default '默认',
  add column if not exists sort_order integer not null default 0,
  add column if not exists progress_current integer not null default 0
    check (progress_current >= 0),
  add column if not exists progress_total integer not null default 1
    check (progress_total >= 1);

update public.todo_plans
set sort_order = extract(epoch from created_at)::integer
where sort_order = 0;

create index if not exists todo_plans_user_folder_idx on public.todo_plans (user_id, folder);
create index if not exists todo_plans_user_sort_order_idx on public.todo_plans (user_id, sort_order);
