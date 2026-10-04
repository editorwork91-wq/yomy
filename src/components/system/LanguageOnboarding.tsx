import { useState } from 'react'
import { Check, Globe2, Sparkles } from 'lucide-react'
import { applyYomyLanguage, LANGUAGE_LABELS, type YomyLanguage, useYomyLanguage, t } from '@/lib/i18n'
import { Button } from '@/components/ui/button'

const LANGUAGE_ORDER: YomyLanguage[] = ['en', 'ar', 'de', 'fr', 'es']

function browserLanguage(): YomyLanguage {
  const code = (navigator.language || '').slice(0, 2).toLowerCase() as YomyLanguage
  return LANGUAGE_LABELS[code] ? code : 'en'
}

export default function LanguageOnboarding() {
  const [open, setOpen] = useState(() => !localStorage.getItem('yomy-language-onboarding-complete'))
  const { language: activeLanguage } = useYomyLanguage()
  const [selected, setSelected] = useState<YomyLanguage>(() => {
    const stored = localStorage.getItem('yomy-language') as YomyLanguage | null
    return stored && LANGUAGE_LABELS[stored] ? stored : browserLanguage()
  })

  if (!open) return null

  const selectLanguage = (next: YomyLanguage) => {
    setSelected(next)
    applyYomyLanguage(next)
  }

  const finish = () => {
    applyYomyLanguage(selected)
    localStorage.setItem('yomy-language-onboarding-complete', 'true')
    setOpen(false)
  }

  const copy = (key: Parameters<typeof t>[1]) => t(selected, key)
  const recommended = browserLanguage()

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="yomy-language-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] border border-border/60 bg-card/95 shadow-2xl">
        <div className="relative px-6 pb-5 pt-7 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-[1.25rem] bg-gradient-to-br from-violet-600/15 via-pink-500/15 to-orange-400/15 text-primary ring-1 ring-primary/10">
            <Globe2 className="size-7" />
          </div>
          <div className="mb-1 flex items-center justify-center gap-1.5">
            <Sparkles className="size-4 text-primary" />
            <h1 id="yomy-language-title" className="text-2xl font-semibold tracking-tight">{copy('chooseLanguageTitle')}</h1>
          </div>
          <p className="mx-auto max-w-sm text-sm leading-6 text-muted-foreground">{copy('chooseLanguageSubtitle')}</p>
        </div>

        <div className="grid gap-2 px-5 pb-5">
          {LANGUAGE_ORDER.map((code) => {
            const isSelected = selected === code
            const isRecommended = recommended === code
            return (
              <button
                key={code}
                type="button"
                onClick={() => selectLanguage(code)}
                className={[
                  'group flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all duration-200',
                  isSelected
                    ? 'border-primary/50 bg-primary/8 shadow-[0_8px_28px_rgba(0,0,0,.07)]'
                    : 'border-border/60 bg-background/45 hover:bg-muted/55'
                ].join(' ')}
                aria-pressed={isSelected}
              >
                <span className={[
                  'flex size-10 items-center justify-center rounded-xl text-sm font-semibold transition-colors',
                  isSelected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground group-hover:text-foreground'
                ].join(' ')}>
                  {code.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{LANGUAGE_LABELS[code]}</span>
                  {isRecommended && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">{copy('languageRecommended')}</span>
                  )}
                </span>
                {isSelected && (
                  <span className="flex size-7 items-center justify-center rounded-full bg-primary/12 text-primary">
                    <Check className="size-4" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="border-t border-border/60 bg-muted/20 p-5">
          <Button type="button" className="h-12 w-full rounded-2xl text-[15px] font-semibold" onClick={finish}>
            {copy('languageContinue')}
          </Button>
          {activeLanguage !== selected && (
            <p className="mt-2 text-center text-[10px] text-muted-foreground">Previewing {LANGUAGE_LABELS[selected]}</p>
          )}
        </div>
      </div>
    </div>
  )
}
