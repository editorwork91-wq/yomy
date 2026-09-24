import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ChatPreference } from '@/lib/supabase'

const wallpapers: Array<{ id: ChatPreference['wallpaper']; label: string; preview: string }> = [
  { id: 'default', label: 'Classic', preview: 'bg-background' },
  { id: 'romance', label: 'Romance', preview: 'yomy-chat-wallpaper-romance' },
  { id: 'hearts', label: 'Hearts', preview: 'yomy-chat-wallpaper-hearts' },
  { id: 'petals', label: 'Petals', preview: 'yomy-chat-wallpaper-petals' },
  { id: 'midnight', label: 'Midnight', preview: 'yomy-chat-wallpaper-midnight' },
  { id: 'paper', label: 'Paper', preview: 'yomy-chat-wallpaper-paper' },
]

const bubbles: Array<{ id: ChatPreference['bubble_theme']; label: string; className: string }> = [
  { id: 'default', label: 'Default', className: 'bg-primary' },
  { id: 'ocean', label: 'Ocean', className: 'bg-sky-600' },
  { id: 'mint', label: 'Mint', className: 'bg-emerald-600' },
  { id: 'violet', label: 'Violet', className: 'bg-violet-600' },
  { id: 'rose', label: 'Rose', className: 'bg-rose-600' },
  { id: 'amber', label: 'Amber', className: 'bg-amber-600' },
]

export default function ChatAppearanceDialog({
  open,
  preference,
  onOpenChange,
  onSave,
}: {
  open: boolean
  preference: ChatPreference
  onOpenChange: (open: boolean) => void
  onSave: (next: Pick<ChatPreference, 'wallpaper' | 'bubble_theme'>) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl">
        <DialogHeader>
          <DialogTitle>Chat appearance</DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <section>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Wallpaper</p>
            <div className="grid grid-cols-3 gap-2">
              {wallpapers.map(item => (
                <button key={item.id} type="button" onClick={() => void onSave({ wallpaper: item.id, bubble_theme: preference.bubble_theme })} className="group text-left">
                  <div className={`h-16 rounded-2xl border-2 transition-all ${item.preview} ${preference.wallpaper === item.id ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`} />
                  <p className="mt-1 text-[11px] truncate">{item.label}</p>
                </button>
              ))}
            </div>
          </section>
          <section>
            <p className="text-xs font-semibold text-muted-foreground mb-2">My message color</p>
            <div className="grid grid-cols-3 gap-2">
              {bubbles.map(item => (
                <Button key={item.id} type="button" variant="outline" className="justify-start gap-2 rounded-2xl" onClick={() => void onSave({ wallpaper: preference.wallpaper, bubble_theme: item.id })}>
                  <span className={`size-4 rounded-full ${item.className}`} />
                  <span className="text-xs">{item.label}</span>
                </Button>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
