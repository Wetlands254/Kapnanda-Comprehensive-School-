import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const env=(n:string)=>Deno.env.get(n)||"";
serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return json({error:"POST required"},405);
 try{
  const token=(req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"");if(!token)return json({error:"Sign-in required"},401);
  const url=env("SUPABASE_URL"),anon=env("SUPABASE_ANON_KEY"),service=env("SUPABASE_SERVICE_ROLE_KEY"),resend=env("RESEND_API_KEY"),from=env("PARENT_DOCUMENT_FROM_EMAIL");
  if(!url||!anon||!service||!resend||!from)return json({error:"Configure Supabase secrets, RESEND_API_KEY and PARENT_DOCUMENT_FROM_EMAIL"},500);
  const auth=await fetch(`${url}/auth/v1/user`,{headers:{apikey:anon,Authorization:`Bearer ${token}`}});if(!auth.ok)return json({error:"Invalid or expired staff session"},401);const user=await auth.json();
  const roleRes=await fetch(`${url}/rest/v1/school_staff_roles?user_id=eq.${user.id}&active=eq.true&select=role`,{headers:{apikey:service,Authorization:`Bearer ${service}`}});const roleRows=await roleRes.json();if(!roleRes.ok||!['admin','headteacher','teacher','bursar'].includes(roleRows?.[0]?.role))return json({error:"Active school staff role required"},403);
  const body=await req.json(),learnerId=String(body.learnerId||""),kind=String(body.documentType||""),fileName=String(body.fileName||"school-document.pdf").replace(/[^a-zA-Z0-9._-]/g,"-").slice(0,100),b64=String(body.pdfBase64||"");
  if(!learnerId||!['fee_statement','examination_report'].includes(kind)||!b64||b64.length>12_000_000)return json({error:"A learner, supported document type and PDF are required (maximum 9 MB encoded)"},400);
  const state=await fetch(`${url}/rest/v1/school_state_shared?id=eq.KAPNANDA&select=data`,{headers:{apikey:anon,Authorization:`Bearer ${token}`}});if(!state.ok)return json({error:"Could not read school learner records"},403);const rows=await state.json(),learners=rows?.[0]?.data?.learners||[],learner=learners.find((x:any)=>String(x.id)===learnerId);
  if(!learner)return json({error:"Learner record not found"},404);const email=String(learner.parentEmail||"").trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||learner.parentEmailConsent!==true)return json({error:"A valid parent email and recorded email consent are required"},403);
  const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));if(bytes.length<8||new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")return json({error:"Uploaded document is not a valid PDF"},400);
  const school=String(rows?.[0]?.data?.settings?.school||"Kapnanda School").slice(0,120);
  const mail=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resend}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[email],subject:`${school} — ${kind==='fee_statement'?'Fee Statement':'Examination Report'} for ${learner.name}`,html:`<p>Dear ${String(learner.parent||'Parent/Guardian').replace(/[<>]/g,'')},</p><p>Please find attached the ${kind==='fee_statement'?'fee statement':'examination report'} for <b>${String(learner.name||'').replace(/[<>]/g,'')}</b> (${String(learner.adm||'').replace(/[<>]/g,'')}).</p><p>Regards,<br>${school}</p>`,attachments:[{filename:fileName,content:b64}]})});
  const response=await mail.json().catch(()=>({}));const accepted=mail.ok;
  await fetch(`${url}/rest/v1/notification_delivery_logs`,{method:"POST",headers:{apikey:service,Authorization:`Bearer ${service}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify({learner_id:learnerId,recipient_email:email,channel:"email",message_type:kind,provider:"Resend",status:accepted?"submitted":"failed",provider_response:response,failure_reason:accepted?null:String(response?.message||`HTTP ${mail.status}`).slice(0,500)})});
  if(!accepted)return json({error:String(response?.message||`Email provider returned HTTP ${mail.status}`)},502);return json({accepted:true,provider:"Resend",recipient:email,id:response?.id||null});
 }catch(e){return json({error:String((e as Error)?.message||e).slice(0,500)},502)}
});
