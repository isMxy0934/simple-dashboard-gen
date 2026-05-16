"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/web/i18n/i18n-context";
import { readLocalAuthSession } from "../auth-session";
import styles from "./auth-gate.module.css";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    if (readLocalAuthSession()) {
      setAuthorized(true);
      return;
    }

    router.replace("/login");
  }, [router]);

  if (!authorized) {
    return (
      <main className={styles.loadingShell} aria-live="polite">
        {t("auth.gate.checking")}
      </main>
    );
  }

  return children;
}
