import { useCallback, useEffect, useState } from 'react'

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
  window.dispatchEvent(new CustomEvent('yomy-language-changed'))
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
    chooseLanguageTitle: 'Choose your language',
    chooseLanguageSubtitle: 'Yomy will use this language for buttons, menus, search, settings and the rest of the interface.',
    languageContinue: 'Continue',
    languageRecommended: 'Recommended',
    home: 'Home', explore: 'Explore', create: 'Create', activity: 'Activity', profile: 'Profile',
    search: 'Search', searchPeople: 'Search people…', offlineMode: 'Offline mode',
    notes: 'Notes', archived: 'Archived', backToChats: 'Back to chats',
    noArchivedChats: 'No archived chats', chatsArchiveHint: 'Chats you archive appear here.',
    noConversations: 'No conversations yet', startChatHint: 'Search for a person above to start chatting.',
    feedEmpty: 'Your feed is empty', followPeopleHint: 'Follow people to see their posts here.',
    caughtUp: 'You\'re all caught up!',
    email: 'Email', password: 'Password', fullName: 'Full Name', username: 'Username',
    phoneNumber: 'Phone number', optional: 'Optional', noPhoneNote: 'You can create a Yomy account without adding a phone number.',
    login: 'Log in', signingIn: 'Signing in…', signup: 'Sign up', createAccount: 'Create account',
    creatingAccount: 'Creating account…', connectShareDiscover: 'Connect, share, and discover.',
    haveAccount: 'Have an account?', dontHaveAccount: 'Don\'t have an account?',
    agreeTo: 'I agree to Yomy\'s', terms: 'Terms of Service', privacyPolicy: 'Privacy Policy',
    communityGuidelines: 'Community Guidelines', legalConsentNotice: 'You must accept the Terms of Service and Privacy Policy to create a Yomy account.',
    consentRecorded: 'Your acceptance is recorded with the current legal document version.',
    back: 'Back', phoneVerify: 'Verify phone', phoneVerified: 'Phone verified', sendCode: 'Send code', verifyCode: 'Verify code', codeSent: 'A verification code was sent by SMS.', verificationCode: 'Verification code', resendCode: 'Resend code', resendIn: 'Resend in', seconds: 's', changeNumber: 'Change number', phoneOptionalVerified: 'Optional — verified by SMS only when you choose to add a number.', phoneVerificationUnavailable: 'Phone verification is temporarily unavailable. You can continue without a phone number.', exploreAccounts: 'Explore', users: 'Users', posts: 'Posts', discover: 'Discover', suggested: 'Suggested', noResults: 'No results found', noPostsExplore: 'No posts to explore', checkBack: 'Check back later for more content.', noSuggestions: 'No suggestions yet', followMore: 'Follow more people to get better suggestions.', suggestedForYou: 'Suggested for you', following: 'Following', requested: 'Requested', follow: 'Follow', you: 'You', messageDeleted: 'Message deleted', poll: 'Poll', photo: 'Photo', voiceMessage: 'Voice message', video: 'Video', file: 'File', previewing: 'Previewing',
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
    chooseLanguageTitle: 'اختر لغتك',
    chooseLanguageSubtitle: 'سيستخدم YOMY هذه اللغة للأزرار والقوائم والبحث والإعدادات وباقي واجهة التطبيق.',
    languageContinue: 'متابعة',
    languageRecommended: 'مقترحة',
    home: 'الرئيسية', explore: 'استكشاف', create: 'إنشاء', activity: 'النشاط', profile: 'الملف',
    search: 'بحث', searchPeople: 'ابحث عن أشخاص…', offlineMode: 'وضع عدم الاتصال',
    notes: 'الملاحظات', archived: 'المؤرشفة', backToChats: 'العودة إلى المحادثات',
    noArchivedChats: 'لا توجد محادثات مؤرشفة', chatsArchiveHint: 'ستظهر المحادثات التي تقوم بأرشفتها هنا.',
    noConversations: 'لا توجد محادثات بعد', startChatHint: 'ابحث عن شخص في الأعلى لبدء محادثة.',
    feedEmpty: 'الخلاصة فارغة', followPeopleHint: 'تابع الأشخاص لترى منشوراتهم هنا.',
    caughtUp: 'لقد وصلت إلى أحدث المنشورات!',
    email: 'البريد الإلكتروني', password: 'كلمة المرور', fullName: 'الاسم الكامل', username: 'اسم المستخدم',
    phoneNumber: 'رقم الهاتف', optional: 'اختياري', noPhoneNote: 'يمكنك إنشاء حساب YOMY دون إضافة رقم هاتف.',
    login: 'تسجيل الدخول', signingIn: 'جارٍ تسجيل الدخول…', signup: 'إنشاء حساب', createAccount: 'إنشاء الحساب',
    creatingAccount: 'جارٍ إنشاء الحساب…', connectShareDiscover: 'تواصل وشارك واكتشف.',
    haveAccount: 'لديك حساب بالفعل؟', dontHaveAccount: 'ليس لديك حساب؟',
    agreeTo: 'أوافق على', terms: 'شروط الخدمة', privacyPolicy: 'سياسة الخصوصية',
    communityGuidelines: 'إرشادات المجتمع', legalConsentNotice: 'يجب الموافقة على شروط الخدمة وسياسة الخصوصية لإنشاء حساب YOMY.',
    consentRecorded: 'يتم حفظ موافقتك مع إصدار المستندات القانونية الحالي.',
    back: 'رجوع', phoneVerify: 'تحقق من الرقم', phoneVerified: 'تم التحقق من الرقم', sendCode: 'إرسال الكود', verifyCode: 'تأكيد الكود', codeSent: 'تم إرسال كود التحقق عبر SMS.', verificationCode: 'كود التحقق', resendCode: 'إعادة إرسال الكود', resendIn: 'إعادة الإرسال خلال', seconds: 'ث', changeNumber: 'تغيير الرقم', phoneOptionalVerified: 'اختياري — يتم التحقق منه عبر SMS فقط عندما تختار إضافة رقم.', phoneVerificationUnavailable: 'التحقق من الرقم غير متاح مؤقتًا. يمكنك المتابعة بدون رقم هاتف.', exploreAccounts: 'استكشاف', users: 'Usuarios', posts: 'Publicaciones', discover: 'Descubrir', suggested: 'Sugerencias', noResults: 'No se encontraron resultados', noPostsExplore: 'No hay publicaciones para explorar', checkBack: 'Vuelve más tarde para ver más contenido.', noSuggestions: 'Aún no hay sugerencias', followMore: 'Sigue a más personas para obtener mejores sugerencias.', suggestedForYou: 'Sugerencias para ti', following: 'Siguiendo', requested: 'Solicitado', follow: 'Seguir', users: 'Utilisateurs', posts: 'Publications', discover: 'Découvrir', suggested: 'Suggestions', noResults: 'Aucun résultat', noPostsExplore: 'Aucune publication à explorer', checkBack: 'Revenez plus tard pour découvrir du contenu.', noSuggestions: 'Aucune suggestion pour le moment', followMore: 'Suivez plus de personnes pour de meilleures suggestions.', suggestedForYou: 'Suggestions pour vous', following: 'Suivi', requested: 'Demandé', follow: 'Suivre', users: 'Benutzer', posts: 'Beiträge', discover: 'Entdecken', suggested: 'Vorgeschlagen', noResults: 'Keine Ergebnisse gefunden', noPostsExplore: 'Keine Beiträge zum Entdecken', checkBack: 'Schau später nach neuen Inhalten.', noSuggestions: 'Noch keine Vorschläge', followMore: 'Folge mehr Personen für bessere Vorschläge.', suggestedForYou: 'Für dich vorgeschlagen', following: 'Abonniert', requested: 'Angefragt', follow: 'Folgen', users: 'المستخدمون', posts: 'المنشورات', discover: 'اكتشاف', suggested: 'مقترحون', noResults: 'لا توجد نتائج', noPostsExplore: 'لا توجد منشورات للاستكشاف', checkBack: 'تحقق لاحقًا لمشاهدة المزيد من المحتوى.', noSuggestions: 'لا توجد اقتراحات بعد', followMore: 'تابع المزيد من الأشخاص للحصول على اقتراحات أفضل.', suggestedForYou: 'مقترح لك', following: 'تتابع', requested: 'تم إرسال الطلب', follow: 'متابعة', you: 'أنت', messageDeleted: 'تم حذف الرسالة', poll: 'استطلاع', photo: 'صورة', voiceMessage: 'رسالة صوتية', video: 'فيديو', file: 'ملف', previewing: 'معاينة',
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
    chooseLanguageTitle: 'Sprache wählen',
    chooseLanguageSubtitle: 'Yomy verwendet diese Sprache für Schaltflächen, Menüs, Suche, Einstellungen und die gesamte Oberfläche.',
    languageContinue: 'Weiter',
    languageRecommended: 'Empfohlen',
    home: 'Start', explore: 'Entdecken', create: 'Erstellen', activity: 'Aktivität', profile: 'Profil',
    search: 'Suchen', searchPeople: 'Personen suchen…', offlineMode: 'Offline-Modus',
    notes: 'Notizen', archived: 'Archiviert', backToChats: 'Zurück zu Chats',
    noArchivedChats: 'Keine archivierten Chats', chatsArchiveHint: 'Archivierte Chats erscheinen hier.',
    noConversations: 'Noch keine Unterhaltungen', startChatHint: 'Suche oben nach einer Person, um zu chatten.',
    feedEmpty: 'Dein Feed ist leer', followPeopleHint: 'Folge Personen, um ihre Beiträge hier zu sehen.',
    caughtUp: 'Du bist auf dem neuesten Stand!',
    email: 'E-Mail', password: 'Passwort', fullName: 'Vollständiger Name', username: 'Benutzername',
    phoneNumber: 'Telefonnummer', optional: 'Optional', noPhoneNote: 'Du kannst ein Yomy-Konto ohne Telefonnummer erstellen.',
    login: 'Anmelden', signingIn: 'Anmeldung…', signup: 'Registrieren', createAccount: 'Konto erstellen',
    creatingAccount: 'Konto wird erstellt…', connectShareDiscover: 'Verbinden, teilen und entdecken.',
    haveAccount: 'Du hast bereits ein Konto?', dontHaveAccount: 'Noch kein Konto?',
    agreeTo: 'Ich stimme den', terms: 'Nutzungsbedingungen', privacyPolicy: 'Datenschutzrichtlinie',
    communityGuidelines: 'Community-Richtlinien', legalConsentNotice: 'Du musst den Nutzungsbedingungen und der Datenschutzrichtlinie zustimmen, um ein Yomy-Konto zu erstellen.',
    consentRecorded: 'Deine Zustimmung wird mit der aktuellen Dokumentversion gespeichert.',
    back: 'Zurück', phoneVerify: 'Telefon verifizieren', phoneVerified: 'Telefon verifiziert', sendCode: 'Code senden', verifyCode: 'Code prüfen', codeSent: 'Ein Bestätigungscode wurde per SMS gesendet.', verificationCode: 'Bestätigungscode', resendCode: 'Code erneut senden', resendIn: 'Erneut senden in', seconds: 's', changeNumber: 'Nummer ändern', phoneOptionalVerified: 'Optional – wird nur per SMS verifiziert, wenn du eine Nummer hinzufügst.', phoneVerificationUnavailable: 'Die Telefonverifizierung ist vorübergehend nicht verfügbar. Du kannst ohne Telefonnummer fortfahren.', exploreAccounts: 'Entdecken', you: 'Du', messageDeleted: 'Nachricht gelöscht', poll: 'Umfrage', photo: 'Foto', voiceMessage: 'Sprachnachricht', video: 'Video', file: 'Datei', previewing: 'Vorschau',
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
    chooseLanguageTitle: 'Choisissez votre langue',
    chooseLanguageSubtitle: 'Yomy utilisera cette langue pour les boutons, menus, recherche, réglages et toute l’interface.',
    languageContinue: 'Continuer',
    languageRecommended: 'Recommandé',
    home: 'Accueil', explore: 'Explorer', create: 'Créer', activity: 'Activité', profile: 'Profil',
    search: 'Rechercher', searchPeople: 'Rechercher des personnes…', offlineMode: 'Mode hors connexion',
    notes: 'Notes', archived: 'Archivées', backToChats: 'Retour aux discussions',
    noArchivedChats: 'Aucune discussion archivée', chatsArchiveHint: 'Les discussions que vous archivez apparaîtront ici.',
    noConversations: 'Aucune discussion pour le moment', startChatHint: 'Recherchez une personne ci-dessus pour commencer.',
    feedEmpty: 'Votre fil est vide', followPeopleHint: 'Suivez des personnes pour voir leurs publications ici.',
    caughtUp: 'Vous êtes à jour !',
    email: 'E-mail', password: 'Mot de passe', fullName: 'Nom complet', username: 'Nom d’utilisateur',
    phoneNumber: 'Numéro de téléphone', optional: 'Facultatif', noPhoneNote: 'Vous pouvez créer un compte Yomy sans ajouter de numéro de téléphone.',
    login: 'Se connecter', signingIn: 'Connexion…', signup: 'S’inscrire', createAccount: 'Créer le compte',
    creatingAccount: 'Création du compte…', connectShareDiscover: 'Connectez-vous, partagez et découvrez.',
    haveAccount: 'Vous avez déjà un compte ?', dontHaveAccount: 'Vous n’avez pas de compte ?',
    agreeTo: 'J’accepte les', terms: 'Conditions d’utilisation', privacyPolicy: 'Politique de confidentialité',
    communityGuidelines: 'Règles de la communauté', legalConsentNotice: 'Vous devez accepter les Conditions d’utilisation et la Politique de confidentialité pour créer un compte Yomy.',
    consentRecorded: 'Votre consentement est enregistré avec la version actuelle des documents.',
    back: 'Retour', phoneVerify: 'Vérifier le numéro', phoneVerified: 'Numéro vérifié', sendCode: 'Envoyer le code', verifyCode: 'Vérifier le code', codeSent: 'Un code de vérification a été envoyé par SMS.', verificationCode: 'Code de vérification', resendCode: 'Renvoyer le code', resendIn: 'Renvoyer dans', seconds: 's', changeNumber: 'Modifier le numéro', phoneOptionalVerified: 'Facultatif — vérifié par SMS uniquement lorsque vous choisissez d’ajouter un numéro.', phoneVerificationUnavailable: 'La vérification du numéro est temporairement indisponible. Vous pouvez continuer sans numéro.', exploreAccounts: 'Explorer', you: 'Vous', messageDeleted: 'Message supprimé', poll: 'Sondage', photo: 'Photo', voiceMessage: 'Message vocal', video: 'Vidéo', file: 'Fichier', previewing: 'Aperçu',
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
    chooseLanguageTitle: 'Elige tu idioma',
    chooseLanguageSubtitle: 'Yomy usará este idioma para botones, menús, búsqueda, ajustes y toda la interfaz.',
    languageContinue: 'Continuar',
    languageRecommended: 'Recomendado',
    home: 'Inicio', explore: 'Explorar', create: 'Crear', activity: 'Actividad', profile: 'Perfil',
    search: 'Buscar', searchPeople: 'Buscar personas…', offlineMode: 'Modo sin conexión',
    notes: 'Notas', archived: 'Archivados', backToChats: 'Volver a los chats',
    noArchivedChats: 'No hay chats archivados', chatsArchiveHint: 'Los chats que archives aparecerán aquí.',
    noConversations: 'Aún no hay conversaciones', startChatHint: 'Busca una persona arriba para empezar a chatear.',
    feedEmpty: 'Tu feed está vacío', followPeopleHint: 'Sigue a personas para ver sus publicaciones aquí.',
    caughtUp: '¡Ya estás al día!',
    email: 'Correo electrónico', password: 'Contraseña', fullName: 'Nombre completo', username: 'Nombre de usuario',
    phoneNumber: 'Número de teléfono', optional: 'Opcional', noPhoneNote: 'Puedes crear una cuenta de Yomy sin añadir un número de teléfono.',
    login: 'Iniciar sesión', signingIn: 'Iniciando sesión…', signup: 'Registrarse', createAccount: 'Crear cuenta',
    creatingAccount: 'Creando cuenta…', connectShareDiscover: 'Conecta, comparte y descubre.',
    haveAccount: '¿Ya tienes una cuenta?', dontHaveAccount: '¿No tienes una cuenta?',
    agreeTo: 'Acepto los', terms: 'Términos del servicio', privacyPolicy: 'Política de privacidad',
    communityGuidelines: 'Normas de la comunidad', legalConsentNotice: 'Debes aceptar los Términos del servicio y la Política de privacidad para crear una cuenta de Yomy.',
    consentRecorded: 'Tu aceptación se registra con la versión actual de los documentos legales.',
    back: 'Atrás', phoneVerify: 'Verificar teléfono', phoneVerified: 'Teléfono verificado', sendCode: 'Enviar código', verifyCode: 'Verificar código', codeSent: 'Se envió un código de verificación por SMS.', verificationCode: 'Código de verificación', resendCode: 'Reenviar código', resendIn: 'Reenviar en', seconds: 's', changeNumber: 'Cambiar número', phoneOptionalVerified: 'Opcional: solo se verifica por SMS cuando eliges añadir un número.', phoneVerificationUnavailable: 'La verificación del teléfono no está disponible temporalmente. Puedes continuar sin número.', exploreAccounts: 'Explorar', you: 'Tú', messageDeleted: 'Mensaje eliminado', poll: 'Encuesta', photo: 'Foto', voiceMessage: 'Mensaje de voz', video: 'Vídeo', file: 'Archivo', previewing: 'Vista previa',
  },
} as const

export type YomyTranslationKey = keyof typeof translations.en

export function t(language: YomyLanguage, key: YomyTranslationKey) {
  return translations[language][key] || translations.en[key]
}

export function useYomyLanguage() {
  const getInitial = (): YomyLanguage => {
    const stored = localStorage.getItem('yomy-language') as YomyLanguage | null
    if (stored && LANGUAGE_LABELS[stored]) return stored
    const browser = (navigator.language || '').slice(0, 2).toLowerCase() as YomyLanguage
    return LANGUAGE_LABELS[browser] ? browser : 'en'
  }

  const [language, setLanguage] = useState<YomyLanguage>(getInitial)

  useEffect(() => {
    const sync = () => {
      const next = (document.documentElement.lang || 'en') as YomyLanguage
      if (LANGUAGE_LABELS[next]) setLanguage(next)
    }
    window.addEventListener('yomy-language-changed', sync)
    return () => window.removeEventListener('yomy-language-changed', sync)
  }, [])

  const copy = useCallback((key: YomyTranslationKey) => t(language, key), [language])
  return { language, copy }
}
