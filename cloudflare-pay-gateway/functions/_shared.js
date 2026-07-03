const DEFAULT_OWNER = "yiluoyi523-droid";
const DEFAULT_REPO = "chengyou-payment-logs";
const DEFAULT_BRANCH = "main";
const LINK_DIR = "payment-links";
const LOG_DIR = "payment-logs";
const QR_DIR = "payment-qrs";

export function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function cleanText(value, maxLength) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength);
}

export function cleanToken(value) {
  return cleanText(value, 24).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createToken(length = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += chars[bytes[i] % chars.length];
  }
  return token;
}

export function linkPath(token) {
  return `${LINK_DIR}/${cleanToken(token)}.json`;
}

export function qrPath(token, contentType = "image/png") {
  const extMap = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp"
  };
  const ext = extMap[contentType] || "png";
  return `${QR_DIR}/${cleanToken(token)}.${ext}`;
}

export function isAdminAuthorized(request, env) {
  const expected = env.ADMIN_TOKEN || "";
  const actual = request.headers.get("X-Admin-Token") || "";
  return expected.length >= 8 && actual === expected;
}

export function getPublicBaseUrl(request, env) {
  const configured = cleanText(env.PUBLIC_BASE_URL, 120).replace(/\/+$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  return url.origin;
}

export function linkStatus(link, now = new Date()) {
  if (!link) return { usable: false, code: "missing", error: "付款链接不存在。" };
  if (link.status === "used") return { usable: false, code: "used", error: "该付款链接已提交使用，不能再次打开。" };
  if (link.status && link.status !== "active") return { usable: false, code: "locked", error: "该付款链接当前不可用，请联系客服重新获取。" };
  if (!link.expiresAt || new Date(link.expiresAt).getTime() <= now.getTime()) {
    return { usable: false, code: "expired", error: "该付款链接已超过 30 分钟有效期。" };
  }
  return { usable: true, code: "active" };
}

export function publicLink(link) {
  const hasCustomQr = Boolean(link.paymentQr?.path);
  return {
    token: link.token,
    status: link.status,
    targetCompany: link.targetCompany || "",
    amount: link.amount || "",
    planName: link.planName || "",
    customerService: {
      name: link.customerService?.name || "",
      contact: link.customerService?.contact || ""
    },
    hasCustomQr,
    qrUrl: hasCustomQr ? `/api/payment-qr/${encodeURIComponent(link.token)}` : "",
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    validMinutes: link.validMinutes || 30
  };
}

export function maskPhone(phone) {
  const value = cleanText(phone, 20);
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function compactName(value) {
  return cleanText(value, 40)
    .replace(/[\\/:*?"<>|#%{}\[\]\^~`]/g, "")
    .replace(/\s+/g, "-") || "unknown";
}

function chinaParts(now) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const yyyy = local.getUTCFullYear();
  const mm = String(local.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(local.getUTCDate()).padStart(2, "0");
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mi = String(local.getUTCMinutes()).padStart(2, "0");
  const ss = String(local.getUTCSeconds()).padStart(2, "0");
  return { yyyy, mm, dd, hh, mi, ss };
}

export function buildLogPath(companyName, phone, token, now) {
  const { yyyy, mm, dd, hh, mi, ss } = chinaParts(now);
  const date = `${yyyy}-${mm}-${dd}`;
  const stamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  const phoneTail = cleanText(phone, 11).slice(-4) || "0000";
  return `${LOG_DIR}/${date}/${stamp}-${cleanToken(token)}-${compactName(companyName)}-${phoneTail}.json`;
}

function repoConfig(env) {
  return {
    owner: env.GITHUB_OWNER || DEFAULT_OWNER,
    repo: env.GITHUB_REPO || DEFAULT_REPO,
    branch: env.GITHUB_BRANCH || DEFAULT_BRANCH
  };
}

function contentUrl(env, path) {
  const { owner, repo } = repoConfig(env);
  return `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
}

function githubHeaders(env) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Content-Type": "application/json",
    "User-Agent": "chengyou-pay-gateway",
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function textToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToText(value) {
  const binary = atob(String(value || "").replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export async function getJsonFile(env, path) {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 500, error: "缺少 GitHub Token 配置。" };
  }

  const { branch } = repoConfig(env);
  const response = await fetch(`${contentUrl(env, path)}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env)
  });
  const result = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return { ok: true, exists: false };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: result.message || "读取 GitHub 文件失败。" };
  }

  return {
    ok: true,
    exists: true,
    sha: result.sha,
    htmlUrl: result.html_url,
    value: JSON.parse(base64ToText(result.content))
  };
}

export async function getBase64File(env, path) {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 500, error: "缺少 GitHub Token 配置。" };
  }

  const { branch } = repoConfig(env);
  const response = await fetch(`${contentUrl(env, path)}?ref=${encodeURIComponent(branch)}`, {
    headers: githubHeaders(env)
  });
  const result = await response.json().catch(() => ({}));

  if (response.status === 404) {
    return { ok: true, exists: false };
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: result.message || "读取 GitHub 文件失败。" };
  }

  let content = String(result.content || "").replace(/\n/g, "");
  if (!content && result.git_url) {
    const blobResponse = await fetch(result.git_url, { headers: githubHeaders(env) });
    const blob = await blobResponse.json().catch(() => ({}));
    if (!blobResponse.ok) {
      return { ok: false, status: blobResponse.status, error: blob.message || "读取 GitHub 图片失败。" };
    }
    content = String(blob.content || "").replace(/\n/g, "");
  }

  if (!content) {
    return { ok: false, status: 502, error: "GitHub 图片内容为空。" };
  }

  return {
    ok: true,
    exists: true,
    sha: result.sha,
    htmlUrl: result.html_url,
    content
  };
}

export async function putJsonFile(env, path, value, message, sha = "") {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 500, error: "缺少 GitHub Token 配置。" };
  }

  const { branch } = repoConfig(env);
  const body = {
    message,
    content: textToBase64(JSON.stringify(value, null, 2)),
    branch
  };
  if (sha) body.sha = sha;

  const response = await fetch(contentUrl(env, path), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: result.message || "写入 GitHub 文件失败。"
    };
  }

  return {
    ok: true,
    path,
    sha: result.content?.sha || "",
    commitSha: result.commit?.sha || "",
    htmlUrl: result.content?.html_url || ""
  };
}

export async function putBase64File(env, path, base64Content, message, sha = "") {
  if (!env.GITHUB_TOKEN) {
    return { ok: false, status: 500, error: "缺少 GitHub Token 配置。" };
  }

  const { branch } = repoConfig(env);
  const body = {
    message,
    content: String(base64Content || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, ""),
    branch
  };
  if (sha) body.sha = sha;

  const response = await fetch(contentUrl(env, path), {
    method: "PUT",
    headers: githubHeaders(env),
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: result.message || "写入 GitHub 图片失败。"
    };
  }

  return {
    ok: true,
    path,
    sha: result.content?.sha || "",
    commitSha: result.commit?.sha || "",
    htmlUrl: result.content?.html_url || ""
  };
}
