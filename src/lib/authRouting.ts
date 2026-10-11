import { supabase } from '@/lib/supabase'

export async function getPostAuthRoute(knownUserId?: string) {
  // Account switching already knows the selected user ID. Avoid a race where
  // getUser() runs before Supabase finishes hydrating the just-restored session.
  let userId = knownUserId
  if (!userId) {
    const { data: { session } } = await supabase.auth.getSession()
    userId = session?.user.id
  }
  if (!userId) return '/login'

  const { data, error } = await supabase
    .from('user_onboarding')
    .select('completed')
    .eq('user_id', userId)
    .maybeSingle()

  // Fail open for established accounts if the onboarding row cannot be read.
  // New accounts are created with a row by the auth trigger.
  if (error || !data) return '/'
  return data.completed ? '/' : '/onboarding'
}
