import { useEffect, useState } from 'react'
import { Play } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Fedo, Profile } from '@/lib/supabase'

type PreviewRow = Omit<Fedo, 'profiles'> & { profiles?: Profile | Profile[] }

export default function FedoPreviewStrip() {
  const [items, setItems] = useState<PreviewRow[]>([])
  useEffect(() => { let mounted = true; void supabase.from('fedos').select('id,user_id,media_path,media_url,thumbnail_url,caption,status,visibility,published_at,deleted_at,retention_until,duration_ms,width,height,file_size_bytes,storage_shard,created_at,updated_at,profiles!user_id(id,username,full_name,avatar_url,is_verified)').eq('status','published').eq('visibility','public').order('published_at',{ascending:false}).limit(6).then(({data}) => { if (!mounted) return; setItems((data || []).map(row => ({ ...row, profiles: Array.isArray(row.profiles) ? row.profiles[0] : row.profiles })) as PreviewRow[]) }); return () => { mounted = false } }, [])
  if (!items.length) return null
  return <section className="px-4 py-3 overflow-x-auto scrollbar-none"><div className="flex gap-3 w-max">{items.map(item => { const profile = item.profiles as Profile | undefined; return <Link key={item.id} to={`/fedo?item=${item.id}`} className="relative w-28 aspect-[9/16] overflow-hidden rounded-2xl bg-muted shrink-0 group"><video src={item.media_url} muted playsInline preload="metadata" className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"/><div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent"/><div className="absolute left-2 right-2 bottom-2 text-white"><p className="text-[11px] font-semibold truncate">@{profile?.username || 'creator'}</p><div className="flex items-center gap-1 text-[10px] text-white/70"><Play className="size-3"/>Fedo</div></div></Link> })}</div></section>
}
