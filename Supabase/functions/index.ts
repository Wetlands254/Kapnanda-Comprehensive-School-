// Kapnanda school messaging gateway.
// All provider secrets remain in Supabase Edge Function environment variables.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const env = (name: string) => Deno.env.get(name) || "";
function normalizePhone(value: unknown): string {
  let n = String(value || "").trim().replace(/[\s().-]/g, "");
  if (n.startsWith("00")) n = "+" + n.slice(2);
  if (/^0[17]\d{8}$/.test(n)) n = "+254" + n.slice(1);
  else if (/^254[17]\d{8}$/.test(n)) n = "+" + n;
  else if (/^[17]\d{8}$/.test(n)) n = "+254" + n;
  return /^\+254[17]\d{8}$/.test(n) ? n : "";
}
async function sendOneSms(phone: string, message: string) {
  const username = env("AFRICASTALKING_USERNAME"), apiKey = env("AFRICASTALKING_API_KEY");
  if (!username || !apiKey) throw new Error("Africa's Talking is not configured. Add AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY secrets.");
  const form = new URLSearchParams({ username, to: phone, message });
  const sender = env("AFRICASTALKING_SENDER_ID"); if (sender) form.set("from", sender);
  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST", headers: { apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const raw = await response.text(); let parsed: any;
  try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error(`Africa's Talking returned HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 350)}`);
  const row = parsed?.SMSMessageData?.Recipients?.[0];
  const accepted = !!row && (/success|sent|queued/i.test(String(row.status || "")) || Number(row.statusCode) === 101);
  return { provider: "Africa's Talking", status: row ? (accepted ? "submitted" : "failed") : "provider_response_received", accepted, response: parsed };
}
async function sendOneWhatsApp(phone: string, templateName: string, language: string, variable: string) {
  const token = env("WHATSAPP_ACCESS_TOKEN"), phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("WhatsApp Cloud API is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID secrets.");
  const version = env("WHATSAPP_GRAPH_VERSION") || "v23.0";
  const payload = { messaging_product: "whatsapp", recipient_type: "individual", to: phone.replace("+", ""), type: "template", template: { name: templateName, language: { code: language || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: variable }] }] } };
  const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(body?.error?.message || `Meta API returned HTTP ${response.status}`).slice(0, 350));
  return { provider: "Meta WhatsApp Cloud API", status: "submitted", accepted: true, response: body };
}
async function logDelivery(rows: any[]) {
  const url = env("SUPABASE_URL"), serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for the private notification delivery log.");
  const response = await fetch(`${url}/rest/v1/notification_delivery_logs`, {
    method: "POST", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Could not write notification delivery log (HTTP ${response.status}).`);
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "", token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign-in is required" }, 401);
    const supabaseUrl = env("SUPABASE_URL"), anonKey = env("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) return json({ error: "Supabase function environment is incomplete" }, 500);
    const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!authCheck.ok) return json({ error: "Your Supabase session is invalid or expired" }, 401);
    if (!env("SUPABASE_SERVICE_ROLE_KEY")) return json({ error: "SUPABASE_SERVICE_ROLE_KEY is required to write private delivery logs. Configure it before enabling messaging." }, 500);
    const body = await req.json(), channel = String(body.channel || "");
    if (!["sms", "whatsapp", "both"].includes(channel)) return json({ error: "Unsupported channel" }, 400);
    if (!Array.isArray(body.recipients) || body.recipients.length < 1 || body.recipients.length > 200) return json({ error: "Campaign must contain between 1 and 200 recipients" }, 400);
    const personalized = body.personalized === true;
    const recipients = body.recipients.map((r: any) => ({ learnerId: String(r?.learnerId || ""), phone: normalizePhone(r?.phone), message: personalized ? String(r?.message || "").slice(0, 1200) : "", variable: personalized ? String(r?.variable || "").slice(0, 1000) : "" }));
    if (recipients.some((r: any) => !r.learnerId || !r.phone)) return json({ error: "Each recipient must match a learner record and have a valid Kenyan phone number." }, 400);

    // Consent and phone ownership are rechecked against the authenticated shared database,
    // not trusted from the browser request.
    const stateResponse = await fetch(`${supabaseUrl}/rest/v1/school_state_shared?id=eq.KAPNANDA&select=data`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!stateResponse.ok) return json({ error: "Could not verify learner contacts and consent in the school database." }, 403);
    const stateRows = await stateResponse.json(), learners = stateRows?.[0]?.data?.learners || [];
    const matched: any[] = [];
    for (const recipient of recipients) {
      const learner = learners.find((l: any) => String(l.id) === recipient.learnerId);
      if (!learner || normalizePhone(learner.phone) !== recipient.phone) return json({ error: "A selected phone number no longer matches its learner record. Refresh contacts and try again." }, 409);
      if ((channel === "sms" || channel === "both") && learner.parentSmsConsent !== true) return json({ error: `SMS consent is not recorded for admission ${String(learner.adm || "").slice(0, 30)}.` }, 403);
      if ((channel === "whatsapp" || channel === "both") && learner.parentWhatsappConsent !== true) return json({ error: `WhatsApp consent is not recorded for admission ${String(learner.adm || "").slice(0, 30)}.` }, 403);
      if (personalized && ((channel === "sms" || channel === "both") ? !recipient.message : false)) return json({ error: "A personalized SMS message is missing." }, 400);
      if (personalized && (channel === "whatsapp" || channel === "both") && !recipient.variable) return json({ error: "A personalized WhatsApp template variable is missing." }, 400);
      matched.push({ ...recipient, learner });
    }

    const logs: any[] = [], results: any[] = [], now = new Date().toISOString(), messageType = String(body.messageType || "school_notice").slice(0, 50);
    if (channel === "sms" || channel === "both") {
      const message = String(body.smsText || "").trim();
      if ((!message && !personalized) || message.length > 1200) return json({ error: "SMS message is missing or too long." }, 400);
      const smsRows: any[] = [];
      for (const r of matched) {
        try {
          const sent = await sendOneSms(r.phone, personalized ? r.message : message);
          smsRows.push({ learnerId: r.learnerId, status: sent.status, detail: sent.accepted ? "Provider accepted request" : "Provider response received" });
          logs.push({ learner_id: r.learnerId, recipient_phone: r.phone, channel: "sms", message_type: messageType, provider: sent.provider, status: sent.status, provider_response: sent.response, failure_reason: null, created_at: now });
        } catch (e) {
          const reason = String((e as Error)?.message || e).slice(0, 500);
          smsRows.push({ learnerId: r.learnerId, status: "failed", detail: reason });
          logs.push({ learner_id: r.learnerId, recipient_phone: r.phone, channel: "sms", message_type: messageType, provider: "Africa's Talking", status: "failed", provider_response: null, failure_reason: reason, created_at: now });
        }
      }
      results.push({ channel: "SMS", provider: "Africa's Talking", status: smsRows.every(x => x.status === "submitted") ? "submitted" : "partially submitted or failed", accepted: smsRows.filter(x => x.status === "submitted").length, failed: smsRows.filter(x => x.status === "failed").length, recipients: smsRows });
    }
    if (channel === "whatsapp" || channel === "both") {
      const templateName = String(body.templateName || "").trim(), language = String(body.templateLanguage || "en").trim(), variable = String(body.templateVariable || "").trim();
      if (!/^[a-z0-9_]+$/.test(templateName) || (!variable && !personalized) || variable.length > 1000) return json({ error: "Provide an approved WhatsApp template name and a body variable." }, 400);
      const waRows: any[] = [];
      for (const r of matched) {
        try {
          const sent = await sendOneWhatsApp(r.phone, templateName, language, personalized ? r.variable : variable);
          waRows.push({ learnerId: r.learnerId, status: sent.status, detail: "Meta API accepted request" });
          logs.push({ learner_id: r.learnerId, recipient_phone: r.phone, channel: "whatsapp", message_type: messageType, provider: sent.provider, status: sent.status, provider_response: sent.response, failure_reason: null, created_at: now });
        } catch (e) {
          const reason = String((e as Error)?.message || e).slice(0, 500);
          waRows.push({ learnerId: r.learnerId, status: "failed", detail: reason });
          logs.push({ learner_id: r.learnerId, recipient_phone: r.phone, channel: "whatsapp", message_type: messageType, provider: "Meta WhatsApp Cloud API", status: "failed", provider_response: null, failure_reason: reason, created_at: now });
        }
      }
      results.push({ channel: "WhatsApp", provider: "Meta WhatsApp Cloud API", status: waRows.every(x => x.status === "submitted") ? "submitted" : "partially submitted or failed", accepted: waRows.filter(x => x.status === "submitted").length, failed: waRows.filter(x => x.status === "failed").length, recipients: waRows });
    }
    let deliveryLogSaved = true, deliveryLogError = "";
    try { await logDelivery(logs); } catch (e) { deliveryLogSaved = false; deliveryLogError = String((e as Error)?.message || e).slice(0, 350); console.error("Notification delivery log write failed", e); }
    return json({ message: deliveryLogSaved ? "Provider requests processed and delivery attempts logged. Provider acceptance is not proof of final delivery." : "Provider requests processed, but the delivery log could not be saved. Do not blindly resend; inspect provider status first.", deliveryLogSaved, deliveryLogError, results });
  } catch (e) {
    console.error("send-school-messages error", e);
    return json({ error: String((e as Error)?.message || e).slice(0, 700) }, 502);
  }
});
