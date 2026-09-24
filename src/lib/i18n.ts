export type YomyLanguage = 'en' | 'ar' | 'de' | 'fr' | 'es'

export const LANGUAGE_LABELS: Record<YomyLanguage, string> = {
  en: 'English',
  ar: 'العربية',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
}

export function applyYomyLanguage(language: YomyLanguage) {
  const root = document.documentElement
  root.lang = language
  root.dir = language === 'ar' ? 'rtl' : 'ltr'
  localStorage.setItem('yomy-language', language)
}

export function applyYomyFontScale(scale: number) {
  const safe = Math.max(0.85, Math.min(1.25, Number(scale) || 1))
  document.documentElement.style.setProperty('--yomy-font-scale', String(safe))
  localStorage.setItem('yomy-font-scale', String(safe))
}

export function systemTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export const translations = {
  en: {
    settings: 'Settings', privacy: 'Privacy', appearance: 'Appearance', language: 'Language',
    darkMode: 'Dark mode', fontSize: 'Font size', sleepMode: 'Sleep mode',
    sleepDescription: 'Pause new messages, calls and activity visibility during your sleep window.',
    sleepWindow: 'Sleep window', blocked: 'Blocked accounts', account: 'Account',
    privacyAccount: 'Private account', readReceipts: 'Read receipts',
    whoCanMessage: 'Who can message you', followingVisibility: 'Following visibility',
    editProfile: 'Edit profile', notifications: 'Notifications', messages: 'Messages', logout: 'Log out',
    save: 'Save', saved: 'Saved', profileSettings: 'Profile settings', small: 'Small', medium: 'Medium', large: 'Large',
  },
  ar: {
    settings: 'الإعدادات', privacy: 'الخصوصية', appearance: 'المظهر', language: 'اللغة',
    darkMode: 'الوضع الداكن', fontSize: 'حجم الخط', sleepMode: 'نظام النوم',
    sleepDescription: 'إيقاف الرسائل والمكالمات وظهور النشاط أثناء فترة النوم.',
    sleepWindow: 'فترة النوم', blocked: 'الحسابات المحظورة', account: 'الحساب',
    privacyAccount: 'حساب خاص', readReceipts: 'إيصالات القراءة',
    whoCanMessage: 'من يمكنه مراسلتك', followingVisibility: 'ظهور قائمة المتابَعين',
    editProfile: 'تعديل الملف', notifications: 'الإشعارات', messages: 'الرسائل', logout: 'تسجيل الخروج',
    save: 'حفظ', saved: 'المحفوظات', profileSettings: 'إعدادات الملف', small: 'صغير', medium: 'متوسط', large: 'كبير',
  },
  de: {
    settings: 'Einstellungen', privacy: 'Datenschutz', appearance: 'Darstellung', language: 'Sprache',
    darkMode: 'Dunkelmodus', fontSize: 'Schriftgröße', sleepMode: 'Schlafmodus',
    sleepDescription: 'Neue Nachrichten, Anrufe und Aktivität während der Schlafzeit pausieren.',
    sleepWindow: 'Schlafzeit', blocked: 'Blockierte Konten', account: 'Konto',
    privacyAccount: 'Privates Konto', readReceipts: 'Lesebestätigungen',
    whoCanMessage: 'Wer dir schreiben darf', followingVisibility: 'Sichtbarkeit der Abos',
    editProfile: 'Profil bearbeiten', notifications: 'Benachrichtigungen', messages: 'Nachrichten', logout: 'Abmelden',
    save: 'Speichern', saved: 'Gespeichert', profileSettings: 'Profileinstellungen', small: 'Klein', medium: 'Mittel', large: 'Groß',
  },
  fr: {
    settings: 'Réglages', privacy: 'Confidentialité', appearance: 'Apparence', language: 'Langue',
    darkMode: 'Mode sombre', fontSize: 'Taille du texte', sleepMode: 'Mode sommeil',
    sleepDescription: 'Mettre en pause les nouveaux messages, appels et activité pendant le sommeil.',
    sleepWindow: 'Plage de sommeil', blocked: 'Comptes bloqués', account: 'Compte',
    privacyAccount: 'Compte privé', readReceipts: 'Accusés de lecture',
    whoCanMessage: 'Qui peut vous écrire', followingVisibility: 'Visibilité des abonnements',
    editProfile: 'Modifier le profil', notifications: 'Notifications', messages: 'Messages', logout: 'Se déconnecter',
    save: 'Enregistrer', saved: 'Enregistré', profileSettings: 'Réglages du profil', small: 'Petit', medium: 'Moyen', large: 'Grand',
  },
  es: {
    settings: 'Ajustes', privacy: 'Privacidad', appearance: 'Apariencia', language: 'Idioma',
    darkMode: 'Modo oscuro', fontSize: 'Tamaño de texto', sleepMode: 'Modo sueño',
    sleepDescription: 'Pausar mensajes, llamadas y actividad durante el horario de sueño.',
    sleepWindow: 'Horario de sueño', blocked: 'Cuentas bloqueadas', account: 'Cuenta',
    privacyAccount: 'Cuenta privada', readReceipts: 'Confirmaciones de lectura',
    whoCanMessage: 'Quién puede escribirte', followingVisibility: 'Visibilidad de seguidos',
    editProfile: 'Editar perfil', notifications: 'Notificaciones', messages: 'Mensajes', logout: 'Cerrar sesión',
    save: 'Guardar', saved: 'Guardado', profileSettings: 'Ajustes del perfil', small: 'Pequeño', medium: 'Medio', large: 'Grande',
  },
} as const

export function t(language: YomyLanguage, key: keyof typeof translations.en) {
  return translations[language][key] || translations.en[key]
}
