import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

export default function ResetPassword() {
  const navigate=useNavigate()
  const [password,setPassword]=useState('')
  const [ready,setReady]=useState(false)
  const [saving,setSaving]=useState(false)
  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(session && (event==='PASSWORD_RECOVERY'||event==='SIGNED_IN')) setReady(true)
    })
    supabase.auth.getSession().then(({data:{session}})=>{if(session)setReady(true)})
    return ()=>subscription.unsubscribe()
  },[])
  const save=async()=>{
    if(password.length<6)return toast.error('Password must be at least 6 characters')
    setSaving(true)
    try{
      const {error}=await supabase.auth.updateUser({password})
      if(error)throw error
      toast.success('Password updated')
      navigate('/login')
    }catch(e){toast.error(e instanceof Error?e.message:'Could not update password')}
    finally{setSaving(false)}
  }
  return <div className="min-h-screen bg-background flex items-center justify-center p-4"><div className="w-full max-w-sm space-y-4"><h1 className="text-2xl font-bold text-center">Choose a new YOMY password</h1>{!ready?<div className="flex justify-center py-8"><Spinner className="size-7"/></div>:<div className="space-y-3"><Input type="password" minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="New password"/><Button className="w-full rounded-xl" disabled={saving} onClick={()=>void save()}>{saving?<Spinner className="size-4 mr-2"/>:null}Update password</Button></div>}</div></div>
}
