import { useMemo, useState } from 'react'
import { Search, SmilePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const categories = {
  recent: ['❤️','😂','👍','🔥','😍','😭','🥹','🙏','👏','🎉','✨','💯','😎','🤍','💔','😘','🥰','😮','😢','🤝'],
  smileys: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫣','🤭','🫢','🫡','🤫','🫠','🤥','😶','🫥','😐','🫨','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑'],
  people: ['👋','🤚','🖐️','✋','🖖','👌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✍️','👏','🙌','🫶','🤝','🙏','💪','🫵','👀','🧠','🫀','🫂','👶','🧒','👦','👧','🧑','👨','👩','🧔','👴','👵','❤️‍🩹','💋','👄','🫦'],
  hearts: ['❤️','🩷','🧡','💛','💚','💙','🩵','💜','🖤','🩶','🤍','🤎','❤️‍🔥','💖','💗','💓','💞','💕','💘','💝','💟','❣️','💔','❤️‍🩹','💌','💋','💐','🌹','🌷','🌸','🌺','🌻','🌼','🌿','✨','💫','⭐','🌟','🩷','🫶'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦀','🐠','🐟','🐡','🐬','🐳','🦈','🐊','🐘','🦒','🦘','🦥','🦦','🦚','🦜'],
  food: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥝','🍅','🥑','🍞','🥐','🥨','🧀','🍔','🍟','🍕','🌭','🌮','🌯','🍜','🍣','🍩','🍪','🎂','🍰','🍫','🍿','☕','🧋','🍹'],
  activities: ['⚽','🏀','🏈','⚾','🎾','🏐','🏆','🎮','🎯','🎲','🎹','🎸','🎤','🎧','🎬','🎨','🚀','✈️','🚗','🏎️','🚲','🏝️','🏖️','🌋','🏡','🎁','🎈','🎉','🎊','🎃','🎄','🎅','🧨','🎆','🎇'],
  objects: ['💡','📱','💻','⌚','📷','🎥','📺','☎️','🔋','🔒','🔑','💎','💍','🕯️','📌','📍','✏️','📝','📚','💰','💳','📦','🛍️','🎀','🎁','🧸','👑','🪄','🔮','🧿','🪬','🧲','🔔','🎵','🎶','✅','❌','⚡','☀️','🌙'],
} as const

type Category = keyof typeof categories

const labels: Record<Category, string> = {
  recent: '★', smileys: '☺', people: '☻', hearts: '♥', animals: '🐻', food: '🍔', activities: '⚽', objects: '💡'
}

export default function EmojiReactionPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (emoji: string) => Promise<void> | void
}) {
  const [category, setCategory] = useState<Category>('recent')
  const [search, setSearch] = useState('')
  const [custom, setCustom] = useState('')

  const emojis = useMemo(() => {
    const source = categories[category]
    return search.trim() ? Object.values(categories).flat().filter(item => item.includes(search.trim())) : source
  }, [category, search])

  const choose = async (emoji: string) => {
    setSearch('')
    await onPick(emoji)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-[2rem] p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle className="flex items-center gap-2"><SmilePlus className="size-4 text-primary" />React to message</DialogTitle>
        </DialogHeader>
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search or type an emoji…" className="h-10 rounded-full pl-9 pr-10" />
            {search && <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2" onClick={() => setSearch('')}><X className="size-4 text-muted-foreground" /></button>}
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-y bg-muted/30 px-2 py-1.5">
          {(Object.keys(categories) as Category[]).map(item => <button key={item} type="button" onClick={() => { setCategory(item); setSearch('') }} className={'min-w-9 h-9 rounded-xl text-lg ' + (category === item ? 'bg-background shadow-sm' : 'opacity-60')}>{labels[item]}</button>)}
        </div>
        <div className="h-64 overflow-y-auto px-2 py-2">
          <div className="grid grid-cols-8 gap-1">
            {emojis.map((emoji, i) => <button key={emoji + i} type="button" onClick={() => void choose(emoji)} className="aspect-square rounded-xl text-[25px] hover:bg-muted active:scale-90 transition-transform">{emoji}</button>)}
          </div>
        </div>
        <div className="border-t p-3">
          <div className="flex gap-2">
            <Input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Any emoji / emoji sequence" className="rounded-xl" />
            <Button disabled={!custom.trim()} onClick={() => void choose(custom.trim())}>Use</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
