import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { setupRecyclingFeeCartTransform } from "../lib/setupRecyclingFeeCartTransform.server";

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  try {
    await setupRecyclingFeeCartTransform(admin);
  } catch (error) {
    console.error("[RecyclingFee] cart transform setup failed:", error);
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">床垫回收费</s-link>
        <s-link href="/app/stats">数据统计</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
