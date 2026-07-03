import {
  buildLogPath,
  cleanText,
  cleanToken,
  getJsonFile,
  jsonResponse,
  linkPath,
  linkStatus,
  maskPhone,
  putJsonFile
} from "../_shared.js";

function validatePayload(payload) {
  const token = cleanToken(payload.token);
  const companyName = cleanText(payload.companyName, 120);
  const openPhone = cleanText(payload.openPhone, 20);
  const contactName = cleanText(payload.contactName, 40);
  const agreedTerms = payload.agreedTerms === true;
  const paidConfirmed = payload.paidConfirmed === true;

  if (!token) return { error: "缺少付款链接短码。" };
  if (!companyName) return { error: "公司名称不能为空。" };
  if (!/^1[3-9]\d{9}$/.test(openPhone)) return { error: "手机号格式不正确。" };
  if (!contactName) return { error: "姓名不能为空。" };
  if (!agreedTerms) return { error: "未确认同意会员服务与使用须知。" };
  if (!paidConfirmed) return { error: "未确认支付。" };

  return {
    value: {
      token,
      companyName,
      openPhone,
      contactName,
      agreedTerms,
      paidConfirmed
    }
  };
}

export function onRequestOptions() {
  return jsonResponse({ ok: true });
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return jsonResponse({ ok: false, error: "请求内容不是有效 JSON。" }, 400);
  }

  const validation = validatePayload(payload);
  if (validation.error) {
    return jsonResponse({ ok: false, error: validation.error }, 400);
  }

  const paymentLinkPath = linkPath(validation.value.token);
  const linkFile = await getJsonFile(env, paymentLinkPath);
  if (!linkFile.ok) {
    return jsonResponse({ ok: false, error: linkFile.error }, linkFile.status || 502);
  }
  if (!linkFile.exists) {
    return jsonResponse({ ok: false, error: "付款链接不存在或已失效。" }, 404);
  }

  const state = linkStatus(linkFile.value);
  if (!state.usable) {
    return jsonResponse({ ok: false, code: state.code, error: state.error }, 410);
  }

  const now = new Date();
  const logPath = buildLogPath(validation.value.companyName, validation.value.openPhone, validation.value.token, now);
  const log = {
    ...validation.value,
    openPhoneMasked: maskPhone(validation.value.openPhone),
    agreedTermsTitle: "会员服务与使用须知",
    termsVersion: "2026-07-03",
    paymentLink: {
      token: linkFile.value.token,
      targetCompany: linkFile.value.targetCompany || "",
      amount: linkFile.value.amount || "",
      planName: linkFile.value.planName || "",
      customerService: {
        name: linkFile.value.customerService?.name || "",
        contact: linkFile.value.customerService?.contact || ""
      },
      paymentQr: linkFile.value.paymentQr
        ? {
            path: linkFile.value.paymentQr.path || "",
            contentType: linkFile.value.paymentQr.contentType || "",
            originalName: linkFile.value.paymentQr.originalName || "",
            htmlUrl: linkFile.value.paymentQr.htmlUrl || ""
          }
        : {
            path: "默认平台收款码",
            contentType: "",
            originalName: "",
            htmlUrl: ""
          },
      createdAt: linkFile.value.createdAt,
      expiresAt: linkFile.value.expiresAt
    },
    submittedAt: now.toISOString(),
    submittedAtClient: cleanText(payload.submittedAtClient, 60),
    pageUrl: cleanText(payload.pageUrl, 300),
    userAgent: cleanText(payload.userAgent, 500)
  };

  const written = await putJsonFile(env, logPath, log, `Add payment log ${logPath}`);
  if (!written.ok) {
    return jsonResponse({ ok: false, error: written.error }, written.status || 502);
  }

  const usedLink = {
    ...linkFile.value,
    status: "used",
    usedAt: now.toISOString(),
    paymentLogPath: logPath,
    paymentLogUrl: written.htmlUrl,
    usedBy: {
      companyName: validation.value.companyName,
      contactName: validation.value.contactName,
      openPhoneMasked: maskPhone(validation.value.openPhone)
    }
  };
  const updated = await putJsonFile(env, paymentLinkPath, usedLink, `Use payment link ${validation.value.token}`, linkFile.sha);
  if (!updated.ok) {
    return jsonResponse({ ok: false, error: "付款日志已保存，但链接状态更新失败，请联系客服核对。" }, updated.status || 502);
  }

  return jsonResponse({
    ok: true,
    path: written.path,
    commitSha: written.commitSha,
    htmlUrl: written.htmlUrl
  });
}
