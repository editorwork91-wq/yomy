alter table public.fedos
  add column if not exists thumbnail_path text,
  add column if not exists storage_node text;

create index if not exists idx_fedos_storage_node on public.fedos(storage_node);
create index if not exists idx_fedos_storage_shard on public.fedos(storage_shard);

comment on column public.fedos.thumbnail_path is 'Private thumbnail object path on the selected Fedo storage node; never a public URL.';
comment on column public.fedos.storage_node is 'Stable logical storage node identifier, e.g. fedo-video-node-01.';
