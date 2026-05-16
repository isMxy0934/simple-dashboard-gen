import type { Metadata } from "next";
import { LoginPage } from "@/web/auth";

export const metadata: Metadata = {
  title: "Login | Mercaso Reports",
  description: "Sign in to Mercaso Reports.",
};

export default function LoginRoute() {
  return <LoginPage />;
}
