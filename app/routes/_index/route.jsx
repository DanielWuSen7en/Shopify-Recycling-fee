import { redirect, Form, useLoaderData } from "react-router";
import { login } from "../../shopify.server";
import styles from "./styles.module.css";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Mattress Recycling Fee</h1>
        <p className={styles.text}>
          按收货州和床垫件数，在结账时自动添加州立床垫回收费。
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>店铺域名</span>
              <input className={styles.input} type="text" name="shop" />
              <span>例如：my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              登录
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>州费率</strong>：每个州独立费率和 SKU，例如 CA → SSMRFCA。
          </li>
          <li>
            <strong>结账扩展</strong>：按收货州添加回收费，数量等于床垫件数。
          </li>
          <li>
            <strong>快捷支付</strong>：Shop Pay 无法加行时，由 Cart Transform 补上回收费。
          </li>
        </ul>
      </div>
    </div>
  );
}
