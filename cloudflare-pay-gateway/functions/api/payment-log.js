import {
  base64ByteLength,
  buildEvidencePaths,
  cleanText,
  cleanToken,
  getJsonFile,
  jsonResponse,
  linkPath,
  linkStatus,
  maskPhone,
  putBase64File,
  putJsonFile,
  sha256Base64,
  sha256Text
} from "../_shared.js";
import { TERMS_TEXT, TERMS_TITLE, TERMS_VERSION } from "../_terms.js";

const MAX_CERTIFICATE_BYTES = 8 * 1024 * 1024;

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

function cleanLongText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateCertificatePdf(value) {
  if (!value) return { value: null };

  const contentType = cleanText(value.contentType, 60).toLowerCase();
  const base64 = String(value.base64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const fileName = cleanText(value.fileName || value.name || "payment-certificate.pdf", 140);

  if (contentType !== "application/pdf") {
    return { error: "确认书文件必须是 PDF 格式。" };
  }
  if (!base64 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    return { error: "确认书 PDF 内容无效，请重新提交。" };
  }

  let size = Number(value.size || 0);
  try {
    size = size || base64ByteLength(base64);
  } catch (error) {
    return { error: "确认书 PDF 内容无法解析，请重新提交。" };
  }

  if (size > MAX_CERTIFICATE_BYTES) {
    return { error: "确认书 PDF 不能超过 8MB。" };
  }

  return {
    value: {
      base64,
      contentType,
      fileName,
      size
    }
  };
}

function serverObservedRequest(request) {
  return {
    ip: cleanText(request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For"), 120),
    country: cleanText(request.headers.get("CF-IPCountry"), 20),
    ray: cleanText(request.headers.get("CF-Ray"), 120),
    referer: cleanText(request.headers.get("Referer"), 300),
    requestUrl: cleanText(request.url, 300),
    userAgent: cleanText(request.headers.get("User-Agent"), 500)
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
  const certificatePdf = validateCertificatePdf(payload.certificatePdf);
  if (certificatePdf.error) {
    return jsonResponse({ ok: false, error: certificatePdf.error }, 400);
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
  const evidencePaths = buildEvidencePaths(validation.value.companyName, validation.value.openPhone, validation.value.token, now);
  const logPath = evidencePaths.logPath;
  const documentNumber = cleanText(payload.clientDocumentNumber, 80) || `CY-${validation.value.token}-${evidencePaths.stamp}`;
  const termsSha256 = await sha256Text(TERMS_TEXT);
  const clientTermsText = cleanLongText(payload.termsText, 24000);
  const clientTermsSha256 = clientTermsText ? await sha256Text(clientTermsText) : "";

  let certificateRecord = {
    status: "not_provided",
    path: "",
    htmlUrl: "",
    contentType: "",
    originalName: "",
    size: 0,
    sha256: "",
    generatedAtClient: cleanText(payload.certificatePdf?.generatedAtClient, 80),
    pages: Number(payload.certificatePdf?.pages || 0) || 0
  };

  if (certificatePdf.value) {
    const certificateSha256 = await sha256Base64(certificatePdf.value.base64);
    const certificateWritten = await putBase64File(
      env,
      evidencePaths.certificatePath,
      certificatePdf.value.base64,
      `Add payment certificate ${validation.value.token}`
    );
    if (!certificateWritten.ok) {
      return jsonResponse({ ok: false, error: certificateWritten.error }, certificateWritten.status || 502);
    }
    certificateRecord = {
      status: "saved",
      path: certificateWritten.path,
      htmlUrl: certificateWritten.htmlUrl,
      contentType: certificatePdf.value.contentType,
      originalName: certificatePdf.value.fileName,
      size: certificatePdf.value.size,
      sha256: certificateSha256,
      generatedAtClient: cleanText(payload.certificatePdf?.generatedAtClient, 80),
      pages: Number(payload.certificatePdf?.pages || 0) || 0
    };
  }

  const log = {
    ...validation.value,
    openPhoneMasked: maskPhone(validation.value.openPhone),
    documentType: "会员服务开通及付款确认记录",
    documentNumber,
    confirmationStatement: "用户已勾选同意《会员服务与使用须知》，并点击“我已支付”。本记录用于证明用户在对应页面完成阅读确认与支付确认动作；实际到账情况以平台微信/支付宝收款记录为准。",
    agreedTermsTitle: TERMS_TITLE,
    termsVersion: TERMS_VERSION,
    termsSnapshot: {
      title: TERMS_TITLE,
      version: TERMS_VERSION,
      sha256: termsSha256,
      text: TERMS_TEXT,
      clientRenderedSha256: clientTermsSha256,
      clientRenderedMatchesCanonical: clientTermsSha256 ? clientTermsSha256 === termsSha256 : false
    },
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
    evidenceFiles: {
      certificatePdf: certificateRecord,
      evidenceIndex: {
        path: evidencePaths.evidenceIndexPath,
        htmlUrl: ""
      }
    },
    submittedAt: now.toISOString(),
    submittedAtClient: cleanText(payload.submittedAtClient, 60),
    pageUrl: cleanText(payload.pageUrl, 300),
    userAgent: cleanText(payload.userAgent, 500),
    serverObserved: serverObservedRequest(request)
  };
  const rawLogSha256 = await sha256Text(JSON.stringify(log, null, 2));

  const written = await putJsonFile(env, logPath, log, `Add payment log ${logPath}`);
  if (!written.ok) {
    return jsonResponse({ ok: false, error: written.error }, written.status || 502);
  }

  const evidenceIndex = {
    documentType: "成优网会员服务开通证据索引",
    documentNumber,
    token: validation.value.token,
    generatedAt: now.toISOString(),
    generatedBy: "chengyou-pay-gateway",
    summary: {
      companyName: validation.value.companyName,
      contactName: validation.value.contactName,
      openPhoneMasked: maskPhone(validation.value.openPhone),
      targetCompany: linkFile.value.targetCompany || "",
      planName: linkFile.value.planName || "",
      amount: linkFile.value.amount || "",
      customerService: linkFile.value.customerService || {},
      agreedTerms: validation.value.agreedTerms,
      paidConfirmed: validation.value.paidConfirmed,
      submittedAt: now.toISOString()
    },
    files: {
      rawLog: {
        path: written.path,
        htmlUrl: written.htmlUrl,
        githubSha: written.sha,
        commitSha: written.commitSha,
        sha256: rawLogSha256
      },
      certificatePdf: certificateRecord,
      paymentQr: log.paymentLink.paymentQr
    },
    terms: {
      title: TERMS_TITLE,
      version: TERMS_VERSION,
      sha256: termsSha256
    },
    client: {
      pageUrl: log.pageUrl,
      submittedAtClient: log.submittedAtClient,
      userAgent: log.userAgent
    },
    serverObserved: log.serverObserved,
    statement: log.confirmationStatement
  };
  const evidenceIndexSha256 = await sha256Text(JSON.stringify(evidenceIndex, null, 2));
  evidenceIndex.files.evidenceIndex = {
    path: evidencePaths.evidenceIndexPath,
    sha256WithoutSelf: evidenceIndexSha256
  };

  const evidenceWritten = await putJsonFile(env, evidencePaths.evidenceIndexPath, evidenceIndex, `Add evidence index ${validation.value.token}`);
  if (!evidenceWritten.ok) {
    return jsonResponse({ ok: false, error: "付款日志已保存，但证据索引保存失败，请联系客服核对。" }, evidenceWritten.status || 502);
  }

  const usedLink = {
    ...linkFile.value,
    status: "used",
    usedAt: now.toISOString(),
    paymentLogPath: logPath,
    paymentLogUrl: written.htmlUrl,
    evidenceIndexPath: evidenceWritten.path,
    evidenceIndexUrl: evidenceWritten.htmlUrl,
    certificatePdfPath: certificateRecord.path,
    certificatePdfUrl: certificateRecord.htmlUrl,
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
    htmlUrl: written.htmlUrl,
    documentNumber,
    certificatePdf: certificateRecord,
    evidenceIndex: {
      path: evidenceWritten.path,
      htmlUrl: evidenceWritten.htmlUrl,
      commitSha: evidenceWritten.commitSha
    }
  });
}
