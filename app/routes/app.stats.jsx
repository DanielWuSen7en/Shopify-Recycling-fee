import { useLoaderData, useNavigate, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getRecyclingFeeStats } from "../models/recycling-fee-stats.server";
import { STATS_RANGES, normalizeStatsRange } from "../lib/stats-ranges";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const range = normalizeStatsRange(new URL(request.url).searchParams.get("range"));
  return getRecyclingFeeStats(admin, session, range);
};

const FONT = '-apple-system, BlinkMacSystemFont, "San Francisco", "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const PALETTE = ["#2563eb", "#0891b2", "#7c3aed", "#059669", "#ea580c", "#db2777"];
const HERO_GRADIENTS = [
  "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
  "linear-gradient(135deg, #0891b2 0%, #22d3ee 100%)",
  "linear-gradient(135deg, #059669 0%, #34d399 100%)",
  "linear-gradient(135deg, #4f46e5 0%, #818cf8 100%)",
];

function formatMoney(value, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value || 0);
}

function percent(part, whole) {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 1000) / 10) : 0;
}

function HeroCard({ label, value, caption, gradient }) {
  return (
    <div
      style={{
        background: gradient,
        borderRadius: 12,
        padding: "16px 18px",
        color: "#fff",
        fontFamily: FONT,
        position: "relative",
        overflow: "hidden",
        minHeight: 96,
      }}
    >
      <div
        style={{
          position: "absolute",
          right: -18,
          top: -18,
          width: 96,
          height: 96,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.14)",
        }}
      />
      <div style={{ fontSize: 13, opacity: 0.9, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 12, opacity: 0.85, whiteSpace: "nowrap" }}>{caption}</div>
    </div>
  );
}

function BarChart({ data, currency }) {
  const max = Math.max(...data.map((item) => item.amount), 0);
  const labelEvery = Math.ceil(data.length / 10);
  return (
    <div style={{ fontFamily: FONT }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: data.length > 31 ? 2 : 4,
          height: 180,
          padding: "8px 0",
          borderBottom: "1px solid #e3e3e3",
          backgroundImage: "linear-gradient(#f1f1f1 1px, transparent 1px)",
          backgroundSize: "100% 45px",
        }}
      >
        {data.map((item) => (
          <div
            key={item.date}
            title={`${item.date}  ${formatMoney(item.amount, currency)} · ${item.orders} 单 · ${item.units} 件`}
            style={{
              flex: 1,
              height: `${max > 0 ? Math.max((item.amount / max) * 100, item.amount > 0 ? 3 : 0) : 0}%`,
              background: "linear-gradient(180deg, #3b82f6 0%, #93c5fd 100%)",
              borderRadius: "4px 4px 0 0",
              minWidth: 2,
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", gap: data.length > 31 ? 2 : 4, marginTop: 6 }}>
        {data.map((item, index) => (
          <div
            key={item.date}
            style={{ flex: 1, fontSize: 11, color: "#8a8a8a", textAlign: "center", whiteSpace: "nowrap", overflow: "visible" }}
          >
            {index % labelEvery === 0 ? item.date.slice(5) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function Gauge({ value, label, caption, color }) {
  const radius = 52;
  const length = Math.PI * radius;
  const ratio = Math.max(0, Math.min(100, value)) / 100;
  const angle = -90 + ratio * 180;
  return (
    <div style={{ textAlign: "center", fontFamily: FONT }}>
      <svg viewBox="0 0 132 80" style={{ width: "100%", maxWidth: 180 }}>
        <path d="M 14 70 A 52 52 0 0 1 118 70" fill="none" stroke="#eef2f7" strokeWidth="12" strokeLinecap="round" />
        <path
          d="M 14 70 A 52 52 0 0 1 118 70"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${length * ratio} ${length}`}
        />
        <g transform={`rotate(${angle} 66 70)`}>
          <line x1="66" y1="70" x2="66" y2="30" stroke="#303030" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="66" cy="70" r="5" fill="#303030" />
      </svg>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#303030" }}>{value}%</div>
      <div style={{ fontSize: 13, color: "#303030", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontSize: 12, color: "#8a8a8a", whiteSpace: "nowrap" }}>{caption}</div>
    </div>
  );
}

function ProgressBar({ value, color }) {
  return (
    <div style={{ height: 8, borderRadius: 4, background: "#eef2f7", overflow: "hidden" }}>
      <div style={{ width: `${value}%`, height: "100%", borderRadius: 4, background: color }} />
    </div>
  );
}

function ordersErrorMessage(error) {
  if (error === "missing_scope") {
    return "应用尚未获得读取订单权限（read_orders）。部署包含订单权限的新版本后，在 Shopify 后台打开应用并同意权限更新，即可显示订单统计。";
  }
  return `订单数据读取失败：${error}。如提示无权访问 Order，请在开发者后台为应用开启「受保护的客户数据」访问。`;
}

export default function RecyclingFeeStatsPage() {
  const stats = useLoaderData();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const loading = navigation.state === "loading";
  const { currency, rateSummary } = stats;

  const feeShare = percent(stats.feeOrders, stats.totalOrders);
  const matchRate = percent(stats.matchedOrders, stats.feeOrders);
  const syncRate = percent(rateSummary.synced, rateSummary.active);
  const averageFee = stats.feeOrders ? stats.feeAmount / stats.feeOrders : 0;
  const activeDays = stats.daily.filter((item) => item.amount > 0).length;
  const peakDay = stats.daily.reduce((best, item) => (item.amount > (best?.amount ?? 0) ? item : best), null);

  return (
    <s-page heading="数据统计" inlineSize="large">
      <s-button slot="secondary-actions" href="/app">
        回收费设置
      </s-button>

      {stats.ordersError && (
        <s-banner tone="warning" heading="订单统计暂不可用">
          {ordersErrorMessage(stats.ordersError)}
        </s-banner>
      )}

      <s-query-container>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">统计周期</s-text>
              {STATS_RANGES.map((days) => (
                <s-button
                  key={days}
                  variant={stats.range === days ? "primary" : "secondary"}
                  disabled={loading || undefined}
                  onClick={() => navigate(`/app/stats?range=${days}`)}
                >
                  近 {days} 天
                </s-button>
              ))}
            </s-stack>
            <s-stack direction="inline" gap="small-200" alignItems="center">
              <s-text color="subdued">自 {stats.since} 起（UTC）</s-text>
              {stats.testOrders > 0 && <s-badge tone="info">含测试订单 {stats.testOrders} 笔</s-badge>}
              {stats.truncated && <s-badge tone="warning">仅统计最近 500 笔收费订单</s-badge>}
            </s-stack>
          </s-stack>

          <s-grid
            gridTemplateColumns="@container (inline-size > 720px) repeat(4, minmax(0, 1fr)), repeat(2, minmax(0, 1fr))"
            gap="base"
          >
            <HeroCard
              gradient={HERO_GRADIENTS[0]}
              label="回收费收入"
              value={formatMoney(stats.feeAmount, currency)}
              caption={`日均 ${formatMoney(stats.feeAmount / stats.range, currency)}`}
            />
            <HeroCard
              gradient={HERO_GRADIENTS[1]}
              label="收费订单"
              value={`${stats.feeOrders} 单`}
              caption={`占全部订单 ${feeShare}%（共 ${stats.totalOrders} 单）`}
            />
            <HeroCard
              gradient={HERO_GRADIENTS[2]}
              label="收费床垫件数"
              value={`${stats.feeUnits} 件`}
              caption={`件数匹配 ${stats.matchedOrders} / ${stats.feeOrders} 单`}
            />
            <HeroCard
              gradient={HERO_GRADIENTS[3]}
              label="平均每单回收费"
              value={formatMoney(averageFee, currency)}
              caption={`费率 ${formatMoney(rateSummary.min, currency)} – ${formatMoney(rateSummary.max, currency)}`}
            />
          </s-grid>

          <s-grid
            gridTemplateColumns="@container (inline-size > 720px) minmax(0, 3fr) minmax(0, 2fr), minmax(0, 1fr)"
            gap="base"
          >
            <s-section heading="每日回收费收入">
              <s-stack direction="block" gap="base">
                <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
                  <s-box padding="small-300" borderRadius="base" background="subdued">
                    <s-stack direction="block" gap="small-100">
                      <s-text color="subdued">有收费天数</s-text>
                      <s-text type="strong">
                        {activeDays} / {stats.range} 天
                      </s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="small-300" borderRadius="base" background="subdued">
                    <s-stack direction="block" gap="small-100">
                      <s-text color="subdued">单日最高</s-text>
                      <s-text type="strong">
                        {peakDay ? `${formatMoney(peakDay.amount, currency)}（${peakDay.date.slice(5)}）` : "-"}
                      </s-text>
                    </s-stack>
                  </s-box>
                  <s-box padding="small-300" borderRadius="base" background="subdued">
                    <s-stack direction="block" gap="small-100">
                      <s-text color="subdued">每件平均</s-text>
                      <s-text type="strong">
                        {formatMoney(stats.feeUnits ? stats.feeAmount / stats.feeUnits : 0, currency)}
                      </s-text>
                    </s-stack>
                  </s-box>
                </s-grid>
                <BarChart data={stats.daily} currency={currency} />
              </s-stack>
            </s-section>

            <s-section heading="运行指标">
              <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="small-200">
                <Gauge
                  value={feeShare}
                  label="收费订单占比"
                  caption={`${stats.feeOrders} / ${stats.totalOrders} 单`}
                  color="#2563eb"
                />
                <Gauge
                  value={matchRate}
                  label="件数匹配率"
                  caption="回收费件数 = 床垫件数"
                  color="#059669"
                />
                <Gauge
                  value={syncRate}
                  label="SKU 同步率"
                  caption={`${rateSummary.synced} / ${rateSummary.active} 个州`}
                  color="#7c3aed"
                />
              </s-grid>
            </s-section>
          </s-grid>

          <s-grid
            gridTemplateColumns="@container (inline-size > 720px) minmax(0, 2fr) minmax(0, 3fr), minmax(0, 1fr)"
            gap="base"
          >
            <s-section heading="各州收费分布">
              {stats.states.length === 0 ? (
                <s-text color="subdued">统计周期内暂无收费订单。</s-text>
              ) : (
                <s-stack direction="block" gap="base">
                  {stats.states.map((state, index) => {
                    const share = percent(state.amount, stats.feeAmount);
                    return (
                      <s-stack key={state.stateCode} direction="block" gap="small-200">
                        <s-stack direction="inline" gap="small-200" alignItems="center" justifyContent="space-between">
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-text type="strong">{state.stateCode}</s-text>
                            <s-text color="subdued">{state.stateName}</s-text>
                          </s-stack>
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-text color="subdued">
                              {state.orders} 单 · {state.units} 件
                            </s-text>
                            <s-text type="strong">{formatMoney(state.amount, currency)}</s-text>
                            <s-text color="subdued">{share}%</s-text>
                          </s-stack>
                        </s-stack>
                        <ProgressBar value={share} color={PALETTE[index % PALETTE.length]} />
                      </s-stack>
                    );
                  })}
                </s-stack>
              )}
            </s-section>

            <s-section heading="最近收费订单">
              {stats.recentOrders.length === 0 ? (
                <s-text color="subdued">统计周期内暂无收费订单。</s-text>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">订单</s-table-header>
                    <s-table-header listSlot="labeled">日期</s-table-header>
                    <s-table-header listSlot="labeled">州</s-table-header>
                    <s-table-header listSlot="labeled" format="numeric">
                      床垫/回收费
                    </s-table-header>
                    <s-table-header listSlot="secondary" format="currency">
                      回收费
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {stats.recentOrders.map((order) => (
                      <s-table-row key={order.id}>
                        <s-table-cell>
                          <s-stack direction="inline" gap="small-200" alignItems="center">
                            <s-link href={`shopify://admin/orders/${order.id.split("/").pop()}`} target="_top">
                              {order.name}
                            </s-link>
                            {order.test && <s-badge>测试</s-badge>}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>{order.createdAt.slice(0, 10)}</s-table-cell>
                        <s-table-cell>{order.stateCode}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={order.mattressUnits === order.feeUnits ? "success" : "warning"}>
                            {order.mattressUnits} / {order.feeUnits}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>{formatMoney(order.feeAmount, currency)}</s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
            </s-section>
          </s-grid>
        </s-stack>
      </s-query-container>
    </s-page>
  );
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
