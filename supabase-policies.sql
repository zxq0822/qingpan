create extension if not exists pgcrypto;

create table if not exists public.qingpan_files (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  path text not null,
  filename text not null,
  size bigint,
  content_type text,
  expires_at timestamptz,
  created_at timestamptz default now()
);

alter table public.qingpan_files add column if not exists expires_at timestamptz;

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

drop policy if exists "allow update qingpan_files" on public.qingpan_files;
create policy "allow update qingpan_files"
on public.qingpan_files
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "allow delete qingpan_files" on public.qingpan_files;
create policy "allow delete qingpan_files"
on public.qingpan_files
for delete
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

drop policy if exists "allow delete from qingpan bucket" on storage.objects;
create policy "allow delete from qingpan bucket"
on storage.objects
for delete
to anon, authenticated
using (bucket_id = 'qingpan');

create extension if not exists pg_cron;

create or replace function public.qingpan_cleanup_expired()
returns void
language plpgsql
security definer
as $$
begin
  delete from storage.objects
  where bucket_id = 'qingpan'
    and name in (
      select path
      from public.qingpan_files
      where expires_at is not null
        and expires_at <= now()
    );

  delete from public.qingpan_files
  where expires_at is not null
    and expires_at <= now();
end;
$$;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'qingpan_cleanup') then
    perform cron.schedule(
      'qingpan_cleanup',
      '0 * * * *',
      'select public.qingpan_cleanup_expired();'
    );
  end if;
end $$;
