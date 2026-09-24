import type { ChatPreference } from '@/lib/supabase'

export const wallpaperClass = (value: ChatPreference['wallpaper']) => ({
  default: 'bg-background',
  romance: 'yomy-chat-wallpaper-romance',
  hearts: 'yomy-chat-wallpaper-hearts',
  petals: 'yomy-chat-wallpaper-petals',
  midnight: 'yomy-chat-wallpaper-midnight',
  paper: 'yomy-chat-wallpaper-paper',
}[value])

export const bubbleClass = (value: ChatPreference['bubble_theme']) => ({
  default: 'bg-primary text-primary-foreground',
  ocean: 'bg-sky-600 text-white',
  mint: 'bg-emerald-600 text-white',
  violet: 'bg-violet-600 text-white',
  rose: 'bg-rose-600 text-white',
  amber: 'bg-amber-600 text-white',
}[value])
