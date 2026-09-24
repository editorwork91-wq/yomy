import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/components/theme-provider'
import { LANGUAGE_LABELS, type YomyLanguage, applyYomyFontScale, applyYomyLanguage, systemTimezone, t } from '@/lib/i18n'
import TopBar from '@/components/layout/TopBar'
import BottomNav from '@/components/layout/BottomNav'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { LogOut, ChevronRight, Shield, Bell, Eye, MessageSquare, Moon, Sun, Type, Languages, Ban, UserRound, Smartphone } from 'lucide-react'

type BlockedUser = { blocked_id: string; profiles?: { id: string; username: string; full_name: string; avatar_url: string } | null }

export default function Settings() {
  const { user, profile, signOut, refreshProfile } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const language = (profile?.language || (document.documentElement.lang as YomyLanguage) || 'en') as YomyLanguage
  const [isPrivate, setIsPrivate] = useState(false)
  const [showSeenReceipts, setShowSeenReceipts] = useState(true)
  const [showFollowersTo, setShowFollowersTo] = useState<'everyone' | 'followers' | 'nobody'>('everyone')
  const [whoCanMessage, setWhoCanMessage] = useState<'everyone' | 'followers' | 'nobody'>('everyone')
  const [sleepEnabled, setSleepEnabled] = useState(false)
  const [sleepStart, setSleepStart] = useState('22:00')
  const [sleepEnd, setSleepEnd] = useState('05:00')
  const [timezone, setTimezone] = useState('UTC')
  const [fontScale, setFontScale] = useState(1)
  const [saving, setSaving] = useState(false)
  const [blocked, setBlocked] = useState<BlockedUser[]>([])
  const [blockedLoading, setBlockedLoading] = useState(false)

  const copy = useMemo(() => (key: keyof typeof import('@/lib/i18n').translations.en) => t(language, key), [language])

  useEffect(() => {
    if (profile) {
      setIsPrivate(profile.is_private)
      setShowSeenReceipts(profile.show_seen_receipts)
      setShowFollowersTo(profile.show_followers_to)
      setWhoCanMessage(profile.who_can_message)
      setSleepEnabled(Boolean(profile.sleep_mode_enabled))
      setSleepStart(profile.sleep_start?.slice(0, 5) || '22:00')
      setSleepEnd(profile.sleep_end?.slice(0, 5) || '05:00')
      setTimezone(profile.timezone_name || systemTimezone())
      setFontScale(Number(profile.font_scale || 1))
    }
  }, [profile])

  const saveFields = async (patch: Record<string, unknown>) => {
    if (!user) return false
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (error) throw error
      await refreshProfile()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      return false
    } finally {
      setSaving(false)
    }
  }

  const changeLanguage = async (next: YomyLanguage) => {
    applyYomyLanguage(next)
    await saveFields({ language: next })
    toast.success(next === 'ar' ? 'تم تغيير اللغة' : 'Language updated')
  }

  const changeFontScale = async (next: number) => {
    setFontScale(next)
    applyYomyFontScale(next)
    await saveFields({ font_scale: next })
  }

  const updateSleep = async (enabled: boolean) => {
    setSleepEnabled(enabled)
    const ok = await saveFields({
      sleep_mode_enabled: enabled,
      sleep_start: sleepStart + ':00',
      sleep_end: sleepEnd + ':00',
      timezone_name: timezone,
    })
    if (ok) toast.success(enabled ? 'Sleep mode enabled' : 'Sleep mode disabled')
  }

  const saveSleepWindow = async () => {
    const ok = await saveFields({
      sleep_mode_enabled: sleepEnabled,
      sleep_start: sleepStart + ':00',
      sleep_end: sleepEnd + ':00',
      timezone_name: timezone,
    })
    if (ok) toast.success('Sleep schedule saved')
  }

  const loadBlocked = async () => {
    if (!user) return
    setBlockedLoading(true)
    const { data } = await supabase
      .from('blocks')
      .select('blocked_id, profiles!blocked_id(id,username,full_name,avatar_url)')
      .eq('blocker_id', user.id)
      .order('created_at', { ascending: false })
    setBlocked((data || []) as unknown as BlockedUser[])
    setBlockedLoading(false)
  }

  const unblock = async (id: string) => {
    if (!user) return
    const { error } = await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', id)
    if (error) return toast.error(error.message)
    setBlocked(current => current.filter(item => item.blocked_id !== id))
    toast.success('Unblocked')
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="pb-20">
      <TopBar title={copy('settings')} showBack />
      <div className="max-w-lg mx-auto px-4 py-4 space-y-5">
        <section className="yomy-ios-panel overflow-hidden">
          <div className="yomy-settings-header"><div className="yomy-icon-orb"><Languages className="size-5" /></div><div><h2>{copy('language')}</h2><p>Choose the interface language and direction</p></div></div>
          <div className="p-3">
            <Select value={language} onValueChange={value => void changeLanguage(value as YomyLanguage)}>
              <SelectTrigger className="yomy-ios-control"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(LANGUAGE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </section>

        <section className="yomy-ios-panel overflow-hidden">
          <div className="yomy-settings-header"><div className="yomy-icon-orb"><Sun className="size-5" /></div><div><h2>{copy('appearance')}</h2><p>Fast, native-feeling display controls</p></div></div>
          <div className="p-3 space-y-2">
            <div className="yomy-setting-row"><div className="flex items-center gap-3"><Moon className="size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{copy('darkMode')}</p><p className="text-xs text-muted-foreground">Light, dark or follow system</p></div></div><Switch checked={theme === 'dark'} onCheckedChange={checked => setTheme(checked ? 'dark' : 'light')} /></div>
            <Separator />
            <div className="p-2"><div className="flex items-center gap-3 mb-2"><Type className="size-4 text-muted-foreground" /><div><p className="text-sm font-medium">{copy('fontSize')}</p><p className="text-xs text-muted-foreground">Applies across the app</p></div></div><div className="grid grid-cols-3 gap-2">{[{value:.9,label:copy('small')},{value:1,label:copy('medium')},{value:1.12,label:copy('large')}].map(option => <Button key={option.value} variant={fontScale === option.value ? 'default' : 'outline'} className="rounded-2xl" onClick={() => void changeFontScale(option.value)}>{option.label}</Button>)}</div></div>
          </div>
        </section>

        <section className="yomy-ios-panel overflow-hidden">
          <div className="yomy-settings-header"><div className="yomy-icon-orb"><Moon className="size-5" /></div><div><h2>{copy('sleepMode')}</h2><p>{copy('sleepDescription')}</p></div></div>
          <div className="p-3">
            <div className="yomy-setting-row"><div><p className="text-sm font-medium">{sleepEnabled ? 'Active' : 'Off'}</p><p className="text-xs text-muted-foreground">No new messages or calls during the window</p></div><Switch checked={sleepEnabled} onCheckedChange={value => void updateSleep(value)} disabled={saving} /></div>
            <Separator className="my-2" />
            <div className="grid grid-cols-2 gap-2">
              <label className="yomy-time-card"><span>From</span><input value={sleepStart} type="time" onChange={e => setSleepStart(e.target.value)} /></label>
              <label className="yomy-time-card"><span>Until</span><input value={sleepEnd} type="time" onChange={e => setSleepEnd(e.target.value)} /></label>
            </div>
            <div className="mt-2"><p className="text-[11px] text-muted-foreground">Timezone</p><button className="w-full mt-1 yomy-ios-control text-left flex items-center gap-2" onClick={() => setTimezone(systemTimezone())}><Smartphone className="size-4 text-muted-foreground" /><span className="truncate">{timezone}</span><span className="ml-auto text-[10px] text-muted-foreground">Use device</span></button></div>
            <Button className="w-full mt-3 rounded-2xl" onClick={() => void saveSleepWindow()} disabled={saving}>{saving ? <Spinner className="size-4 mr-2" /> : null}{copy('save')}</Button>
          </div>
        </section>

        <section className="yomy-ios-panel overflow-hidden">
          <div className="yomy-settings-header"><div className="yomy-icon-orb"><Shield className="size-5" /></div><div><h2>{copy('privacy')}</h2><p>Control visibility, activity and messaging</p></div></div>
          <div className="p-3 space-y-1">
            <div className="yomy-setting-row"><div><Label>{copy('privacyAccount')}</Label><p className="text-xs text-muted-foreground mt-0.5">Only approved followers can see private content</p></div><Switch checked={isPrivate} onCheckedChange={value => { setIsPrivate(value); void saveFields({ is_private: value }) }} disabled={saving} /></div>
            <Separator />
            <div className="p-2"><Label>{copy('followingVisibility')}</Label><p className="text-xs text-muted-foreground mb-2">Who can see your following list</p><Select value={showFollowersTo} onValueChange={value => { setShowFollowersTo(value as typeof showFollowersTo); void saveFields({ show_followers_to: value }) }}><SelectTrigger className="yomy-ios-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="everyone">Everyone</SelectItem><SelectItem value="followers">Followers only</SelectItem><SelectItem value="nobody">Nobody</SelectItem></SelectContent></Select></div>
            <Separator />
            <div className="yomy-setting-row"><div><Label>{copy('readReceipts')}</Label><p className="text-xs text-muted-foreground mt-0.5">Let others know when you have seen messages</p></div><Switch checked={showSeenReceipts} onCheckedChange={value => { setShowSeenReceipts(value); void saveFields({ show_seen_receipts: value }) }} disabled={saving} /></div>
            <Separator />
            <div className="p-2"><Label>{copy('whoCanMessage')}</Label><p className="text-xs text-muted-foreground mb-2">Control who can start a chat</p><Select value={whoCanMessage} onValueChange={value => { setWhoCanMessage(value as typeof whoCanMessage); void saveFields({ who_can_message: value }) }}><SelectTrigger className="yomy-ios-control"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="everyone">Everyone</SelectItem><SelectItem value="followers">Followers only</SelectItem><SelectItem value="nobody">Nobody</SelectItem></SelectContent></Select></div>
          </div>
        </section>

        <section className="yomy-ios-panel overflow-hidden">
          <div className="yomy-settings-header"><div className="yomy-icon-orb"><Ban className="size-5" /></div><div><h2>{copy('blocked')}</h2><p>Manage accounts you have blocked</p></div><Button variant="ghost" size="sm" onClick={() => void loadBlocked()}>Refresh</Button></div>
          <div className="p-3">{blockedLoading ? <div className="py-5 flex justify-center"><Spinner className="size-5" /></div> : blocked.length === 0 ? <p className="text-xs text-muted-foreground p-2">No blocked accounts</p> : <div className="space-y-1">{blocked.map(item => <div key={item.blocked_id} className="flex items-center gap-3 p-2 rounded-2xl bg-muted/35"><div className="size-9 rounded-full overflow-hidden bg-muted">{item.profiles?.avatar_url && <img src={item.profiles.avatar_url} className="size-full object-cover" alt="" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium truncate">@{item.profiles?.username || 'user'}</p><p className="text-[11px] text-muted-foreground truncate">{item.profiles?.full_name}</p></div><Button size="sm" variant="outline" className="rounded-xl" onClick={() => void unblock(item.blocked_id)}>Unblock</Button></div>)}</div>}</div>
        </section>

        <section className="yomy-ios-panel overflow-hidden">
          <div className="p-1">
            <Link to="/edit-profile" className="yomy-setting-row"><span className="flex items-center gap-3"><UserRound className="size-4 text-muted-foreground" /><span className="text-sm font-medium">{copy('editProfile')}</span></span><ChevronRight className="size-4 text-muted-foreground" /></Link>
            <Separator />
            <Link to="/notifications" className="yomy-setting-row"><span className="flex items-center gap-3"><Bell className="size-4 text-muted-foreground" /><span className="text-sm font-medium">{copy('notifications')}</span></span><ChevronRight className="size-4 text-muted-foreground" /></Link>
            <Separator />
            <Link to="/messages" className="yomy-setting-row"><span className="flex items-center gap-3"><MessageSquare className="size-4 text-muted-foreground" /><span className="text-sm font-medium">{copy('messages')}</span></span><ChevronRight className="size-4 text-muted-foreground" /></Link>
          </div>
        </section>

        <Button variant="outline" className="w-full rounded-2xl h-12 text-destructive hover:text-destructive" onClick={() => void handleSignOut()}><LogOut className="size-4 mr-2" />{copy('logout')}</Button>
      </div>
      <BottomNav />
    </div>
  )
}
