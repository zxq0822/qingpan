# QingPan

Minimal file handoff UI with Supabase storage and pickup codes.

## Setup

1) Create a Supabase project.
2) Create a storage bucket (name it `qingpan` or set a custom name in env).
3) Create a table `qingpan_files`:

```sql
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

create policy "allow insert qingpan_files"
on public.qingpan_files
for insert
to anon, authenticated
with check (true);

create policy "allow select qingpan_files"
on public.qingpan_files
for select
to anon, authenticated
using (true);

create policy "allow update qingpan_files"
on public.qingpan_files
for update
to anon, authenticated
using (true)
with check (true);

create policy "allow delete qingpan_files"
on public.qingpan_files
for delete
to anon, authenticated
using (true);
```

4) For the bucket, choose one of these options:
   - Public bucket: easiest for the current frontend, no extra storage policy needed.
   - Private bucket: add storage policies or switch the app to signed URLs later.
5) Add environment variables (see `.env.example`).

## Storage policy SQL

If uploads are denied, run the SQL in [`supabase-policies.sql`](supabase-policies.sql). It now includes:

- `qingpan_files` table RLS policies
- `storage.buckets` setup for the `qingpan` bucket
- `storage.objects` upload/read/update/delete policies for the `qingpan` bucket
- a cleanup function + hourly cron to purge expired files

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy on Vercel

1. Push to GitHub.
2. Connect repo to Vercel.
3. In Vercel project Settings → Environment Variables, add:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SUPABASE_BUCKET` (optional, defaults to `qingpan`)
4. Deploy.
