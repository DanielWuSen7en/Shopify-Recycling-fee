import { getRecyclingFeeAdminData } from "./recycling-fee.server";
import { normalizeStatsRange } from "../lib/stats-ranges";

const ORDERS_PER_PAGE = 25;
const MAX_ORDER_PAGES = 20;
const RECENT_ORDER_LIMIT = 8;

const FEE_ORDERS_QUERY = `#graphql
  query RecyclingFeeOrderStats($query: String!, $after: String) {
    orders(first: ${ORDERS_PER_PAGE}, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        createdAt
        cancelledAt
        test
        currencyCode
        lineItems(first: 30) {
          nodes {
            sku
            quantity
            currentQuantity
            variant { id }
            product { productType }
            discountedUnitPriceAfterAllDiscountsSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`;

const ORDERS_COUNT_QUERY = `#graphql
  query RecyclingFeeOrderTotals($query: String!) {
    ordersCount(query: $query, limit: null) { count precision }
  }
`;

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function buildDailySeries(since, days) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(since.getTime() + index * 86400000);
    return { date: dayKey(date), amount: 0, orders: 0, units: 0 };
  });
}

function rateSummary(rates) {
  const active = rates.filter((rate) => rate.isActive);
  const values = active.map((rate) => Number(rate.rate) || 0);
  return {
    total: rates.length,
    active: active.length,
    synced: active.filter((rate) => rate.variantId).length,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
    average: values.length ? roundMoney(values.reduce((sum, v) => sum + v, 0) / values.length) : 0,
  };
}

async function graphqlJson(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

export async function getRecyclingFeeStats(admin, session, rangeDays) {
  const { settings, rates } = await getRecyclingFeeAdminData(session.shop);
  const days = normalizeStatsRange(rangeDays);
  const since = startOfUtcDay(new Date(Date.now() - (days - 1) * 86400000));
  const daily = buildDailySeries(since, days);
  const dailyByKey = new Map(daily.map((item) => [item.date, item]));

  const base = {
    range: days,
    since: dayKey(since),
    enabled: settings.enabled,
    rateSummary: rateSummary(rates),
    currency: "USD",
    totalOrders: 0,
    feeOrders: 0,
    feeUnits: 0,
    feeAmount: 0,
    matchedOrders: 0,
    testOrders: 0,
    cancelledOrders: 0,
    truncated: false,
    daily,
    states: [],
    recentOrders: [],
    ordersError: null,
  };

  const grantedScopes = String(session.scope || "").split(",").map((scope) => scope.trim());
  if (!grantedScopes.includes("read_orders")) {
    return { ...base, ordersError: "missing_scope" };
  }

  const stateBySku = new Map();
  const stateByVariant = new Map();
  for (const rate of rates) {
    if (rate.sku) stateBySku.set(String(rate.sku).toUpperCase(), rate.stateCode);
    if (rate.variantId) stateByVariant.set(rate.variantId, rate.stateCode);
  }
  const stateNames = new Map(rates.map((rate) => [rate.stateCode, rate.stateName]));
  const mattressTypes = new Set(
    settings.mattressProductTypes.map((type) => String(type).trim().toLowerCase()),
  );

  const dateFilter = `created_at:>='${since.toISOString()}'`;
  const skus = [...stateBySku.keys()];

  try {
    const totals = await graphqlJson(admin, ORDERS_COUNT_QUERY, { query: dateFilter });
    base.totalOrders = totals?.ordersCount?.count ?? 0;
    if (!skus.length) return base;

    const query = `${dateFilter} AND (${skus.map((sku) => `sku:${sku}`).join(" OR ")})`;
    const byState = new Map();
    let after = null;

    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const data = await graphqlJson(admin, FEE_ORDERS_QUERY, { query, after });
      const connection = data?.orders;

      for (const order of connection?.nodes ?? []) {
        if (order.cancelledAt) {
          base.cancelledOrders += 1;
          continue;
        }

        let feeUnits = 0;
        let feeAmount = 0;
        let mattressUnits = 0;
        let stateCode = null;

        for (const line of order.lineItems?.nodes ?? []) {
          const quantity = Number(line.currentQuantity ?? line.quantity) || 0;
          const lineState =
            stateByVariant.get(line.variant?.id) ||
            stateBySku.get(String(line.sku || "").toUpperCase());

          if (lineState) {
            const unit = Number(line.discountedUnitPriceAfterAllDiscountsSet?.shopMoney?.amount) || 0;
            feeUnits += quantity;
            feeAmount += unit * quantity;
            stateCode = stateCode || lineState;
          } else if (mattressTypes.has(String(line.product?.productType || "").trim().toLowerCase())) {
            mattressUnits += quantity;
          }
        }

        if (!feeUnits) continue;

        feeAmount = roundMoney(feeAmount);
        base.currency = order.currencyCode || base.currency;
        base.feeOrders += 1;
        base.feeUnits += feeUnits;
        base.feeAmount += feeAmount;
        if (order.test) base.testOrders += 1;
        if (feeUnits === mattressUnits) base.matchedOrders += 1;

        const bucket = dailyByKey.get(order.createdAt.slice(0, 10));
        if (bucket) {
          bucket.amount = roundMoney(bucket.amount + feeAmount);
          bucket.orders += 1;
          bucket.units += feeUnits;
        }

        const state = byState.get(stateCode) || {
          stateCode,
          stateName: stateNames.get(stateCode) || stateCode,
          orders: 0,
          units: 0,
          amount: 0,
        };
        state.orders += 1;
        state.units += feeUnits;
        state.amount = roundMoney(state.amount + feeAmount);
        byState.set(stateCode, state);

        if (base.recentOrders.length < RECENT_ORDER_LIMIT) {
          base.recentOrders.push({
            id: order.id,
            name: order.name,
            createdAt: order.createdAt,
            stateCode,
            feeUnits,
            mattressUnits,
            feeAmount,
            test: order.test,
          });
        }
      }

      if (!connection?.pageInfo?.hasNextPage) break;
      after = connection.pageInfo.endCursor;
      if (page === MAX_ORDER_PAGES - 1) base.truncated = true;
    }

    base.feeAmount = roundMoney(base.feeAmount);
    base.states = [...byState.values()].sort((a, b) => b.amount - a.amount);
    return base;
  } catch (error) {
    console.error("[RecyclingFee] order stats failed:", error);
    return { ...base, ordersError: error.message };
  }
}
