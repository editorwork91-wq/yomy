-- YOMY Huawei-only Push Kit support.
alter table public.native_push_tokens
  drop constraint if exists native_push_tokens_platform_check;

alter table public.native_push_tokens
  add constraint native_push_tokens_platform_check
  check (platform = any (array['android'::text, 'ios'::text, 'huawei'::text]));
