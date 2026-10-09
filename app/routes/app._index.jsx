import { useEffect, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getRecyclingFeeCartTransformStatus } from "../lib/setupRecyclingFeeCartTransform.server";
import {
  deleteRecyclingFeeRate,
  ensureRecyclingFeeProduct,
  getRecyclingFeeAdminData,
  saveRecyclingFeeSettings,
  syncRecyclingFeeConfig,
  toggleRecyclingFeeRate,
  upsertRecyclingFeeRate,
} from "../models/recycling-fee.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    await ensureRecyclingFeeProduct(admin, session.shop);
    await syncRecyclingFeeConfig(admin, session.shop);
  } catch (error) {
    console.error("[RecyclingFee] setup/sync failed:", error);
  }

  const [data, cartTransformStatus] = await Promise.all([
    getRecyclingFeeAdminData(session.shop),
    getRecyclingFeeCartTransformStatus(admin),
  ]);
  return { ...data, cartTransformStatus };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const body = await request.json();

  try {
    if (body.intent === "saveSettings") {
      await saveRecyclingFeeSettings(session.shop, body);
      await ensureRecyclingFeeProduct(admin, session.shop);
      await syncRecyclingFeeConfig(admin, session.shop);
      return { ok: true, message: "设置已保存并同步", ...(await getRecyclingFeeAdminData(session.shop)) };
    }

    if (body.intent === "upsertRate") {
      await upsertRecyclingFeeRate(session.shop, body);
      await ensureRecyclingFeeProduct(admin, session.shop);
      await syncRecyclingFeeConfig(admin, session.shop);
      return { ok: true, message: "州费率已保存并同步 SKU 变体", ...(await getRecyclingFeeAdminData(session.shop)) };
    }

    if (body.intent === "toggleRate") {
      await toggleRecyclingFeeRate(session.shop, body.id, body.isActive);
      await ensureRecyclingFeeProduct(admin, session.shop);
      await syncRecyclingFeeConfig(admin, session.shop);
      return { ok: true, message: "州费率状态已更新", ...(await getRecyclingFeeAdminData(session.shop)) };
    }

    if (body.intent === "deleteRate") {
      await deleteRecyclingFeeRate(session.shop, body.id);
      await syncRecyclingFeeConfig(admin, session.shop);
      return { ok: true, message: "州费率已删除", ...(await getRecyclingFeeAdminData(session.shop)) };
    }

    if (body.intent === "ensureProduct") {
      await ensureRecyclingFeeProduct(admin, session.shop);
      await syncRecyclingFeeConfig(admin, session.shop);
      return { ok: true, message: "回收费商品与州 SKU 变体已准备完成", ...(await getRecyclingFeeAdminData(session.shop)) };
    }

    return { ok: false, error: "未知操作" };
  } catch (error) {
    return { ok: false, error: error.message, ...(await getRecyclingFeeAdminData(session.shop)) };
  }
};

function StatusCard({ label, children, caption }) {
  return (
    <s-box padding="base" border="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="small-300">
        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
          <s-text color="subdued">{label}</s-text>
          <s-stack direction="inline" gap="small-200" alignItems="center">
            {children}
          </s-stack>
        </s-stack>
        {caption && <s-text color="subdued">{caption}</s-text>}
      </s-stack>
    </s-box>
  );
}

export default function RecyclingFeesPage() {
  const initial = useLoaderData();
  const fetcher = useFetcher();
  const [enabled, setEnabled] = useState(initial.settings.enabled);
  const [mattressProductTypes, setMattressProductTypes] = useState(
    initial.settings.mattressProductTypes.join(", "),
  );
  const [noticeTitle, setNoticeTitle] = useState(initial.settings.noticeTitle);
  const [explanation, setExplanation] = useState(initial.settings.explanation);
  const [noticeLinkText, setNoticeLinkText] = useState(initial.settings.noticeLinkText);
  const [noticeLinkUrl, setNoticeLinkUrl] = useState(initial.settings.noticeLinkUrl);
  const [stateCode, setStateCode] = useState("");
  const [stateName, setStateName] = useState("");
  const [rate, setRate] = useState("");
  const [sku, setSku] = useState("");

  const rates = fetcher.data?.rates || initial.rates;
  const settings = fetcher.data?.settings || initial.settings;
  const busy = fetcher.state !== "idle";
  const notice = fetcher.data?.message || fetcher.data?.error;
  const noticeTone = fetcher.data?.ok === false ? "critical" : "success";
  const pending = busy ? fetcher.json : null;
  const isPending = (intent, id) =>
    pending?.intent === intent && (id === undefined || pending?.id === id);
  const activeRateCount = rates.filter((item) => item.isActive).length;
  const transformReady = initial.cartTransformStatus?.status === "ready";

  useEffect(() => {
    if (!fetcher.data?.settings) return;
    setEnabled(fetcher.data.settings.enabled);
    setMattressProductTypes(fetcher.data.settings.mattressProductTypes.join(", "));
    setNoticeTitle(fetcher.data.settings.noticeTitle);
    setExplanation(fetcher.data.settings.explanation);
    setNoticeLinkText(fetcher.data.settings.noticeLinkText);
    setNoticeLinkUrl(fetcher.data.settings.noticeLinkUrl);
  }, [fetcher.data?.settings]);

  function submit(payload) {
    fetcher.submit(payload, {
      method: "POST",
      encType: "application/json",
    });
  }

  function saveSettings() {
    submit({
      intent: "saveSettings",
      enabled,
      mattressProductTypes,
      noticeTitle,
      explanation,
      noticeLinkText,
      noticeLinkUrl,
      feeProductId: settings.feeProductId,
      feeVariantId: settings.feeVariantId,
    });
  }

  function upsertRate() {
    submit({
      intent: "upsertRate",
      stateCode,
      stateName,
      rate,
      sku,
      isActive: true,
    });
    setStateCode("");
    setStateName("");
    setRate("");
    setSku("");
  }

  return (
    <s-page heading="床垫回收费" inlineSize="large">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={busy || undefined}
        loading={isPending("saveSettings") || undefined}
        onClick={saveSettings}
      >
        保存设置
      </s-button>
      <s-button
        slot="secondary-actions"
        disabled={busy || undefined}
        loading={isPending("ensureProduct") || undefined}
        onClick={() => submit({ intent: "ensureProduct" })}
      >
        同步州 SKU 变体
      </s-button>

      {!transformReady && (
        <s-banner tone="warning" heading="快捷支付回收费未就绪">
          {initial.cartTransformStatus?.message}
        </s-banner>
      )}

      {notice && (
        <s-banner tone={noticeTone} heading={fetcher.data?.ok === false ? "操作失败" : "操作成功"}>
          {notice}
        </s-banner>
      )}

      <s-query-container>
        <s-stack direction="block" gap="base">
          <s-grid
            gridTemplateColumns="@container (inline-size > 720px) repeat(4, minmax(0, 1fr)), repeat(2, minmax(0, 1fr))"
            gap="base"
          >
            <StatusCard label="回收费">
              <s-badge tone={settings.enabled ? "success" : "critical"}>
                {settings.enabled ? "启用" : "停用"}
              </s-badge>
            </StatusCard>
            <StatusCard label="收费州">
              <s-text type="strong">
                {activeRateCount} / {rates.length}
              </s-text>
              <s-text color="subdued">启用</s-text>
            </StatusCard>
            <StatusCard label="回收费商品">
              <s-badge tone={settings.feeProductId ? "success" : "warning"}>
                {settings.feeProductId ? "已创建" : "尚未创建"}
              </s-badge>
            </StatusCard>
            <StatusCard label="快捷支付">
              <s-badge tone={transformReady ? "success" : "warning"}>
                {transformReady ? "已就绪" : "未就绪"}
              </s-badge>
            </StatusCard>
          </s-grid>

          <s-grid
            gridTemplateColumns="@container (inline-size > 720px) minmax(0, 3fr) minmax(0, 2fr), minmax(0, 1fr)"
            gap="base"
          >
            <s-section heading="功能设置">
              <s-stack direction="block" gap="base">
                <s-switch
                  label="启用回收费"
                  checked={enabled || undefined}
                  onChange={(event) => setEnabled(Boolean(event.target.checked))}
                />
                <s-text-field
                  label="床垫 product type（逗号分隔）"
                  details="仅统计匹配这些 product type 的商品数量。默认 Mattresses"
                  value={mattressProductTypes}
                  onInput={(event) => setMattressProductTypes(event.target.value)}
                />
              </s-stack>
            </s-section>

            <s-section heading="计费规则">
              <s-stack direction="block" gap="small-200">
                <s-box padding="small-200" borderRadius="base" background="subdued">
                  <s-text type="strong">回收费 = 床垫数量 × 对应州费率</s-text>
                </s-box>
                <s-unordered-list>
                  <s-list-item>每个州对应独立 SKU 变体（如 CA → SSMRFCA）。</s-list-item>
                  <s-list-item>结账时按收货州添加对应 SKU；未配置的州不收费。</s-list-item>
                </s-unordered-list>
                <s-text color="subdued">回收费商品：{settings.feeProductId || "尚未创建"}</s-text>
              </s-stack>
            </s-section>
          </s-grid>

          <s-section heading="州费率 / SKU">
            <s-stack direction="block" gap="base">
              <s-box padding="base" border="base" borderRadius="base" background="subdued">
                <s-grid
                  gridTemplateColumns="@container (inline-size > 720px) minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr) auto, repeat(2, minmax(0, 1fr))"
                  gap="base"
                  alignItems="end"
                >
                  <s-text-field
                    label="州代码"
                    placeholder="CA"
                    value={stateCode}
                    onInput={(event) => {
                      const next = event.target.value;
                      setStateCode(next);
                      if (!sku) {
                        const code = String(next || "")
                          .trim()
                          .toUpperCase()
                          .replace(/[^A-Z]/g, "")
                          .slice(0, 2);
                        if (code.length === 2) setSku(`SSMRF${code}`);
                      }
                    }}
                  />
                  <s-text-field
                    label="州名称"
                    placeholder="California"
                    value={stateName}
                    onInput={(event) => setStateName(event.target.value)}
                  />
                  <s-number-field
                    label="费率 / 件（USD）"
                    min={0}
                    step={0.01}
                    value={rate}
                    onInput={(event) => setRate(event.target.value)}
                  />
                  <s-text-field
                    label="SKU"
                    placeholder="SSMRFCA"
                    value={sku}
                    onInput={(event) => setSku(event.target.value)}
                  />
                  <s-button
                    variant="primary"
                    disabled={busy || undefined}
                    loading={isPending("upsertRate") || undefined}
                    onClick={upsertRate}
                  >
                    添加 / 更新
                  </s-button>
                </s-grid>
              </s-box>

              {rates.length === 0 ? (
                <s-box padding="base" border="base" borderRadius="base">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text type="strong">暂无州费率</s-text>
                    <s-text color="subdued">在上方填写州代码和费率后添加。</s-text>
                  </s-stack>
                </s-box>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">州</s-table-header>
                    <s-table-header listSlot="labeled" format="currency">
                      费率/件
                    </s-table-header>
                    <s-table-header listSlot="labeled">SKU</s-table-header>
                    <s-table-header listSlot="secondary">状态</s-table-header>
                    <s-table-header listSlot="labeled">变体</s-table-header>
                    <s-table-header>操作</s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {rates.map((item) => (
                      <s-table-row key={item.id}>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-text type="strong">{item.stateCode}</s-text>
                            <s-text color="subdued">{item.stateName}</s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>${Number(item.rate).toFixed(2)}</s-table-cell>
                        <s-table-cell>{item.sku || "-"}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={item.isActive ? "success" : "neutral"}>
                            {item.isActive ? "启用" : "停用"}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <s-text color="subdued">{item.variantId || "尚未同步"}</s-text>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200">
                            <s-button
                              variant="tertiary"
                              disabled={busy || undefined}
                              loading={isPending("toggleRate", item.id) || undefined}
                              onClick={() =>
                                submit({
                                  intent: "toggleRate",
                                  id: item.id,
                                  isActive: !item.isActive,
                                })
                              }
                            >
                              {item.isActive ? "停用" : "启用"}
                            </s-button>
                            <s-button
                              tone="critical"
                              variant="tertiary"
                              disabled={busy || undefined}
                              loading={isPending("deleteRate", item.id) || undefined}
                              onClick={() => submit({ intent: "deleteRate", id: item.id })}
                            >
                              删除
                            </s-button>
                          </s-stack>
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          </s-section>

          <s-section heading="结账说明文案">
            <s-grid
              gridTemplateColumns="@container (inline-size > 720px) minmax(0, 1fr) minmax(0, 1fr), minmax(0, 1fr)"
              gap="base"
            >
              <s-stack direction="block" gap="base">
                <s-text-field
                  label="标题"
                  value={noticeTitle}
                  onInput={(event) => setNoticeTitle(event.target.value)}
                />
                <s-text-field
                  label="跳转链接文案"
                  value={noticeLinkText}
                  onInput={(event) => setNoticeLinkText(event.target.value)}
                />
                <s-url-field
                  label="跳转地址"
                  value={noticeLinkUrl}
                  onInput={(event) => setNoticeLinkUrl(event.target.value)}
                />
              </s-stack>
              <s-text-area
                label="说明文案"
                rows={8}
                value={explanation}
                onInput={(event) => setExplanation(event.target.value)}
              />
            </s-grid>
          </s-section>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
