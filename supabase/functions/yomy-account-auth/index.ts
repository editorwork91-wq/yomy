import { createClient } from 'npm:@supabase/supabase-js@2'

const mainUrl=Deno.env.get('SUPABASE_URL')!
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})
const admin=createClient(mainUrl,serviceKey,{auth:{autoRefreshToken:false,persistSession:false}})

function normalizePhone(value:string){
  const digits = value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
  const phone = digits
    .replace(/[\s().-]/g, '')
    .replace(/[^+\d]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : ''
}
function requireTwilio(){
  const sid=Deno.env.get('TWILIO_ACCOUNT_SID')||''
  const token=Deno.env.get('TWILIO_AUTH_TOKEN')||''
  const verify=Deno.env.get('TWILIO_VERIFY_SERVICE_SID')||''
  const from=Deno.env.get('TWILIO_FROM_NUMBER')||''
  if(!sid||!token||!verify)return null
  return {sid,token,verify,from}
}
async function twilioRequest(url:string,params:Record<string,string>){
  const cfg=requireTwilio()
  if(!cfg)throw new Error('SMS_PROVIDER_NOT_CONFIGURED')
  const auth=btoa(cfg.sid+':'+cfg.token)
  const response=await fetch(url,{method:'POST',headers:{'Authorization':'Basic '+auth,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params)})
  const body=await response.text()
  if(!response.ok){
    let detail = body.slice(0,220)
    try {
      const parsed = JSON.parse(body) as Record<string,unknown>
      const code = parsed.code ?? parsed.error_code
      const message = parsed.message ?? parsed.error_message
      if(code || message) detail = `${code ? String(code)+':' : ''}${message ? String(message) : ''}`.slice(0,220)
    } catch {}
    throw new Error('SMS_PROVIDER_ERROR:' + detail)
  }
  return JSON.parse(body)
}
async function sendVerify(phone:string){
  const cfg=requireTwilio()
  if(!cfg)throw new Error('SMS_PROVIDER_NOT_CONFIGURED')
  return twilioRequest('https://verify.twilio.com/v2/Services/'+encodeURIComponent(cfg.verify)+'/Verifications',{To:phone,Channel:'sms'})
}
async function checkVerify(phone:string,code:string){
  const cfg=requireTwilio()
  if(!cfg)throw new Error('SMS_PROVIDER_NOT_CONFIGURED')
  return twilioRequest('https://verify.twilio.com/v2/Services/'+encodeURIComponent(cfg.verify)+'/VerificationCheck',{To:phone,Code:code})
}
async function sendRecoverySms(phone:string,body:string){
  const cfg=requireTwilio()
  if(!cfg?.from)throw new Error('SMS_PROVIDER_FROM_NOT_CONFIGURED')
  return twilioRequest('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(cfg.sid)+'/Messages.json',{To:phone,From:cfg.from,Body:body})
}
function maskEmail(email:string|null|undefined){
  if(!email)return 'hidden'
  const [name,domain]=email.split('@')
  if(!domain)return 'hidden'
  return (name.length<=2?name[0]+'*':name.slice(0,2)+'***')+'@'+domain
}
async function saveNonce(phone:string,purpose:'signup'|'recovery'){
  const nonce=crypto.randomUUID()+crypto.randomUUID().replaceAll('-','')
  const {error}=await admin.from('phone_verification_nonces').insert({
    phone_e164:phone,nonce,purpose,expires_at:new Date(Date.now()+10*60*1000).toISOString()
  })
  if(error)throw error
  return nonce
}
async function consumeNonce(phone:string,purpose:'signup'|'recovery',nonce:string){
  const {data,error}=await admin.from('phone_verification_nonces')
    .select('id,phone_e164,purpose,expires_at,consumed_at')
    .eq('phone_e164',phone).eq('purpose',purpose).eq('nonce',nonce).is('consumed_at',null).gt('expires_at',new Date().toISOString()).maybeSingle()
  if(error||!data)throw new Error('PHONE_VERIFICATION_EXPIRED')
  return data
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  if(req.method!=='POST')return json(405,{error:'Method not allowed'})
  const body=await req.json().catch(()=>({}))
  const action=typeof body?.action==='string'?body.action:''
  const phone=typeof body?.phone==='string'?normalizePhone(body.phone):''

  try{
    if(!['send_signup_otp','verify_signup_otp','create_account','send_recovery_otp','verify_recovery_otp','send_recovery_link'].includes(action)){
      return json(400,{error:'Invalid action'})
    }
    if(!phone)return json(400,{error:'Use an E.164 phone number, for example +2010...'} )

    if(action==='send_signup_otp'){
      const {count}=await admin.from('account_phone_links').select('user_id',{count:'exact',head:true}).eq('phone_e164',phone)
      if((count||0)>=2)return json(409,{error:'PHONE_ACCOUNT_LIMIT_REACHED'})
      const {data:last}=await admin.from('phone_verification_nonces').select('created_at').eq('phone_e164',phone).eq('purpose','signup').order('created_at',{ascending:false}).limit(1).maybeSingle()
      if(last&&Date.now()-new Date(last.created_at).getTime()<45000)return json(429,{error:'OTP_COOLDOWN'})
      const result=await sendVerify(phone)
      return json(200,{ok:true,status:result?.status||'pending'})
    }

    if(action==='verify_signup_otp'){
      const code=typeof body?.code==='string'?body.code.trim():''
      if(!/^\d{4,10}$/.test(code))return json(400,{error:'Invalid verification code'})
      const result=await checkVerify(phone,code)
      if(result?.status!=='approved')return json(400,{error:'OTP_NOT_APPROVED'})
      const nonce=await saveNonce(phone,'signup')
      return json(200,{ok:true,verified:true,nonce})
    }

    if(action==='create_account'){
      const nonce=typeof body?.nonce==='string'?body.nonce:''
      const email=typeof body?.email==='string'?body.email.trim().toLowerCase():''
      const password=typeof body?.password==='string'?body.password:''
      const username=typeof body?.username==='string'?body.username.trim().toLowerCase():''
      const fullName=typeof body?.full_name==='string'?body.full_name.trim().slice(0,120):''
      await consumeNonce(phone,'signup',nonce)
      if(!/^\S+@\S+\.\S+$/.test(email))return json(400,{error:'Invalid email'})
      if(password.length<6)return json(400,{error:'Password must be at least 6 characters'})
      if(!/^[a-z0-9_.]{3,30}$/.test(username))return json(400,{error:'Invalid username'})
      const {data:existing}=await admin.from('profiles').select('id').eq('username',username).maybeSingle()
      if(existing)return json(409,{error:'USERNAME_TAKEN'})
      const {count}=await admin.from('account_phone_links').select('user_id',{count:'exact',head:true}).eq('phone_e164',phone)
      if((count||0)>=2)return json(409,{error:'PHONE_ACCOUNT_LIMIT_REACHED'})

      const {data:userData,error}=await admin.auth.admin.createUser({
        email,password,email_confirm:true,user_metadata:{username,full_name}
      })
      if(error||!userData.user)throw error||new Error('ACCOUNT_CREATE_FAILED')

      try{
        await admin.rpc('claim_verified_phone',{p_user_id:userData.user.id,p_phone_e164:phone,p_nonce:nonce})
      }catch(error){
        await admin.auth.admin.deleteUser(userData.user.id)
        throw error
      }
      return json(200,{ok:true,user_id:userData.user.id})
    }

    if(action==='send_recovery_otp'){
      const {count}=await admin.from('account_phone_links').select('user_id',{count:'exact',head:true}).eq('phone_e164',phone)
      if(!count)return json(404,{error:'NO_ACCOUNTS_FOR_PHONE'})
      const {data:last}=await admin.from('phone_verification_nonces').select('created_at').eq('phone_e164',phone).eq('purpose','recovery').order('created_at',{ascending:false}).limit(1).maybeSingle()
      if(last&&Date.now()-new Date(last.created_at).getTime()<45000)return json(429,{error:'OTP_COOLDOWN'})
      await sendVerify(phone)
      return json(200,{ok:true})
    }

    if(action==='verify_recovery_otp'){
      const code=typeof body?.code==='string'?body.code.trim():''
      if(!/^\d{4,10}$/.test(code))return json(400,{error:'Invalid verification code'})
      const result=await checkVerify(phone,code)
      if(result?.status!=='approved')return json(400,{error:'OTP_NOT_APPROVED'})
      const nonce=await saveNonce(phone,'recovery')
      const {data:links,error}=await admin.from('account_phone_links').select('user_id').eq('phone_e164',phone).order('created_at',{ascending:true})
      if(error)throw error
      const accounts=[]
      for(const link of links||[]){
        const {data:u}=await admin.auth.admin.getUserById(link.user_id)
        const {data:p}=await admin.from('profiles').select('username,avatar_url').eq('id',link.user_id).maybeSingle()
        accounts.push({id:link.user_id,username:p?.username||'account',avatar_url:p?.avatar_url||'',email:maskEmail(u.user?.email)})
      }
      return json(200,{ok:true,verified:true,nonce,accounts})
    }

    if(action==='send_recovery_link'){
      const nonce=typeof body?.nonce==='string'?body.nonce:''
      const userId=typeof body?.user_id==='string'?body.user_id:''
      const verified=await consumeNonce(phone,'recovery',nonce)
      const {data:link}=await admin.from('account_phone_links').select('user_id').eq('phone_e164',phone).eq('user_id',userId).maybeSingle()
      if(!link)return json(404,{error:'ACCOUNT_NOT_FOUND'})
      const {data:u,error:ue}=await admin.auth.admin.getUserById(userId)
      if(ue||!u.user?.email)return json(404,{error:'ACCOUNT_EMAIL_NOT_FOUND'})
      const {data:generated,error:ge}=await admin.auth.admin.generateLink({type:'recovery',email:u.user.email})
      if(ge||!generated?.properties?.action_link)throw ge||new Error('RECOVERY_LINK_FAILED')
      const short='YOMY password reset: '+generated.properties.action_link
      await sendRecoverySms(phone,short)
      await admin.from('phone_verification_nonces').update({consumed_at:new Date().toISOString()}).eq('id',verified.id)
      return json(200,{ok:true})
    }

    return json(400,{error:'Unsupported action'})
  }catch(error){
    const message=error instanceof Error?error.message:'ACCOUNT_AUTH_FAILED'
    const status=message.includes('PHONE_ACCOUNT_LIMIT')?409:message==='SMS_PROVIDER_NOT_CONFIGURED'||message==='SMS_PROVIDER_FROM_NOT_CONFIGURED'?503:500
    console.error('Yomy account auth error:',message)
    return json(status,{error:message})
  }
})