import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "创建失败 | AI Dashboard Studio",
};

export default function AuthoringCreateFailedPage() {
  return (
    <main
      style={{
        minHeight: "50vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.25rem", margin: 0 }}>无法创建仪表盘</h1>
      <p style={{ margin: 0, color: "var(--muted-foreground, #666)", textAlign: "center" }}>
        请确认数据库可用后重试，或从管理页新建。
      </p>
      <Link href="/" style={{ textDecoration: "underline" }}>
        返回首页
      </Link>
    </main>
  );
}
