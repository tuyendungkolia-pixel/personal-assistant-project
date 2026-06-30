create extension if not exists pgcrypto;

create table if not exists public.planner_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  planner_state jsonb not null default '{}'::jsonb,
  copilot_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists planner_states_updated_at_idx
  on public.planner_states (updated_at desc);

alter table public.planner_states enable row level security;

drop policy if exists "Users can read their planner state" on public.planner_states;
create policy "Users can read their planner state"
  on public.planner_states
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their planner state" on public.planner_states;
create policy "Users can insert their planner state"
  on public.planner_states
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their planner state" on public.planner_states;
create policy "Users can update their planner state"
  on public.planner_states
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
