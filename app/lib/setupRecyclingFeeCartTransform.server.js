const CART_TRANSFORM_FUNCTION_TITLE = "Recycling Fee Cart Transform";
const CART_TRANSFORM_FUNCTION_HANDLE = "recycling-fee-cart-transform";

const GET_FUNCTIONS_QUERY = `#graphql
  query GetRecyclingFeeFunctions {
    shopifyFunctions(first: 50) {
      nodes {
        id
        title
        apiType
      }
    }
  }
`;

const GET_CART_TRANSFORMS_QUERY = `#graphql
  query GetRecyclingFeeCartTransforms {
    cartTransforms(first: 50) {
      nodes {
        id
        functionId
      }
    }
  }
`;

const CREATE_CART_TRANSFORM_MUTATION = `#graphql
  mutation CreateRecyclingFeeCartTransform($functionHandle: String!, $blockOnFailure: Boolean!) {
    cartTransformCreate(functionHandle: $functionHandle, blockOnFailure: $blockOnFailure) {
      cartTransform {
        id
        functionId
      }
      userErrors {
        field
        message
      }
    }
  }
`;

async function graphqlJson(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  return response.json();
}

export async function getRecyclingFeeCartTransformStatus(admin) {
  try {
    const [functionsData, transformsData] = await Promise.all([
      graphqlJson(admin, GET_FUNCTIONS_QUERY),
      graphqlJson(admin, GET_CART_TRANSFORMS_QUERY),
    ]);
    const functions = functionsData.data?.shopifyFunctions?.nodes ?? [];
    const transforms = transformsData.data?.cartTransforms?.nodes ?? [];
    const transformFunction =
      functions.find((fn) => fn.title === CART_TRANSFORM_FUNCTION_TITLE) || null;
    const registered = transformFunction
      ? transforms.find((transform) => transform.functionId === transformFunction.id) || null
      : null;

    if (!transformFunction) {
      return {
        status: "function_missing",
        message: "未找到回收费 Cart Transform Function，请先执行 shopify app deploy。",
        registeredTransformId: null,
      };
    }
    if (!registered) {
      return {
        status: "not_registered",
        message: "回收费 Cart Transform 尚未注册。刷新本页面会自动注册。",
        registeredTransformId: null,
      };
    }
    return {
      status: "ready",
      message: "回收费 Cart Transform 已注册。",
      registeredTransformId: registered.id,
    };
  } catch (error) {
    console.error("[RecyclingFee] cart transform status check failed:", error);
    return {
      status: "check_failed",
      message: "无法读取 Cart Transform 状态，请稍后刷新页面。",
      registeredTransformId: null,
    };
  }
}

export async function setupRecyclingFeeCartTransform(admin) {
  const status = await getRecyclingFeeCartTransformStatus(admin);
  if (status.status === "ready") return status.registeredTransformId;
  if (status.status !== "not_registered") throw new Error(status.message);

  const data = await graphqlJson(admin, CREATE_CART_TRANSFORM_MUTATION, {
    functionHandle: CART_TRANSFORM_FUNCTION_HANDLE,
    blockOnFailure: false,
  });
  const payload = data.data?.cartTransformCreate;
  const errors = payload?.userErrors ?? [];
  if (errors.length) {
    throw new Error(
      `创建回收费 Cart Transform 失败：${errors.map((error) => error.message).join("; ")}`,
    );
  }

  const cartTransformId = payload?.cartTransform?.id;
  if (!cartTransformId) {
    throw new Error("创建回收费 Cart Transform 失败：Shopify 未返回 cart transform ID");
  }
  return cartTransformId;
}
