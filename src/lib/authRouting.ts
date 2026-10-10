import { supabase } from '@/lib/supabase'

export async function getPostAuthRoute() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return '/login'

  const { data, error } = await supabase
    .from('user_onboarding')
    .select('completed')
    .eq('user_id', user.id)
    .maybeSingle()

  // Fail open for established accounts if the onboarding row cannot be read.
  // New accounts are created with a row by the auth trigger.
  if (error || !data) return '/'
  return data.completed ? '/' : '/onboarding'
}
