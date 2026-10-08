import "@shopify/ui-extensions/preact";
import {
  useAppMetafields,
  useAttributeValues,
  useCartLines,
  useShippingAddress,
} from "@shopify/ui-extensions/checkout/preact";
import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

const FEE_LINE_ATTRIBUTE = "_recycling_fee";
const FEE_AMOUNT_ATTRIBUTE = "_recycling_fee_amount";
const FEE_TITLE_ATTRIBUTE = "_recycling_fee_title";
const FEE_SKU_ATTRIBUTE = "_recycling_fee_sku";
const PROVINCE_ATTRIBUTE = "_recycling_fee_province";

type StateRate = {
  rate: number;
  sku?: string;
  variantId?: string | null;
};

type RecyclingFeeConfig = {
  enabled?: boolean;
  mattressProductTypes?: string[];
  feeVariantId?: string | null;
  noticeTitle?: string;
  explanation?: string;
  noticeLinkText?: string;
  noticeLinkUrl?: string;
  rates?: Record<string, number | StateRate>;
};

const DEFAULT_NOTICE_TITLE = "Mattress Recycling Fee";
const DEFAULT_EXPLANATION =
  "A state-mandated recycling fee may apply to each mattress, foundation, or bed frame in applicable states. The fee supports state mattress recycling programs.";
const DEFAULT_NOTICE_LINK_TEXT = "Learn more about mattress recycling";
const DEFAULT_NOTICE_LINK_URL = "https://egohome.com/pages/mattress-recycling-fee";

export default function extension() {
  render(<RecyclingFeeCheckout />, document.body);
}

function RecyclingFeeCheckout() {
  const shippingAddress = useShippingAddress();
  const cartLines = useCartLines();
  const appMetafields = useAppMetafields({
    namespace: "$app:recycling_fee",
    key: "config",
    type: "shop",
  });
  const [storedProvinceRaw] = useAttributeValues([PROVINCE_ATTRIBUTE]);
  const [syncError, setSyncError] = useState("");
  const syncChainRef = useRef(Promise.resolve());
  const provinceAttemptRef = useRef({ province: "", attempts: 0 });
  const addedFeeRef = useRef<{ variantId: string; province: string } | null>(null);

  const config = useMemo(() => parseConfig(appMetafields?.[0]?.metafield?.value), [appMetafields]);
  const province = normalizeStateCode(shippingAddress?.provinceCode);
  const storedProvince = normalizeStateCode(storedProvinceRaw);
  const stateRate = useMemo(() => getStateRate(config, province), [config, province]);
  const feeVariantId = stateRate?.variantId || "";
  const feeSku = stateRate?.sku || "";
  const feeRate = stateRate?.rate || 0;
  const mattressQty = useMemo(
    () => countMattressQuantity(cartLines, config),
    [cartLines, config],
  );
  const shouldCharge =
    Boolean(config.enabled) &&
    Boolean(feeVariantId) &&
    Boolean(province) &&
    feeRate > 0 &&
    mattressQty > 0;
  const totalFee = shouldCharge ? roundMoney(feeRate * mattressQty) : 0;
  const allFeeVariantIds = useMemo(() => collectFeeVariantIds(config), [config]);
  const feeLines = useMemo(
    () => findFeeLines(cartLines, allFeeVariantIds),
    [cartLines, allFeeVariantIds],
  );
  const expectedAmount = totalFee.toFixed(2);
  const expectedTitle = shouldCharge
    ? `Mattress Recycling Fee (${province}) × ${mattressQty}`
    : "";
  const canAddCartLine = shopify.instructions.value.lines?.canAddCartLine !== false;
  const canUpdateCartLine = shopify.instructions.value.lines?.canUpdateCartLine !== false;
  const canRemoveCartLine = shopify.instructions.value.lines?.canRemoveCartLine !== false;
  const matchingFeeLine = feeLines.find((line) => idsMatch(line?.merchandise?.id, feeVariantId));
  const extraFeeLines = feeLines.filter((line) => !idsMatch(line?.merchandise?.id, feeVariantId));
  const amountMismatch =
    Boolean(matchingFeeLine) &&
    lineAttribute(matchingFeeLine, FEE_AMOUNT_ATTRIBUTE) !== expectedAmount;
  const titleMismatch =
    Boolean(matchingFeeLine) &&
    lineAttribute(matchingFeeLine, FEE_TITLE_ATTRIBUTE) !== expectedTitle;
  const expectedQuantity = Math.max(mattressQty, 1);
  const quantityMismatch =
    Boolean(matchingFeeLine) && Number(matchingFeeLine.quantity) !== expectedQuantity;
  const duplicateFeeLine =
    feeLines.filter((line) => idsMatch(line?.merchandise?.id, feeVariantId)).length > 1;
  const hasFeeLine = Boolean(matchingFeeLine);
  const needsSync = shouldCharge
    ? (!hasFeeLine && canAddCartLine) ||
      ((extraFeeLines.length > 0 || duplicateFeeLine) && canRemoveCartLine) ||
      ((amountMismatch || titleMismatch || quantityMismatch) && canUpdateCartLine)
    : feeLines.length > 0 && canRemoveCartLine;
  const needsProvinceSync = storedProvince !== province;

  useEffect(() => {
    if (!needsProvinceSync) {
      provinceAttemptRef.current = { province, attempts: 0 };
      return;
    }
    if (provinceAttemptRef.current.province !== province) {
      provinceAttemptRef.current = { province, attempts: 0 };
    }
    if (provinceAttemptRef.current.attempts >= 3) return;
    provinceAttemptRef.current.attempts += 1;

    let cancelled = false;
    syncChainRef.current = syncChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        await persistShippingProvince(province);
      });

    return () => {
      cancelled = true;
    };
  }, [needsProvinceSync, province]);

  useEffect(() => {
    if (matchingFeeLine && province && feeVariantId) {
      addedFeeRef.current = { variantId: feeVariantId, province };
    }
  }, [matchingFeeLine, province, feeVariantId]);

  useEffect(() => {
    const added = addedFeeRef.current;
    if (!added || !province || province === added.province) return;
    addedFeeRef.current = null;
  }, [province]);

  useEffect(() => {
    if (!needsSync) {
      setSyncError("");
      return;
    }

    let cancelled = false;
    const snapshot = {
      shouldCharge,
      province,
      feeVariantId,
      feeSku,
      mattressQty,
      expectedQuantity,
      expectedAmount,
      expectedTitle,
      feeLines,
    };

    syncChainRef.current = syncChainRef.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled) return;
        setSyncError("");
        try {
          await syncRecyclingFeeLine(snapshot, addedFeeRef);
        } catch (error) {
          if (cancelled) return;
          setSyncError(error instanceof Error ? error.message : "Unable to sync recycling fee");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    needsSync,
    shouldCharge,
    province,
    feeVariantId,
    feeSku,
    mattressQty,
    expectedQuantity,
    expectedAmount,
    expectedTitle,
    feeLines,
  ]);

  if (!shouldCharge) {
    return syncError ? (
      <s-banner tone="warning" heading="Recycling fee">
        {syncError}
      </s-banner>
    ) : null;
  }

  const title = config.noticeTitle?.trim() || DEFAULT_NOTICE_TITLE;
  const explanation = config.explanation?.trim() || DEFAULT_EXPLANATION;
  const linkText = config.noticeLinkText?.trim() || DEFAULT_NOTICE_LINK_TEXT;
  const linkUrl = config.noticeLinkUrl?.trim() || DEFAULT_NOTICE_LINK_URL;

  return (
    <s-box padding="base" border="base" borderRadius="base" background="subdued">
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small" alignItems="center">
          <s-icon type="info" />
          <s-text type="strong">{title}</s-text>
        </s-stack>
        <s-text>{explanation}</s-text>
        <s-link href={linkUrl}>{linkText}</s-link>
        {syncError ? <s-text tone="critical">{syncError}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

async function syncRecyclingFeeLine(
  {
    shouldCharge,
    province,
    feeVariantId,
    feeSku,
    expectedQuantity,
    expectedAmount,
    expectedTitle,
    feeLines,
  }: {
    shouldCharge: boolean;
    province: string;
    feeVariantId: string;
    feeSku: string;
    expectedQuantity: number;
    expectedAmount: string;
    expectedTitle: string;
    feeLines: any[];
  },
  addedFeeRef: { current: { variantId: string; province: string } | null },
) {
  const canAdd = shopify.instructions.value.lines?.canAddCartLine !== false;
  const canUpdate = shopify.instructions.value.lines?.canUpdateCartLine !== false;
  const canRemove = shopify.instructions.value.lines?.canRemoveCartLine !== false;

  await persistShippingProvince(province);

  if (!shouldCharge) {
    if (!canRemove) return;
    for (const line of feeLines) {
      const result = await shopify.applyCartLinesChange({
        type: "removeCartLine",
        id: line.id,
        quantity: line.quantity,
      });
      if (result.type === "error") {
        throw new Error(result.message);
      }
    }
    return;
  }

  if (!feeVariantId) return;

  const feeAttributes = [
    { key: FEE_LINE_ATTRIBUTE, value: "true" },
    { key: PROVINCE_ATTRIBUTE, value: province },
    { key: FEE_AMOUNT_ATTRIBUTE, value: expectedAmount },
    { key: FEE_TITLE_ATTRIBUTE, value: expectedTitle },
    ...(feeSku ? [{ key: FEE_SKU_ATTRIBUTE, value: feeSku }] : []),
  ];

  const sameVariantLines = feeLines.filter((line) =>
    idsMatch(line?.merchandise?.id, feeVariantId),
  );
  const matchingLine = sameVariantLines[0];
  const removableLines = [
    ...feeLines.filter((line) => !idsMatch(line?.merchandise?.id, feeVariantId)),
    ...sameVariantLines.slice(1),
  ];

  if (canRemove) {
    for (const line of removableLines) {
      const result = await shopify.applyCartLinesChange({
        type: "removeCartLine",
        id: line.id,
        quantity: line.quantity,
      });
      if (result.type === "error") {
        throw new Error(result.message);
      }
    }
  }

  if (!matchingLine) {
    if (!canAdd) {
      // Shop Pay cannot add a standalone fee line. Persist the shipping
      // province so Cart Transform can expand the fee onto a mattress line.
      return;
    }
    if (isSameAddedFee(addedFeeRef.current, feeVariantId, province)) return;
    addedFeeRef.current = { variantId: feeVariantId, province };
    let result;
    try {
      result = await shopify.applyCartLinesChange({
        type: "addCartLine",
        merchandiseId: feeVariantId,
        quantity: expectedQuantity,
        attributes: feeAttributes,
      });
    } catch (error) {
      addedFeeRef.current = null;
      throw error;
    }
    if (result.type === "error") {
      addedFeeRef.current = null;
      throw new Error(result.message);
    }
    return;
  }

  addedFeeRef.current = { variantId: feeVariantId, province };
  const currentAmount = lineAttribute(matchingLine, FEE_AMOUNT_ATTRIBUTE);
  const currentTitle = lineAttribute(matchingLine, FEE_TITLE_ATTRIBUTE);
  const needsUpdate =
    Number(matchingLine.quantity) !== expectedQuantity ||
    currentAmount !== expectedAmount ||
    currentTitle !== expectedTitle;
  if (needsUpdate && canUpdate) {
    const result = await shopify.applyCartLinesChange({
      type: "updateCartLine",
      id: matchingLine.id,
      quantity: expectedQuantity,
      attributes: feeAttributes,
    });
    if (result.type === "error") {
      throw new Error(result.message);
    }
  }
}

async function persistShippingProvince(province: string) {
  try {
    const result = province
      ? await shopify.applyAttributeChange({
          type: "updateAttribute",
          key: PROVINCE_ATTRIBUTE,
          value: province,
        })
      : await shopify.applyAttributeChange({
          type: "removeAttribute",
          key: PROVINCE_ATTRIBUTE,
        });
    if (result?.type === "error") return false;
    return true;
  } catch {
    return false;
  }
}

function isSameAddedFee(
  added: { variantId: string; province: string } | null,
  variantId: string,
  province: string,
) {
  return Boolean(
    added && added.province === province && idsMatch(added.variantId, variantId),
  );
}

function parseConfig(value: unknown): RecyclingFeeConfig {
  if (!value) return { enabled: false, rates: {} };
  if (typeof value === "object") return value as RecyclingFeeConfig;
  try {
    return JSON.parse(String(value)) as RecyclingFeeConfig;
  } catch {
    return { enabled: false, rates: {} };
  }
}

function getStateRate(config: RecyclingFeeConfig, province: string): StateRate | null {
  if (!province) return null;
  const raw = config.rates?.[province];
  if (raw == null) return null;
  if (typeof raw === "number") {
    return {
      rate: Number(raw) || 0,
      variantId: config.feeVariantId || null,
    };
  }
  return {
    rate: Number(raw.rate) || 0,
    sku: raw.sku || "",
    variantId: raw.variantId || config.feeVariantId || null,
  };
}

function collectFeeVariantIds(config: RecyclingFeeConfig) {
  const ids = new Set<string>();
  if (config.feeVariantId) ids.add(config.feeVariantId);
  for (const value of Object.values(config.rates || {})) {
    if (value && typeof value === "object" && value.variantId) {
      ids.add(String(value.variantId));
    }
  }
  return [...ids];
}

function normalizeStateCode(value?: string | null) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function countMattressQuantity(cartLines: any[], config: RecyclingFeeConfig) {
  const types = new Set(
    (config.mattressProductTypes || [])
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean),
  );
  if (!types.size) return 0;
  const feeVariantIds = collectFeeVariantIds(config);

  return cartLines.reduce((total, line) => {
    if (isFeeLine(line, feeVariantIds)) return total;
    const productType = String(line?.merchandise?.product?.productType || "")
      .trim()
      .toLowerCase();
    if (!types.has(productType)) return total;
    return total + Number(line.quantity || 0);
  }, 0);
}

function findFeeLines(cartLines: any[], feeVariantIds: string[]) {
  return cartLines.filter((line) => isFeeLine(line, feeVariantIds));
}

function lineAttribute(line: any, key: string) {
  const attrs = line?.attributes || [];
  const match = attrs.find((attr: any) => attr?.key === key);
  return match?.value ? String(match.value) : "";
}

function isFeeLine(line: any, feeVariantIds: string[] = []) {
  const attrs = line?.attributes || [];
  if (attrs.some((attr: any) => attr?.key === FEE_LINE_ATTRIBUTE && attr?.value === "true")) {
    return true;
  }
  return feeVariantIds.some((variantId) => idsMatch(line?.merchandise?.id, variantId));
}

function idsMatch(left?: string | null, right?: string | null) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = String(left).split("/").pop();
  const rightId = String(right).split("/").pop();
  return Boolean(leftId && rightId && leftId === rightId);
}
