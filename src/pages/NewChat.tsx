import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Search, UsersRound, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import BottomNav from '@/components/layout/BottomNav'

export default function NewChat() {
  const { user, profile } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState(params.get('to') || '')
  const [people, setPeople] = useState<Profile[]>([])
  const [recent, setRecent] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const language = document.documentElement.lang || profile?.language || 'en'
  const copy = language === 'ar'
    ? { title:'محادثة جديدة', search:'ابحث عن شخص', recent:'الأحدث', people:'الأشخاص', empty:'لم نجد حسابًا مطابقًا' }
    : language === 'de'
      ? { title:'Neuer Chat', search:'Person suchen', recent:'Zuletzt', people:'Personen', empty:'Kein passendes Konto gefunden' }
      : language === 'fr'
        ? { title:'Nouveau chat', search:'Rechercher une personne', recent:'Récents', people:'Personnes', empty:'Aucun compte correspondant' }
        : language === 'es'
          ? { title:'Nuevo chat', search:'Buscar una persona', recent:'Recientes', people:'Personas', empty:'No encontramos una cuenta' }
          : { title:'New chat', search:'Search people', recent:'Recent', people:'People', empty:'No matching account' }

  const loadRecent = useCallback(async () => {
    if (!user) return
    const { data } = await supabase.from('messages')
      .select('sender_id,receiver_id,created_at')
      .or('sender_id.eq.' + user.id + ',receiver_id.eq.' + user.id)
      .order('created_at', { ascending: false })
      .limit(60)
    const ids: string[] = []
    for (const row of data || []) {
      const id = row.sender_id === user.id ? row.receiver_id : row.sender_id
      if (id !== user.id && !ids.includes(id)) ids.push(id)
      if (ids.length >= 12) break
    }
    if (!ids.length) { setRecent([]); return }
    const { data: profiles } = await supabase.from('profiles').select('*').in('id', ids)
    const map = new Map((profiles || []).map(p => [p.id, p as Profile]))
    setRecent(ids.map(id => map.get(id)).filter(Boolean) as Profile[])
  }, [user])

  const searchPeople = useCallback(async (value: string) => {
    if (!user) return
    const term = value.trim()
    if (!term) { setPeople([]); return }
    const { data } = await supabase.from('profiles').select('*')
      .or('username.ilike.%' + term + '%,full_name.ilike.%' + term + '%')
      .neq('id', user.id)
      .limit(20)
    setPeople((data || []) as Profile[])
  }, [user])

  useEffect(() => {
    let active = true
    void (async () => {
      setLoading(true)
      await loadRecent()
      if (active) setLoading(false)
    })()
    return () => { active = false }
  }, [loadRecent])

  useEffect(() => {
    const handle = window.setTimeout(() => void searchPeople(query), 180)
    return () => window.clearTimeout(handle)
  }, [query, searchPeople])

  const visiblePeople = useMemo(() => query.trim() ? people : recent, [people, query])
  const openChat = (person: Profile) => navigate('/messages/' + encodeURIComponent(person.username))

  return (
    <div className="yomy-glass-page min-h-[100dvh] pb-24">
      <header className="sticky top-0 z-30 yomy-glass-bar border-b border-border/45">
        <div className="max-w-lg mx-auto h-16 px-2 flex items-center gap-2">
          <Button variant="ghost" size="icon" className="yomy-icon-button rounded-full" onClick={() => navigate(-1)} aria-label="Back"><ChevronLeft className="size-5" /></Button>
          <div className="min-w-0 flex-1"><h1 className="font-semibold text-base">{copy.title}</h1><p className="text-[10px] text-muted-foreground">{copy.people}</p></div>
          <div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary"><UsersRound className="size-5" /></div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-3 pt-3">
        <div className="yomy-ios-panel p-2.5">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={copy.search} className="h-11 pl-9 pr-9 rounded-[1.1rem] bg-background/55 border-white/10 shadow-inner" />
            {query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 grid size-7 place-items-center rounded-full bg-muted/70" aria-label="Clear"><X className="size-4" /></button>}
          </div>
        </div>

        <section className="mt-4">
          <div className="px-2 mb-2 flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[.14em] text-muted-foreground">{query ? copy.people : copy.recent}</h2>
            {loading && <span className="text-[10px] text-muted-foreground">Loading…</span>}
          </div>
          <div className="yomy-ios-panel overflow-hidden">
            {visiblePeople.length === 0 && !loading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">{copy.empty}</div>
            ) : (
              visiblePeople.map((person, index) => (
                <button key={person.id} type="button" onClick={() => openChat(person)} className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/45 active:scale-[.995] transition-all">
                  <Avatar className="size-12 ring-1 ring-border/50 shadow-sm"><AvatarImage src={person.avatar_url} /><AvatarFallback>{person.username?.[0]?.toUpperCase()}</AvatarFallback></Avatar>
                  <span className="min-w-0 flex-1"><b className="block text-sm truncate">{person.username}</b><small className="block text-xs text-muted-foreground truncate">{person.full_name}</small></span>
                  <span className="grid size-9 place-items-center rounded-full bg-primary/8 text-primary"><ChevronLeft className="size-4 rtl:rotate-180" /></span>
                  {index < visiblePeople.length - 1 && <span className="absolute" />}
                </button>
              ))
            )}
          </div>
        </section>

        <p className="text-center text-[10px] text-muted-foreground mt-4 px-6">YOMY contacts are private and only your selected conversation opens.</p>
      </main>
      <BottomNav />
    </div>
  )
}
