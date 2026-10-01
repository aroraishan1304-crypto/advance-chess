export async function sendTransactionalEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("email_not_configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text })
  });
  if (!response.ok) throw new Error("email_send_failed");
  return response.json();
}

export function emailLink(env, path, token) {
  const origin = String(env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
  if (!/^https?:\/\//i.test(origin)) throw new Error("PUBLIC_ORIGIN_not_configured");
  return `${origin}${path}?token=${encodeURIComponent(token)}`;
}

export function emailVerificationTemplate({ username, link }) {
  return {
    subject: "Verify your Advanced Chess account",
    html: `<div style="font-family:Inter,Arial,sans-serif;background:#0b0d10;color:#eef2f7;padding:36px"><div style="max-width:560px;margin:auto;background:#14181e;border:1px solid #2b313b;border-radius:18px;padding:32px"><h1 style="margin:0 0 8px">Advanced Chess</h1><p style="color:#a9b1bd">Verify your email for <strong>${escapeHtml(username)}</strong>.</p><p>Click the button below to confirm your address.</p><p><a href="${escapeAttr(link)}" style="display:inline-block;padding:12px 18px;background:#4d9ef7;color:white;border-radius:10px;text-decoration:none;font-weight:700">Verify email</a></p><p style="color:#8f98a6;font-size:13px">This link expires in 24 hours.</p></div></div>`,
    text: `Verify your Advanced Chess email: ${link}`
  };
}

export function passwordResetTemplate({ username, link }) {
  return {
    subject: "Reset your Advanced Chess password",
    html: `<div style="font-family:Inter,Arial,sans-serif;background:#0b0d10;color:#eef2f7;padding:36px"><div style="max-width:560px;margin:auto;background:#14181e;border:1px solid #2b313b;border-radius:18px;padding:32px"><h1 style="margin:0 0 8px">Password reset</h1><p style="color:#a9b1bd">A password reset was requested for <strong>${escapeHtml(username)}</strong>.</p><p><a href="${escapeAttr(link)}" style="display:inline-block;padding:12px 18px;background:#4d9ef7;color:white;border-radius:10px;text-decoration:none;font-weight:700">Reset password</a></p><p style="color:#8f98a6;font-size:13px">This link expires in 30 minutes. If you did not request this, you can ignore this message.</p></div></div>`,
    text: `Reset your Advanced Chess password: ${link}`
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function escapeAttr(value) { return escapeHtml(value); }
