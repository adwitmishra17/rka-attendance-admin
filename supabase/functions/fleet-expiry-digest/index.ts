// ============================================================================
// fleet-expiry-digest
//
// Builds and sends the daily fleet document expiry digest.
//
// Invoked two ways:
//   - By pg_cron once a day with body {}              → sends to all active recipients
//   - From the /fleet-settings UI with {test:true,    → sends only to that recipient,
//     recipientId:"..."}                                even if they have zero items
//
// Auth: x-admin-secret header (this function is deployed with --no-verify-jwt,
// so it does NOT require a Supabase JWT — the shared secret is the gate).
//
// Per recipient: filters expiring docs by branch_filter + doc_categories,
// renders an HTML email grouped by urgency, sends via Resend.
// ============================================================================

// @ts-nocheck
import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0"

const ADMIN_SHARED_SECRET = Deno.env.get("ADMIN_SHARED_SECRET")!
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!

// Change these two if needed:
const FROM_ADDRESS = "RKA Fleet <fleet-alerts@rkacademyballia.in>"
const DASHBOARD_URL = "https://hrms.rkacademyballia.in"   // edit to your deployed HRMS URL

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const adminSecret = req.headers.get("x-admin-secret")
    if (!ADMIN_SHARED_SECRET || adminSecret !== ADMIN_SHARED_SECRET) {
      return json({ error: "unauthorized" }, 401)
    }

    const body = await safeJson(req)
    const testMode = body?.test === true
    const testRecipientId = body?.recipientId || null

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // ---- 1. Gather expiring documents ----
    const horizon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)

    const { data: vehDocs, error: ve } = await sb
      .from("vehicle_documents")
      .select(`id, doc_type, expires_at,
               vehicle:vehicles ( id, rc_number, branch_code )`)
      .is("deleted_at", null)
      .not("expires_at", "is", null)
      .lte("expires_at", horizon)
    if (ve) throw ve

    const { data: drvDocs, error: de } = await sb
      .from("driver_documents")
      .select(`id, doc_type, expires_at,
               employee:employees ( id, full_name, branch_codes )`)
      .is("deleted_at", null)
      .not("expires_at", "is", null)
      .lte("expires_at", horizon)
    if (de) throw de

    // Normalise into a single shape
    const allItems = [
      ...(vehDocs || [])
        .filter((d) => d.vehicle)
        .map((d) => ({
          category: "vehicle",
          branchCodes: [d.vehicle.branch_code],
          label: formatRc(d.vehicle.rc_number),
          docType: d.doc_type,
          expiresAt: d.expires_at,
          days: daysUntil(d.expires_at),
        })),
      ...(drvDocs || [])
        .filter((d) => d.employee)
        .map((d) => ({
          category: "driver",
          branchCodes: Array.isArray(d.employee.branch_codes) ? d.employee.branch_codes : [],
          label: d.employee.full_name,
          docType: d.doc_type,
          expiresAt: d.expires_at,
          days: daysUntil(d.expires_at),
        })),
    ]

    // ---- 2. Load recipients ----
    let recipientQuery = sb
      .from("fleet_alert_recipients")
      .select("*")
      .is("deleted_at", null)
      .eq("is_active", true)
    if (testMode && testRecipientId) {
      recipientQuery = sb
        .from("fleet_alert_recipients")
        .select("*")
        .eq("id", testRecipientId)
        .is("deleted_at", null)
    }
    const { data: recipients, error: re } = await recipientQuery
    if (re) throw re
    if (!recipients || recipients.length === 0) {
      return json({ sent: 0, skipped: 0, note: "no active recipients" })
    }

    // ---- 3. Per-recipient: filter, render, send ----
    let sent = 0, skipped = 0
    const errors: string[] = []

    for (const r of recipients) {
      const cats = r.doc_categories || []
      const items = allItems.filter((it) => {
        if (!cats.includes(it.category)) return false
        if (r.branch_filter && r.branch_filter !== "ALL") {
          if (!it.branchCodes.includes(r.branch_filter)) return false
        }
        return true
      })

      // Non-test recipients with nothing relevant are skipped (no noise).
      if (items.length === 0 && !testMode) {
        skipped++
        continue
      }

      items.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))
      const html = renderEmail({ recipient: r, items, testMode })
      const subject = items.length > 0
        ? `RKA Fleet — ${items.length} document${items.length === 1 ? "" : "s"} need attention`
        : `RKA Fleet — test email (nothing currently expiring)`

      try {
        await sendViaResend({ to: r.email, subject, html })
        sent++
        await sb.from("fleet_audit_log").insert({
          entity_type: "recipient",
          entity_id: r.id,
          changed_by_email: testMode ? "test-send" : "cron",
          action: "update",
          field_name: `digest_sent:${items.length}_items`,
          old_value: null,
          new_value: r.email,
        })
      } catch (sendErr) {
        errors.push(`${r.email}: ${sendErr.message}`)
      }
    }

    return json({ sent, skipped, errors, totalItems: allItems.length })
  } catch (e) {
    console.error("fleet-expiry-digest error:", e)
    return json({ error: "internal_error", detail: String(e?.message || e) }, 500)
  }
})


// ----------------------------------------------------------------------------
// Resend send
// ----------------------------------------------------------------------------
async function sendViaResend({ to, subject, html }) {
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html }),
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Resend ${resp.status}: ${text}`)
  }
  return resp.json()
}


// ----------------------------------------------------------------------------
// HTML email rendering — table-based, inline styles (email-client safe)
// ----------------------------------------------------------------------------
function renderEmail({ recipient, items, testMode }) {
  const GREEN = "#1a4a2e", GOLD = "#c9a227", CRIMSON = "#8b1a1a"
  const CREAM = "#faf7f0", INK = "#2b2b2b", MUTED = "#6b6b6b"

  const expired = items.filter((i) => i.days < 0)
  const critical = items.filter((i) => i.days >= 0 && i.days <= 7)
  const warning = items.filter((i) => i.days > 7 && i.days <= 30)

  const branchLabel = recipient.branch_filter === "ALL"
    ? "all branches"
    : recipient.branch_filter

  const section = (title, rows, color) => {
    if (rows.length === 0) return ""
    const rowsHtml = rows.map((it) => {
      const when = it.days < 0
        ? `expired ${Math.abs(it.days)}d ago`
        : it.days === 0 ? "expires today"
          : it.days === 1 ? "expires tomorrow"
            : `${it.days} days left`
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:${INK};">
            <strong>${escapeHtml(it.docType)}</strong>
            <span style="color:${MUTED};"> &middot; ${it.category === "vehicle" ? "Vehicle" : "Driver"}</span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:${INK};">
            ${escapeHtml(it.label)}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:13px;color:${color};font-weight:600;white-space:nowrap;">
            ${when}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:${MUTED};white-space:nowrap;">
            ${fmtDate(it.expiresAt)}
          </td>
        </tr>`
    }).join("")
    return `
      <tr><td style="padding:18px 0 6px 0;">
        <span style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color};">
          ${title} (${rows.length})
        </span>
      </td></tr>
      <tr><td>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fff;border:1px solid #eee;border-radius:6px;overflow:hidden;">
          ${rowsHtml}
        </table>
      </td></tr>`
  }

  const emptyBlock = testMode && items.length === 0
    ? `<tr><td style="padding:20px;text-align:center;color:${MUTED};font-size:13px;background:#fff;border:1px solid #eee;border-radius:6px;">
         This is a test email. No fleet documents are currently expired or expiring within 30 days for ${escapeHtml(branchLabel)}.
       </td></tr>`
    : ""

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:${GREEN};border-radius:8px 8px 0 0;padding:22px 28px;">
          <div style="color:#fff;font-size:18px;font-weight:700;letter-spacing:0.02em;">
            Radhakrishna Academy — Fleet
          </div>
          <div style="color:#cde3d5;font-size:13px;margin-top:3px;">
            Document expiry digest${testMode ? " (test)" : ""} &middot; ${fmtDate(new Date().toISOString())}
          </div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:${CREAM};padding:6px 28px 24px 28px;">
          <p style="font-size:13px;color:${INK};line-height:1.6;">
            ${recipient.name ? escapeHtml(recipient.name) + "," : "Hello,"}
            ${items.length > 0
      ? `the following ${items.length} fleet document${items.length === 1 ? "" : "s"} for <strong>${escapeHtml(branchLabel)}</strong> ${items.length === 1 ? "needs" : "need"} attention.`
      : ""}
          </p>

          <table width="100%" cellpadding="0" cellspacing="0">
            ${emptyBlock}
            ${section("Expired", expired, CRIMSON)}
            ${section("Critical — 7 days or less", critical, CRIMSON)}
            ${section("Upcoming — within 30 days", warning, GOLD)}
          </table>

          <p style="margin-top:24px;">
            <a href="${DASHBOARD_URL}" style="display:inline-block;background:${GREEN};color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:9px 18px;border-radius:6px;">
              Open the fleet dashboard
            </a>
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#fff;border-radius:0 0 8px 8px;padding:16px 28px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:${MUTED};line-height:1.5;">
            Automated message from the RKA HRMS fleet module. You are receiving this because
            your address is on the fleet alert recipient list. To stop these, ask an
            administrator to deactivate your entry in Fleet Settings.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`
}


// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

async function safeJson(req) {
  try { return await req.json() } catch { return {} }
}

function daysUntil(iso) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(iso); exp.setHours(0, 0, 0, 0)
  return Math.round((exp.getTime() - today.getTime()) / 86400000)
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
    })
  } catch { return String(iso) }
}

function formatRc(rc) {
  if (!rc) return ""
  const n = String(rc).toUpperCase().replace(/\s+/g, "")
  const m = n.match(/^([A-Z]{2}\d{1,2})([A-Z]{1,3}\d{1,4})$/)
  return m ? `${m[1]} ${m[2]}` : n
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}
