import db from "../db.server";

export const RECYCLING_FEE_NAMESPACE = "$app:recycling_fee";
export const RECYCLING_FEE_KEY = "config";
export const RECYCLING_FEE_ATTRIBUTE = "_recycling_fee";
export const RECYCLING_FEE_PROVINCE_ATTRIBUTE = "_recycling_fee_province";
export const RECYCLING_FEE_STATE_OPTION = "State";

export const DEFAULT_RECYCLING_RATES = [
  { stateCode: "CA", stateName: "California", rate: 18, sku: "SSMRFCA" },
  { stateCode: "CT", stateName: "Connecticut", rate: 16, sku: "SSMRFCT" },
  { stateCode: "RI", stateName: "Rhode Island", rate: 22.5, sku: "SSMRFRI" },
  { stateCode: "OR", stateName: "Oregon", rate: 22.5, sku: "SSMRFOR" },
];

const DEFAULT_PRODUCT_TYPES = ["Mattresses"];
const DEFAULT_NOTICE_TITLE = "Mattress Recycling Fee";
const DEFAULT_EXPLANATION =
  "A state-mandated recycling fee may apply to each mattress, foundation, or bed frame in applicable states. The fee supports state mattress recycling programs.";
const DEFAULT_NOTICE_LINK_TEXT = "Learn more about mattress recycling";
const DEFAULT_NOTICE_LINK_URL = "https://egohome.com/pages/mattress-recycling-fee";

function normalizeNoticeText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeNoticeUrl(value) {
  const text = String(value ?? "").trim() || DEFAULT_NOTICE_LINK_URL;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_NOTICE_LINK_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_NOTICE_LINK_URL;
  }
}

const SHOP_ID_QUERY = `#graphql
  query RecyclingFeeOwner {
    shop { id }
  }
`;

const SET_CONFIG_MUTATION = `#graphql
  mutation SetRecyclingFeeConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

const CREATE_FEE_PRODUCT_MUTATION = `#graphql
  mutation CreateRecyclingFeeProduct($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        options { id name }
        variants(first: 20) {
          nodes { id sku }
        }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_STATE_QUERY = `#graphql
  query RecyclingFeeProductState($id: ID!) {
    product(id: $id) {
      id
      options { id name }
      variants(first: 50) {
        nodes {
          id
          sku
          price
          selectedOptions { name value }
        }
      }
    }
  }
`;

const PRODUCT_OPTION_UPDATE_MUTATION = `#graphql
  mutation RecyclingFeeOptionUpdate($productId: ID!, $option: OptionUpdateInput!) {
    productOptionUpdate(productId: $productId, option: $option) {
      userErrors { field message }
    }
  }
`;

const VARIANTS_CREATE_MUTATION = `#graphql
  mutation RecyclingFeeVariantsCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants { id sku }
      userErrors { field message }
    }
  }
`;

const VARIANTS_UPDATE_MUTATION = `#graphql
  mutation RecyclingFeeVariantsUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id sku price }
      userErrors { field message }
    }
  }
`;

const PUBLISH_PRODUCT_MUTATION = `#graphql
  mutation PublishRecyclingFeeProduct($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

const PUBLICATIONS_QUERY = `#graphql
  query RecyclingFeePublications {
    publications(first: 20) {
      nodes { id name }
    }
  }
`;

async function graphqlJson(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  return response.json();
}

function normalizeStateCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

function normalizeRate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeSku(value, stateCode) {
  const sku = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (sku) return sku;
  const code = normalizeStateCode(stateCode);
  return code ? `SSMRF${code}` : "";
}

function normalizeProductTypes(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);
  return list.length ? [...new Set(list)] : [...DEFAULT_PRODUCT_TYPES];
}

function defaultSkuForState(stateCode) {
  const match = DEFAULT_RECYCLING_RATES.find(
    (rate) => rate.stateCode === normalizeStateCode(stateCode),
  );
  return match?.sku || normalizeSku("", stateCode);
}

async function backfillMissingSkus(shop) {
  const rates = await db.recyclingFeeRate.findMany({ where: { shop } });
  await Promise.all(
    rates
      .filter((rate) => !String(rate.sku || "").trim())
      .map((rate) =>
        db.recyclingFeeRate.update({
          where: { id: rate.id },
          data: { sku: defaultSkuForState(rate.stateCode) },
        }),
      ),
  );
}

export async function ensureRecyclingFeeDefaults(shop) {
  const existingRates = await db.recyclingFeeRate.count({ where: { shop } });
  if (existingRates === 0) {
    await db.recyclingFeeRate.createMany({
      data: DEFAULT_RECYCLING_RATES.map((rate) => ({
        shop,
        stateCode: rate.stateCode,
        stateName: rate.stateName,
        rate: rate.rate,
        sku: rate.sku,
        isActive: true,
      })),
    });
  } else {
    await backfillMissingSkus(shop);
  }

  return db.recyclingFeeSettings.upsert({
    where: { shop },
    create: {
      shop,
      enabled: true,
      mattressProductTypes: DEFAULT_PRODUCT_TYPES,
      noticeTitle: DEFAULT_NOTICE_TITLE,
      explanation: DEFAULT_EXPLANATION,
      noticeLinkText: DEFAULT_NOTICE_LINK_TEXT,
      noticeLinkUrl: DEFAULT_NOTICE_LINK_URL,
    },
    update: {},
  });
}

export async function getRecyclingFeeAdminData(shop) {
  await ensureRecyclingFeeDefaults(shop);
  const [settings, rates] = await Promise.all([
    db.recyclingFeeSettings.findUnique({ where: { shop } }),
    db.recyclingFeeRate.findMany({
      where: { shop },
      orderBy: [{ stateCode: "asc" }],
    }),
  ]);

  return {
    settings: {
      enabled: settings?.enabled !== false,
      mattressProductTypes: normalizeProductTypes(settings?.mattressProductTypes),
      feeProductId: settings?.feeProductId || "",
      feeVariantId: settings?.feeVariantId || "",
      noticeTitle: settings?.noticeTitle || DEFAULT_NOTICE_TITLE,
      explanation: settings?.explanation || DEFAULT_EXPLANATION,
      noticeLinkText: settings?.noticeLinkText || DEFAULT_NOTICE_LINK_TEXT,
      noticeLinkUrl: settings?.noticeLinkUrl || DEFAULT_NOTICE_LINK_URL,
    },
    rates,
  };
}

export async function saveRecyclingFeeSettings(shop, data) {
  await ensureRecyclingFeeDefaults(shop);
  const noticeTitle = normalizeNoticeText(data.noticeTitle, DEFAULT_NOTICE_TITLE);
  const explanation = normalizeNoticeText(data.explanation, DEFAULT_EXPLANATION);
  const noticeLinkText = normalizeNoticeText(data.noticeLinkText, DEFAULT_NOTICE_LINK_TEXT);
  const noticeLinkUrl = normalizeNoticeUrl(data.noticeLinkUrl);

  return db.recyclingFeeSettings.upsert({
    where: { shop },
    create: {
      shop,
      enabled: data.enabled !== false,
      mattressProductTypes: normalizeProductTypes(data.mattressProductTypes),
      feeProductId: data.feeProductId || null,
      feeVariantId: data.feeVariantId || null,
      noticeTitle,
      explanation,
      noticeLinkText,
      noticeLinkUrl,
    },
    update: {
      enabled: data.enabled !== false,
      mattressProductTypes: normalizeProductTypes(data.mattressProductTypes),
      feeProductId: data.feeProductId || null,
      feeVariantId: data.feeVariantId || null,
      noticeTitle,
      explanation,
      noticeLinkText,
      noticeLinkUrl,
    },
  });
}

export async function upsertRecyclingFeeRate(shop, data) {
  await ensureRecyclingFeeDefaults(shop);
  const stateCode = normalizeStateCode(data.stateCode);
  if (stateCode.length !== 2) {
    throw new Error("州代码必须是 2 位字母，例如 CA");
  }
  const sku = normalizeSku(data.sku, stateCode);
  if (!sku) {
    throw new Error("SKU 不能为空");
  }

  return db.recyclingFeeRate.upsert({
    where: { shop_stateCode: { shop, stateCode } },
    create: {
      shop,
      stateCode,
      stateName: String(data.stateName || stateCode).trim() || stateCode,
      rate: normalizeRate(data.rate),
      sku,
      isActive: data.isActive !== false,
    },
    update: {
      stateName: String(data.stateName || stateCode).trim() || stateCode,
      rate: normalizeRate(data.rate),
      sku,
      isActive: data.isActive !== false,
    },
  });
}

export async function deleteRecyclingFeeRate(shop, id) {
  return db.recyclingFeeRate.deleteMany({ where: { id, shop } });
}

export async function toggleRecyclingFeeRate(shop, id, isActive) {
  return db.recyclingFeeRate.updateMany({
    where: { id, shop },
    data: { isActive: Boolean(isActive) },
  });
}

export function buildRecyclingFeeConfiguration(settings, rates) {
  const activeRates = rates.filter((rate) => rate.isActive && normalizeRate(rate.rate) > 0);
  return {
    version: 2,
    enabled: settings.enabled !== false,
    mattressProductTypes: normalizeProductTypes(settings.mattressProductTypes),
    feeProductId: settings.feeProductId || null,
    feeVariantId: settings.feeVariantId || null,
    noticeTitle: settings.noticeTitle || DEFAULT_NOTICE_TITLE,
    explanation: settings.explanation || DEFAULT_EXPLANATION,
    noticeLinkText: settings.noticeLinkText || DEFAULT_NOTICE_LINK_TEXT,
    noticeLinkUrl: settings.noticeLinkUrl || DEFAULT_NOTICE_LINK_URL,
    rates: Object.fromEntries(
      activeRates.map((rate) => {
        const stateCode = normalizeStateCode(rate.stateCode);
        return [
          stateCode,
          {
            rate: normalizeRate(rate.rate),
            sku: normalizeSku(rate.sku, stateCode),
            variantId: rate.variantId || null,
          },
        ];
      }),
    ),
  };
}

export async function syncRecyclingFeeConfig(admin, shop) {
  const { settings, rates } = await getRecyclingFeeAdminData(shop);
  const ownerData = await graphqlJson(admin, SHOP_ID_QUERY);
  const ownerId = ownerData.data?.shop?.id;
  if (!ownerId) throw new Error("无法读取店铺 ID，回收费配置未同步");

  const result = await graphqlJson(admin, SET_CONFIG_MUTATION, {
    metafields: [
      {
        ownerId,
        namespace: RECYCLING_FEE_NAMESPACE,
        key: RECYCLING_FEE_KEY,
        type: "json",
        value: JSON.stringify(buildRecyclingFeeConfiguration(settings, rates)),
      },
    ],
  });
  const errors = result.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`回收费配置同步失败：${errors.map((error) => error.message).join("; ")}`);
  }

  return buildRecyclingFeeConfiguration(settings, rates);
}

async function publishFeeProduct(admin, feeProductId) {
  try {
    const publications = await graphqlJson(admin, PUBLICATIONS_QUERY);
    const onlineStore = (publications.data?.publications?.nodes ?? []).find((item) =>
      /online store/i.test(item.name || ""),
    );
    if (onlineStore?.id) {
      await graphqlJson(admin, PUBLISH_PRODUCT_MUTATION, {
        id: feeProductId,
        input: [{ publicationId: onlineStore.id }],
      });
    }
  } catch (error) {
    console.warn("[RecyclingFee] publish skipped:", error.message);
  }
}

async function getFeeProductState(admin, productId) {
  const result = await graphqlJson(admin, PRODUCT_STATE_QUERY, { id: productId });
  return result.data?.product || null;
}

async function ensureStateOption(admin, productId, options) {
  const existing = (options || []).find(
    (option) => String(option.name || "").toLowerCase() === "state",
  );
  if (existing) return existing;
  if (!options?.length) {
    throw new Error("回收费商品缺少选项，无法同步州变体");
  }

  const option = options[0];
  const result = await graphqlJson(admin, PRODUCT_OPTION_UPDATE_MUTATION, {
    productId,
    option: {
      id: option.id,
      name: RECYCLING_FEE_STATE_OPTION,
    },
  });
  const errors = result.data?.productOptionUpdate?.userErrors ?? [];
  if (errors.length) {
    throw new Error(`更新回收费商品选项失败：${errors.map((error) => error.message).join("; ")}`);
  }
  return { ...option, name: RECYCLING_FEE_STATE_OPTION };
}

function variantInputForRate(rate, variantId = null) {
  const stateCode = normalizeStateCode(rate.stateCode);
  return {
    ...(variantId ? { id: variantId } : {}),
    price: normalizeRate(rate.rate).toFixed(2),
    inventoryItem: {
      sku: normalizeSku(rate.sku, stateCode),
      tracked: false,
      requiresShipping: false,
    },
    inventoryPolicy: "CONTINUE",
    optionValues: [
      {
        optionName: RECYCLING_FEE_STATE_OPTION,
        name: stateCode,
      },
    ],
  };
}

async function syncRecyclingFeeVariants(admin, shop, feeProductId) {
  const rates = await db.recyclingFeeRate.findMany({
    where: { shop, isActive: true },
    orderBy: [{ stateCode: "asc" }],
  });
  if (!rates.length) {
    return { feeVariantId: null };
  }

  let product = await getFeeProductState(admin, feeProductId);
  if (!product) {
    throw new Error("回收费商品不存在，请重新准备");
  }

  await ensureStateOption(admin, feeProductId, product.options);
  product = await getFeeProductState(admin, feeProductId);

  const variants = product?.variants?.nodes ?? [];
  const bySku = new Map(
    variants
      .filter((variant) => variant.sku)
      .map((variant) => [String(variant.sku).toUpperCase(), variant]),
  );
  const byState = new Map(
    variants.map((variant) => {
      const state = variant.selectedOptions?.find((option) =>
        /state/i.test(option.name || ""),
      )?.value;
      return [normalizeStateCode(state), variant];
    }),
  );

  const updates = [];
  const creates = [];

  for (const rate of rates) {
    const stateCode = normalizeStateCode(rate.stateCode);
    const sku = normalizeSku(rate.sku, stateCode);
    const existing =
      bySku.get(sku) ||
      byState.get(stateCode) ||
      (rates.indexOf(rate) === 0 && variants[0] ? variants[0] : null);

    if (existing?.id) {
      updates.push({ rate: { ...rate, sku, stateCode }, variantId: existing.id });
    } else {
      creates.push({ ...rate, sku, stateCode });
    }
  }

  if (updates.length) {
    const result = await graphqlJson(admin, VARIANTS_UPDATE_MUTATION, {
      productId: feeProductId,
      variants: updates.map(({ rate, variantId }) => variantInputForRate(rate, variantId)),
    });
    const errors = result.data?.productVariantsBulkUpdate?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`更新回收费变体失败：${errors.map((error) => error.message).join("; ")}`);
    }
  }

  if (creates.length) {
    const result = await graphqlJson(admin, VARIANTS_CREATE_MUTATION, {
      productId: feeProductId,
      variants: creates.map((rate) => variantInputForRate(rate)),
    });
    const errors = result.data?.productVariantsBulkCreate?.userErrors ?? [];
    if (errors.length) {
      throw new Error(`创建回收费变体失败：${errors.map((error) => error.message).join("; ")}`);
    }
  }

  const finalProduct = await getFeeProductState(admin, feeProductId);
  const finalVariants = finalProduct?.variants?.nodes ?? [];
  const finalBySku = new Map(
    finalVariants
      .filter((variant) => variant.sku)
      .map((variant) => [String(variant.sku).toUpperCase(), variant]),
  );
  const finalByState = new Map(
    finalVariants.map((variant) => {
      const state = variant.selectedOptions?.find((option) =>
        /state/i.test(option.name || ""),
      )?.value;
      return [normalizeStateCode(state), variant];
    }),
  );

  let firstVariantId = null;
  for (const rate of rates) {
    const stateCode = normalizeStateCode(rate.stateCode);
    const sku = normalizeSku(rate.sku, stateCode);
    const variant = finalBySku.get(sku) || finalByState.get(stateCode);
    if (!firstVariantId && variant?.id) firstVariantId = variant.id;
    await db.recyclingFeeRate.update({
      where: { id: rate.id },
      data: {
        sku,
        variantId: variant?.id || null,
      },
    });
  }

  return { feeVariantId: firstVariantId || finalVariants[0]?.id || null };
}

export async function ensureRecyclingFeeProduct(admin, shop) {
  await ensureRecyclingFeeDefaults(shop);
  let settings = await db.recyclingFeeSettings.findUnique({ where: { shop } });
  let feeProductId = settings?.feeProductId || null;

  if (!feeProductId) {
    const created = await graphqlJson(admin, CREATE_FEE_PRODUCT_MUTATION, {
      product: {
        title: "Mattress Recycling Fee",
        status: "ACTIVE",
        productType: "Fee",
        vendor: "Mattress Recycling Fee",
        descriptionHtml:
          "<p>State-mandated mattress recycling fee. Price is calculated at checkout based on shipping state.</p>",
        tags: ["recycling-fee", "do-not-discount"],
      },
    });
    const createErrors = created.data?.productCreate?.userErrors ?? [];
    if (createErrors.length) {
      throw new Error(`创建回收费商品失败：${createErrors.map((error) => error.message).join("; ")}`);
    }

    const product = created.data?.productCreate?.product;
    feeProductId = product?.id;
    if (!feeProductId) {
      throw new Error("创建回收费商品失败：未返回商品 ID");
    }

    await db.recyclingFeeSettings.update({
      where: { shop },
      data: { feeProductId },
    });
    await publishFeeProduct(admin, feeProductId);
  }

  const { feeVariantId } = await syncRecyclingFeeVariants(admin, shop, feeProductId);
  await db.recyclingFeeSettings.update({
    where: { shop },
    data: {
      feeProductId,
      feeVariantId: feeVariantId || null,
    },
  });

  return { feeProductId, feeVariantId };
}
