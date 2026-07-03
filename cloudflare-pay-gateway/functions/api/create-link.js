import {
  cleanText,
  createToken,
  getJsonFile,
  getPublicBaseUrl,
  isAdminAuthorized,
  jsonResponse,
  linkPath,
  putJsonFile
} from "../_shared.js";

export function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestPost({ request, env }) {
  if (!isAdminAuthorized(request, env)) {
    return jsonResponse({ ok: false, error: "管理口令不正确。" }, 401);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "请求内容不是有效 JSON。" }, 400);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 30 * 60 * 1000);
  const link = {
    token: "",
    status: "active",
    validMinutes: 30,
    targetCompany: cleanText(payload.targetCompany, 120),
    amount: cleanText(payload.amount, 40),
    planName: cleanText(payload.planName, 80),
    note: cleanText(payload.note, 200),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdUserAgent: cleanText(request.headers.get("User-Agent"), 300)
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const token = createToken(6);
    const path = linkPath(token);
    const existing = await getJsonFile(env, path);
    if (!existing.ok) {
      return jsonResponse({ ok: false, error: existing.error }, existing.status || 502);
    }
    if (existing.exists) continue;

    const nextLink = { ...link, token };
    const written = await putJsonFile(env, path, nextLink, `Create payment link ${token}`);
    if (!written.ok) {
      return jsonResponse({ ok: false, error: written.error }, written.status || 502);
    }

    return jsonResponse({
      ok: true,
      token,
      url: `${getPublicBaseUrl(request, env)}/p/${token}`,
      expiresAt: nextLink.expiresAt,
      path: written.path
    });
  }

  return jsonResponse({ ok: false, error: "短码生成冲突，请重试。" }, 409);
}
