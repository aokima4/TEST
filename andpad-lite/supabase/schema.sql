-- ANDPAD-lite schema: 案件管理 + 工程表 + 写真共有
-- Roles: 元請 (contractor) / 協力会社 (subcontractor)

create type user_role as enum ('contractor', 'subcontractor');
create type project_status as enum ('preparing', 'in_progress', 'completed', 'on_hold');
create type task_status as enum ('not_started', 'in_progress', 'done');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role user_role not null default 'subcontractor',
  company_name text,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  client_name text,
  status project_status not null default 'preparing',
  start_date date,
  end_date date,
  owner_id uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table project_members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role_in_project user_role not null default 'subcontractor',
  primary key (project_id, user_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  title text not null,
  assignee_id uuid references profiles(id),
  start_date date not null,
  end_date date not null,
  status task_status not null default 'not_started',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  storage_path text not null,
  caption text,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

-- RLS
alter table profiles enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table tasks enable row level security;
alter table photos enable row level security;

create policy "profiles_select_all" on profiles for select using (true);
create policy "profiles_update_self" on profiles for update using (auth.uid() = id);
create policy "profiles_insert_self" on profiles for insert with check (auth.uid() = id);

create policy "members_select_own" on project_members for select
  using (user_id = auth.uid() or project_id in (select id from projects where owner_id = auth.uid()));

create policy "projects_select_member" on projects for select
  using (owner_id = auth.uid() or id in (select project_id from project_members where user_id = auth.uid()));
create policy "projects_insert_contractor" on projects for insert
  with check (owner_id = auth.uid());
create policy "projects_update_owner" on projects for update
  using (owner_id = auth.uid());

create policy "members_insert_owner" on project_members for insert
  with check (project_id in (select id from projects where owner_id = auth.uid()));
create policy "members_delete_owner" on project_members for delete
  using (project_id in (select id from projects where owner_id = auth.uid()));

create policy "tasks_select_member" on tasks for select
  using (project_id in (
    select id from projects where owner_id = auth.uid()
    union
    select project_id from project_members where user_id = auth.uid()
  ));
create policy "tasks_write_member" on tasks for insert
  with check (project_id in (
    select id from projects where owner_id = auth.uid()
    union
    select project_id from project_members where user_id = auth.uid()
  ));
create policy "tasks_update_member" on tasks for update
  using (project_id in (
    select id from projects where owner_id = auth.uid()
    union
    select project_id from project_members where user_id = auth.uid()
  ));
create policy "tasks_delete_owner" on tasks for delete
  using (project_id in (select id from projects where owner_id = auth.uid()));

create policy "photos_select_member" on photos for select
  using (project_id in (
    select id from projects where owner_id = auth.uid()
    union
    select project_id from project_members where user_id = auth.uid()
  ));
create policy "photos_insert_member" on photos for insert
  with check (project_id in (
    select id from projects where owner_id = auth.uid()
    union
    select project_id from project_members where user_id = auth.uid()
  ));
create policy "photos_delete_owner" on photos for delete
  using (uploaded_by = auth.uid() or project_id in (select id from projects where owner_id = auth.uid()));

-- Storage bucket for photos (run once)
insert into storage.buckets (id, name, public) values ('project-photos', 'project-photos', false)
  on conflict (id) do nothing;

create policy "storage_select_member" on storage.objects for select
  using (bucket_id = 'project-photos' and auth.role() = 'authenticated');
create policy "storage_insert_member" on storage.objects for insert
  with check (bucket_id = 'project-photos' and auth.role() = 'authenticated');
