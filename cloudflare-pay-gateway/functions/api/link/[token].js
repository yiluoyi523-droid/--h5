import {
  cleanToken,
  getJsonFile,
  jsonResponse,
  linkPath,
  linkStatus,
  publicLink
} from "../../_shared.js";

export async function onRequestGet({ params, env }) {
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

  return jsonResponse({ ok: true, link: publicLink(file.value) });
}
