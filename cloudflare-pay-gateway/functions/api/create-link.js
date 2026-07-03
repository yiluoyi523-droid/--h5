import {
  cleanText,
  createToken,
  getJsonFile,
  getPublicBaseUrl,
  isAdminAuthorized,
  jsonResponse,
  linkPath,
  putBase64File,
  putJsonFile,
  qrPath
} from "../_shared.js";

const MAX_QR_BYTES = 3 * 1024 * 1024;
const QR_TYPES = {
  "image/png": true,
  "image/jpeg": true,
  "image/webp": true
};

function parseQrUpload(value) {
  if (!value) return { ok: true, value: null };

  const contentType = cleanText(value.contentType, 40).toLowerCase();
  const originalName = cleanText(value.name, 120);
  const base64 = String(value.base64 || "")
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "");
  const size = Number(value.size || 0);

  if (!QR_TYPES[contentType]) {
    return { ok: false, error: "收款二维码仅支持 PNG、JPG、WEBP 图片。" };
  }
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { ok: false, error: "收款二维码图片内容无效，请重新上传。" };
  }
  if (size > MAX_QR_BYTES || Math.ceil(base64.length * 3 / 4) > MAX_QR_BYTES) {
    return { ok: false, error: "收款二维码图片不能超过 3MB。" };
  }

  return {
    ok: true,
    value: {
      base64,
      contentType,
      originalName,
      size
    }
  };
}

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
  const qrUpload = parseQrUpload(payload.paymentQr);
  if (!qrUpload.ok) {
    return jsonResponse({ ok: false, error: qrUpload.error }, 400);
  }

  const link = {
    token: "",
    status: "active",
    validMinutes: 30,
    targetCompany: cleanText(payload.targetCompany, 120),
    amount: cleanText(payload.amount, 40),
    planName: cleanText(payload.planName, 80),
    customerService: {
      name: cleanText(payload.customerServiceName, 60),
      contact: cleanText(payload.customerServiceContact, 80)
    },
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
    if (qrUpload.value) {
      const qPath = qrPath(token, qrUpload.value.contentType);
      const qrWritten = await putBase64File(env, qPath, qrUpload.value.base64, `Upload payment QR ${token}`);
      if (!qrWritten.ok) {
        return jsonResponse({ ok: false, error: qrWritten.error }, qrWritten.status || 502);
      }
      nextLink.paymentQr = {
        path: qPath,
        contentType: qrUpload.value.contentType,
        originalName: qrUpload.value.originalName,
        size: qrUpload.value.size,
        htmlUrl: qrWritten.htmlUrl,
        createdAt: now.toISOString()
      };
    }

    const written = await putJsonFile(env, path, nextLink, `Create payment link ${token}`);
    if (!written.ok) {
      return jsonResponse({ ok: false, error: written.error }, written.status || 502);
    }

    return jsonResponse({
      ok: true,
      token,
      url: `${getPublicBaseUrl(request, env)}/p/${token}`,
      expiresAt: nextLink.expiresAt,
      customerService: nextLink.customerService,
      hasCustomQr: Boolean(nextLink.paymentQr?.path),
      path: written.path
    });
  }

  return jsonResponse({ ok: false, error: "短码生成冲突，请重试。" }, 409);
}
