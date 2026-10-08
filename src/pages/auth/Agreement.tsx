import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ChevronDown, CheckCircle2, ShieldCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"

const LEGAL_VERSION = "2026-10-08"

export default function Agreement() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [accepted, setAccepted] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [loading, setLoading] = useState(false)

  const copy = useMemo(() => {
    const arabic = localStorage.getItem("yomy-language") === "ar"
    return arabic
      ? {
          title: "مرحبًا بك في YOMY",
          intro: "قبل أن تبدأ، نحتاج موافقتك على القواعد التي تحمي حسابك وتجعل التجربة آمنة ومحترمة.",
          terms: "الشروط والاستخدام",
          privacy: "الخصوصية وحماية البيانات",
          community: "معايير المجتمع",
          readMore: "Read more",
          readLess: "عرض أقل",
          checkbox: "قرأت وفهمت وأوافق على الشروط وسياسة الخصوصية ومعايير المجتمع.",
          continue: "متابعة إلى YOMY",
          saving: "جارٍ الحفظ…",
          note: "يمكنك مراجعة إعدادات الخصوصية لاحقًا من داخل YOMY.",
          details: [
            "تستخدم YOMY بيانات الحساب اللازمة لتشغيل الخدمة وتحسين الأمان، ولا تحتاج إلى رقم هاتف لإنشاء الحساب.",
            "يجب أن تكون المعلومات التي تضيفها دقيقة وغير مضللة، وألا تستخدم الخدمة لانتحال شخصية الآخرين أو الإضرار بهم.",
            "يُمنع المحتوى غير القانوني أو التهديد أو التحرش أو انتهاك خصوصية الآخرين. يمكن اتخاذ إجراءات حماية عند إساءة الاستخدام.",
            "يمكنك التحكم في إعدادات الخصوصية والإشعارات والظهور من إعدادات الحساب، وتظل كلمات المرور ومفاتيح الخدمة خارج التطبيق ولا تُطلب منك.",
          ],
        }
      : {
          title: "Welcome to YOMY",
          intro: "Before you start, please review the rules that protect your account and keep YOMY safe and respectful.",
          terms: "Terms of Use",
          privacy: "Privacy & Data Protection",
          community: "Community Standards",
          readMore: "Read more",
          readLess: "Show less",
          checkbox: "I have read, understood, and agree to the Terms, Privacy Policy, and Community Standards.",
          continue: "Continue to YOMY",
          saving: "Saving…",
          note: "You can review privacy controls later from YOMY Settings.",
          details: [
            "YOMY uses the account information required to operate the service and protect security. A phone number is not required to create an account.",
            "You must provide accurate information and must not impersonate another person or use YOMY to harm others.",
            "Illegal content, threats, harassment, and privacy violations are not allowed. Protective actions may be taken when the service is misused.",
            "You control privacy, notification, and visibility settings from your account. Passwords and service keys should never be requested inside the app.",
          ],
        }
  }, [])

  useEffect(() => {
    if (!user) navigate("/login", { replace: true })
  }, [navigate, user])

  const acceptAgreement = async () => {
    if (!user || !accepted) return
    setLoading(true)
    try {
      const { error } = await supabase.from("user_onboarding").upsert({
        user_id: user.id,
        step: "complete",
        completed: true,
        legal_terms_accepted: true,
        legal_privacy_accepted: true,
        legal_community_accepted: true,
        legal_version: LEGAL_VERSION,
        legal_accepted_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" })

      if (error) throw error
      toast.success("Welcome to YOMY")
      navigate("/", { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't save your agreement.")
    } finally {
      setLoading(false)
    }
  }

  if (!user) return null

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4 sm:p-6">
      <section className="w-full max-w-2xl space-y-5" dir={localStorage.getItem("yomy-language") === "ar" ? "rtl" : "ltr"}>
        <header className="text-center space-y-3">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
            <ShieldCheck className="size-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{copy.title}</h1>
          <p className="mx-auto max-w-xl text-sm leading-6 text-muted-foreground">{copy.intro}</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {[copy.terms, copy.privacy, copy.community].map((item) => (
            <div key={item} className="rounded-2xl border bg-card/80 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4" />
                <span>{item}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border bg-card shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 p-4 text-left"
            onClick={() => setShowMore(value => !value)}
            aria-expanded={showMore}
          >
            <span className="font-medium">{showMore ? copy.readLess : copy.readMore}</span>
            <ChevronDown className={showMore ? "size-5 rotate-180 transition-transform" : "size-5 transition-transform"} />
          </button>
          {showMore && (
            <div className="space-y-3 border-t px-4 pb-5 pt-4 text-sm leading-6 text-muted-foreground">
              {copy.details.map(detail => <p key={detail}>{detail}</p>)}
            </div>
          )}
        </div>

        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} />
            <span className="text-sm leading-6">{copy.checkbox}</span>
          </label>
        </div>

        <p className="text-center text-xs text-muted-foreground">{copy.note}</p>

        <Button
          type="button"
          className="w-full rounded-xl"
          disabled={!accepted || loading}
          onClick={() => void acceptAgreement()}
        >
          {loading ? copy.saving : copy.continue}
        </Button>
      </section>
    </main>
  )
}
