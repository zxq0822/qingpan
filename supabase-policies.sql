create extension if not exists pgcrypto;

create table if not exists public.qingpan_files (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  created_at timestamptz default now()
);

alter table public.qingpan_files enable row level security;

drop policy if exists "allow insert qingpan_files" on public.qingpan_files;
create policy "allow insert qingpan_files"
on public.qingpan_files
for insert
to anon, authenticated
with check (true);

drop policy if exists "allow select qingpan_files" on public.qingpan_files;
create policy "allow select qingpan_files"
on public.qingpan_files
for select
to anon, authenticated
using (true);

insert into storage.buckets (id, name, public)
values ('qingpan', 'qingpan', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "allow upload to qingpan bucket" on storage.objects;
create policy "allow upload to qingpan bucket"
on storage.objects
for insert
to anon, authenticated
with check (bucket_id = 'qingpan');

drop policy if exists "allow read from qingpan bucket" on storage.objects;
create policy "allow read from qingpan bucket"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'qingpan');
