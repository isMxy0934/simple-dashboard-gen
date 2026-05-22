"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/web/i18n/i18n-context";
import { readAuthSession } from "../auth-session";
import styles from "./auth-gate.module.css";

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readAuthSession()
      .then((session) => {
        if (cancelled) {
          return;
        }
        if (session) {
          setAuthorized(true);
          return;
        }
        router.replace("/login");
      })
      .catch(() => {
        if (!cancelled) {
          router.replace("/login");
        }
      });
    return () => {
      cancelled = true;
    };
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
