import { supabase } from '@/lib/supabase'

export async function savePendingPhoneDraft(userId: string, phoneE164: string) {
  const phone = phoneE164.trim()
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('INVALID_PHONE_NUMBER')
  const { error } = await supabase.from('user_phone_drafts').upsert({
    user_id: userId,
    phone_e164: phone,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' })
  if (error) throw error
}

export async function readPendingPhoneDraft(userId: string) {
  const { data, error } = await supabase.from('user_phone_drafts').select('phone_e164').eq('user_id', userId).maybeSingle()
  if (error) throw error
  return data?.phone_e164 || ''
}

export async function clearPendingPhoneDraft(userId: string) {
  const { error } = await supabase.from('user_phone_drafts').delete().eq('user_id', userId)
  if (error) throw error
}
