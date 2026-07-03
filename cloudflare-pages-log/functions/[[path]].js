const ALLOWED_ORIGIN = "https://yiluoyi523-droid.github.io";
const LOG_DIR = "payment-logs";

function jsonResponse(body, status = 200, origin = ALLOWED_ORIGIN) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    }
  });
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

function compactName(value) {
  return cleanText(value, 40)
    .replace(/[\\/:*?"<>|#%{}\[\]\^~`]/g, "")
    .replace(/\s+/g, "-") || "unknown";
}

function buildLogPath(companyName, phone, now) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mi = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const date = `${yyyy}-${mm}-${dd}`;
  const stamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  const random = crypto.randomUUID().slice(0, 8);
  const phoneTail = cleanText(phone, 11).slice(-4) || "0000";
  return `${LOG_DIR}/${date}/${stamp}-${compactName(companyName)}-${phoneTail}-${random}.json`;
}

function validatePayload(payload) {
  const companyName = cleanText(payload.companyName, 120);
  const openPhone = cleanText(payload.openPhone, 20);
  const contactName = cleanText(payload.contactName, 40);
  const agreedTerms = payload.agreedTerms === true;
  const paidConfirmed = payload.paidConfirmed === true;

  if (!companyName) return { error: "公司名称不能为空" };
  if (!/^1[3-9]\d{9}$/.test(openPhone)) return { error: "手机号格式不正确" };
  if (!contactName) return { error: "姓名不能为空" };
  if (!agreedTerms) return { error: "未确认同意会员服务与使用须知" };
  if (!paidConfirmed) return { error: "未确认支付" };

  return {
    value: {
      companyName,
      openPhone,
      contactName,
      agreedTerms,
      paidConfirmed
    }
  };
}

async function writeLogToGitHub(env, path, log) {
  const owner = env.GITHUB_OWNER || "yiluoyi523-droid";
  const repo = env.GITHUB_REPO || "chengyou-payment-logs";
  const branch = env.GITHUB_BRANCH || "main";
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "chengyou-payment-log-pages",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      message: `Add payment log ${path}`,
      content: textToBase64(JSON.stringify(log, null, 2)),
      branch
    })
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: result.message || "GitHub 写入失败"
    };
  }

  return {
    ok: true,
    path,
    commitSha: result.commit?.sha || "",
    htmlUrl: result.content?.html_url || ""
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get("Origin") || ALLOWED_ORIGIN;
  const responseOrigin = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;

  if (request.method === "OPTIONS") {
    return jsonResponse({ ok: true }, 200, responseOrigin);
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method Not Allowed" }, 405, responseOrigin);
  }

  if (origin !== ALLOWED_ORIGIN) {
    return jsonResponse({ ok: false, error: "Origin Not Allowed" }, 403, responseOrigin);
  }

  if (!env.GITHUB_TOKEN) {
    return jsonResponse({ ok: false, error: "缺少 GitHub Token 配置" }, 500, responseOrigin);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "请求内容不是有效 JSON" }, 400, responseOrigin);
  }

  const validation = validatePayload(payload);
  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400, responseOrigin);
  }

  const now = new Date();
  const path = buildLogPath(validation.value.companyName, validation.value.openPhone, now);
  const log = {
    ...validation.value,
    agreedTermsTitle: "会员服务与使用须知",
    submittedAt: now.toISOString(),
    submittedAtClient: cleanText(payload.submittedAtClient, 60),
    pageUrl: cleanText(payload.pageUrl, 300),
    userAgent: cleanText(payload.userAgent, 500)
  };

  const written = await writeLogToGitHub(env, path, log);
  if (!written.ok) {
    return jsonResponse({ ok: false, error: written.message, status: written.status }, 502, responseOrigin);
  }

  return jsonResponse({ ok: true, path: written.path, commitSha: written.commitSha, htmlUrl: written.htmlUrl }, 200, responseOrigin);
}
