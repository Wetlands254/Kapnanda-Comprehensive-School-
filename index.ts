// Kapnanda school bulk messaging gateway.
// Configure provider credentials with `supabase secrets set`; never expose them in browser code.
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
async function sendSms(recipients: { phone: string; message?: string }[], message: string, personalized = false) {
  if (personalized) {
    const results: any[] = [];
    for (const recipient of recipients) {
      const one = await sendSms([recipient], String(recipient.message || message), false);
      results.push(one);
    }
    const accepted = results.reduce((n, r) => n + Number(r.accepted ?? 0), 0);
    const failed = results.reduce((n, r) => n + Number(r.failed ?? 0), 0);
    return { channel: "SMS", provider: "Africa's Talking", status: failed ? (accepted ? "partially submitted" : "failed") : "submitted", accepted, failed, detail: `Personalized messages processed for ${recipients.length} recipient(s). Check provider delivery reports.` };
  }
  const username = env("AFRICASTALKING_USERNAME"), apiKey = env("AFRICASTALKING_API_KEY");
  if (!username || !apiKey) throw new Error("Africa's Talking is not configured. Add AFRICASTALKING_USERNAME and AFRICASTALKING_API_KEY Supabase secrets.");
  const form = new URLSearchParams({ username, to: recipients.map(r => r.phone).join(","), message });
  const sender = env("AFRICASTALKING_SENDER_ID");
  if (sender) form.set("from", sender);
  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST", headers: { "apiKey": apiKey, "Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  const raw = await response.text();
  let parsed: any; try { parsed = JSON.parse(raw); } catch { parsed = { raw: raw.slice(0, 500) }; }
  if (!response.ok) throw new Error(`Africa's Talking SMS API returned HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 500)}`);
  const rows = parsed?.SMSMessageData?.Recipients || [];
  const accepted = rows.filter((r: any) => /success|sent|queued/i.test(String(r.status || r.statusCode || "")) || Number(r.statusCode) === 101).length;
  return { channel: "SMS", provider: "Africa's Talking", status: rows.length ? "submitted" : "provider response received", accepted: rows.length ? accepted : undefined, failed: rows.length ? rows.length - accepted : undefined, detail: String(parsed?.SMSMessageData?.Message || "Check provider dashboard for delivery status").slice(0, 250) };
}
async function sendWhatsApp(recipients: { phone: string; variable?: string }[], templateName: string, language: string, variable: string) {
  const token = env("WHATSAPP_ACCESS_TOKEN"), phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("WhatsApp Cloud API is not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID Supabase secrets.");
  const version = env("WHATSAPP_GRAPH_VERSION") || "v23.0";
  const results: any[] = [];
  for (const recipient of recipients) {
    const to = recipient.phone.replace("+", "");
    const payload = { messaging_product: "whatsapp", recipient_type: "individual", to, type: "template", template: { name: templateName, language: { code: language || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: String(recipient.variable || variable) }] }] } };
    try {
      const response = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
        method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      results.push({ ok: response.ok, status: response.ok ? "submitted" : "failed", detail: response.ok ? "WhatsApp API accepted request" : String(body?.error?.message || `HTTP ${response.status}`).slice(0, 180) });
    } catch (e) { results.push({ ok: false, status: "failed", detail: String(e).slice(0, 180) }); }
  }
  const accepted = results.filter(r => r.ok).length;
  const failed = results.length - accepted;
  return { channel: "WhatsApp", provider: "Meta WhatsApp Cloud API", status: failed ? (accepted ? "partially submitted" : "failed") : "submitted", accepted, failed, detail: failed ? `${failed} recipient request(s) failed; inspect errors and provider logs.` : "All requests were accepted by the API; delivery is not guaranteed." };
}
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Sign-in is required" }, 401);
    const supabaseUrl = env("SUPABASE_URL"), anonKey = env("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) return json({ error: "Supabase function environment is incomplete" }, 500);
    const authCheck = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!authCheck.ok) return json({ error: "Your Supabase session is invalid or expired" }, 401);
    const body = await req.json();
    const channel = String(body.channel || "");
    if (!["sms", "whatsapp", "both"].includes(channel)) return json({ error: "Unsupported channel" }, 400);
    if (!Array.isArray(body.recipients) || body.recipients.length < 1 || body.recipients.length > 200) return json({ error: "Campaign must contain between 1 and 200 recipients" }, 400);
    const personalized = body.personalized === true;
    const recipients = body.recipients.map((r: any) => ({ phone: normalizePhone(r?.phone), message: personalized ? String(r?.message || "").slice(0, 1200) : undefined, variable: personalized ? String(r?.variable || "").slice(0, 1000) : undefined })).filter((r: any) => r.phone);
    if (!recipients.length) return json({ error: "No valid Kenyan phone numbers were supplied" }, 400);
    if (recipients.length !== body.recipients.length) return json({ error: "Some phone numbers are invalid. Refresh the recipient list and try again." }, 400);
    const results: any[] = [];
    if (channel === "sms" || channel === "both") {
      const message = String(body.smsText || "").trim();
      if ((!message && !personalized) || message.length > 1200 || (personalized && recipients.some((r: any) => !r.message))) return json({ error: "SMS message is missing or too long" }, 400);
      results.push(await sendSms(recipients, message, personalized));
    }
    if (channel === "whatsapp" || channel === "both") {
      const templateName = String(body.templateName || "").trim();
      const language = String(body.templateLanguage || "en").trim();
      const variable = String(body.templateVariable || "").trim();
      if (!/^[a-z0-9_]+$/.test(templateName) || (!variable && !personalized) || variable.length > 1000 || (personalized && recipients.some((r: any) => !r.variable))) return json({ error: "Provide an approved WhatsApp template name and a body variable" }, 400);
      // Keep campaigns small to reduce accidental costs and prevent provider abuse.
      results.push(await sendWhatsApp(recipients, templateName, language, variable));
    }
    return json({ message: "Provider responses received. Check delivery reports for final delivery status.", results });
  } catch (e) {
    console.error("send-school-messages error", e);
    return json({ error: String((e as Error)?.message || e).slice(0, 700) }, 502);
  }
});
