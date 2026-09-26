begin;

alter table public.stories
  add column if not exists media_bucket text not null default 'posts',
  add column if not exists media_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stories-private',
  'stories-private',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Stories private owner uploads" on storage.objects;
create policy "Stories private owner uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'stories-private'
  and (storage.foldername(name))[1] = 'stories'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and storage.filename(name) <> ''
);

drop policy if exists "Stories private owner deletes" on storage.objects;
create policy "Stories private owner deletes"
on storage.objects for delete to authenticated
using (
  bucket_id = 'stories-private'
  and (storage.foldername(name))[1] = 'stories'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

alter table public.profiles
  add column if not exists phone_e164 text,
  add column if not exists phone_verified_at timestamptz;

create table if not exists public.account_phone_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_e164 text not null,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists account_phone_links_phone_idx
  on public.account_phone_links(phone_e164, verified_at desc);

alter table public.account_phone_links enable row level security;

drop policy if exists account_phone_links_select_own on public.account_phone_links;
create policy account_phone_links_select_own
on public.account_phone_links for select to authenticated
using ((select auth.uid()) = user_id);

create table if not exists public.phone_verification_nonces (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  nonce text not null unique,
  purpose text not null check (purpose in ('signup','recovery')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists phone_verification_nonces_phone_idx
  on public.phone_verification_nonces(phone_e164, purpose, created_at desc);

alter table public.phone_verification_nonces enable row level security;

drop policy if exists phone_verification_nonces_no_client_read on public.phone_verification_nonces;
create policy phone_verification_nonces_no_client_read
on public.phone_verification_nonces for all to anon, authenticated
using (false) with check (false);

create or replace function public.claim_verified_phone(
  p_user_id uuid,
  p_phone_e164 text,
  p_nonce text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nonce public.phone_verification_nonces;
  v_count integer;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'NOT_YOUR_ACCOUNT' using errcode = '42501';
  end if;

  select * into v_nonce
  from public.phone_verification_nonces
  where phone_e164 = p_phone_e164
    and nonce = p_nonce
    and purpose = 'signup'
    and consumed_at is null
    and expires_at > now()
  for update;

  if v_nonce.id is null then
    raise exception 'PHONE_VERIFICATION_EXPIRED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_phone_e164, 0));

  if exists (
    select 1 from public.account_phone_links
    where user_id = p_user_id and phone_e164 = p_phone_e164
  ) then
    update public.phone_verification_nonces set consumed_at = now() where id = v_nonce.id;
    update public.profiles
    set phone_e164 = p_phone_e164, phone_verified_at = now()
    where id = p_user_id;
    return true;
  end if;

  select count(*) into v_count
  from public.account_phone_links
  where phone_e164 = p_phone_e164;

  if v_count >= 2 then
    raise exception 'PHONE_ACCOUNT_LIMIT_REACHED' using errcode = '23514';
  end if;

  insert into public.account_phone_links(user_id, phone_e164, verified_at)
  values (p_user_id, p_phone_e164, now());

  update public.profiles
  set phone_e164 = p_phone_e164, phone_verified_at = now()
  where id = p_user_id;

  update public.phone_verification_nonces
  set consumed_at = now()
  where id = v_nonce.id;

  return true;
end;
$$;

revoke all on function public.claim_verified_phone(uuid,text,text) from public, anon;
grant execute on function public.claim_verified_phone(uuid,text,text) to authenticated, service_role;

create schema if not exists private;

create or replace view private.user_directory as
select
  p.id,
  p.username,
  p.full_name,
  apl.phone_e164,
  u.email,
  apl.verified_at as phone_verified_at,
  u.email_confirmed_at,
  p.created_at
from public.profiles p
join auth.users u on u.id = p.id
left join public.account_phone_links apl on apl.user_id = p.id;

comment on view private.user_directory is 'Operator-only directory. Kept outside exposed API schemas; includes profile name, verified Yomy phone, email and timestamps.';

notify pgrst, 'reload schema';
commit;