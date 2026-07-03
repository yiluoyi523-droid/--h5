import {
  cleanToken,
  getBase64File,
  getJsonFile,
  jsonResponse,
  linkPath,
  linkStatus
} from "../../_shared.js";

function base64ToBytes(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function onRequestGet({ request, params, env }) {
  const token = cleanToken(params.token);
  if (!token) {
    return jsonResponse({ ok: false, error: "付款链接不完整。" }, 400);
  }

  const file = await getJsonFile(env, linkPath(token));
  if (!file.ok) {
    return jsonResponse({ ok: false, error: file.error }, file.status || 502);
  }
  if (!file.exists) {
    return jsonResponse({ ok: false, error: "付款链接不存在或已失效。" }, 404);
  }

  const state = linkStatus(file.value);
  if (!state.usable) {
    return jsonResponse({ ok: false, code: state.code, error: state.error }, 410);
  }

  const qr = file.value.paymentQr;
  if (!qr?.path) {
    const fallback = new URL("/assets/payment-qr.png", request.url);
    return Response.redirect(fallback.toString(), 302);
  }

  const qrFile = await getBase64File(env, qr.path);
  if (!qrFile.ok) {
    return jsonResponse({ ok: false, error: qrFile.error }, qrFile.status || 502);
  }
  if (!qrFile.exists) {
    return jsonResponse({ ok: false, error: "收款二维码不存在，请联系客服重新获取链接。" }, 404);
  }

  return new Response(base64ToBytes(qrFile.content), {
    headers: {
      "Content-Type": qr.contentType || "image/png",
      "Cache-Control": "no-store"
    }
  });
}
