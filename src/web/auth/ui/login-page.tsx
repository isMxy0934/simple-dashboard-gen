"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useI18n } from "@/web/i18n/i18n-context";
import {
  readAuthSession,
  signIn,
  type AuthMethod,
} from "../session-client";
import styles from "./login.module.css";

function GoogleMark() {
  return (
    <svg
      className={styles.googleMark}
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.63-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.25h2.92c1.7-1.57 2.68-3.88 2.68-6.6z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.2l-2.92-2.25c-.8.54-1.84.86-3.04.86a5.35 5.35 0 0 1-5.03-3.7H.96v2.32A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.4 5.4 0 0 1 3.69 9c0-.59.1-1.16.28-1.71V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.03l3.01-2.32z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.97l3.01 2.32A5.35 5.35 0 0 1 9 3.58z"
      />
    </svg>
  );
}

export function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [method, setMethod] = useState<AuthMethod>("account");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    readAuthSession()
      .then((session) => {
        if (!cancelled && session) {
          router.replace("/");
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function completeSignIn(nextMethod: AuthMethod, form?: HTMLFormElement) {
    setSubmitting(true);
    setStatusMessage(t("auth.login.signingIn"));
    try {
      const formData = form ? new FormData(form) : null;
      await signIn({
        method: nextMethod,
        identity:
          typeof formData?.get("identity") === "string"
            ? formData.get("identity") as string
            : undefined,
        password:
          typeof formData?.get("password") === "string"
            ? formData.get("password") as string
            : undefined,
      });
      router.replace("/");
    } catch {
      setSubmitting(false);
      setStatusMessage(t("auth.login.description"));
    }
  }

  return (
    <main className={styles.page} aria-labelledby="login-title">
      <section className={styles.visualPane} aria-label={t("auth.login.brandAria")}>
        <div className={styles.brandLockup}>
          <img
            className={styles.logo}
            src="/brand/logo_mercaso_color@2x.png"
            width="54"
            height="54"
            alt={t("auth.login.logoAlt")}
          />
          <div>
            <p className={styles.brandName}>{t("management.sidebar.title")}</p>
          </div>
        </div>

        <div className={styles.visualReserve}>
          <p className={styles.eyebrow}>{t("auth.login.visualEyebrow")}</p>
          <h1>{t("auth.login.visualTitle")}</h1>
          <span className={styles.placeholderLine} aria-hidden="true" />
          <span
            className={`${styles.placeholderLine} ${styles.placeholderLineShort}`}
            aria-hidden="true"
          />
        </div>
      </section>

      <section className={styles.authPane} aria-label={t("auth.login.formAria")}>
        <div className={styles.authTop}>
          <a className={styles.topbarLink} href="mailto:admin@mercaso.com">
            {t("auth.login.contactAdmin")}
          </a>
        </div>

        <div className={styles.authCenter}>
          <div className={styles.authPanel}>
            <header className={styles.authHeader}>
              <p className={styles.eyebrow}>{t("auth.login.eyebrow")}</p>
              <h2 id="login-title">{t("auth.login.title")}</h2>
              <p>{t("auth.login.description")}</p>
            </header>

            <div className={styles.authCard}>
              <div className={styles.segment} role="tablist" aria-label={t("auth.login.methodAria")}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === "account"}
                  className={method === "account" ? styles.segmentActive : ""}
                  onClick={() => {
                    setMethod("account");
                    setStatusMessage("");
                  }}
                >
                  {t("auth.login.accountTab")}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={method === "google"}
                  className={method === "google" ? styles.segmentActive : ""}
                  onClick={() => {
                    setMethod("google");
                    setStatusMessage("");
                  }}
                >
                  {t("auth.login.googleTab")}
                </button>
              </div>

              {method === "account" ? (
                <>
                  <form
                    className={styles.form}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void completeSignIn("account", event.currentTarget);
                    }}
                  >
                    <div className={styles.field}>
                      <label htmlFor="login-identity">{t("auth.login.identityLabel")}</label>
                      <div className={styles.inputWrap}>
                        <input
                          id="login-identity"
                          name="identity"
                          type="email"
                          defaultValue="analyst@mercaso.com"
                          autoComplete="username"
                          required
                        />
                      </div>
                    </div>

                    <div className={styles.field}>
                      <div className={styles.labelRow}>
                        <label htmlFor="login-password">{t("auth.login.passwordLabel")}</label>
                        <a className={styles.fieldLink} href="mailto:admin@mercaso.com">
                          {t("auth.login.forgotPassword")}
                        </a>
                      </div>
                      <div className={styles.inputWrap}>
                        <input
                          id="login-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          defaultValue="dashboard"
                          autoComplete="current-password"
                          required
                        />
                        <button
                          className={styles.inputAction}
                          type="button"
                          aria-label={
                            showPassword
                              ? t("auth.login.hidePassword")
                              : t("auth.login.showPassword")
                          }
                          onClick={() => setShowPassword((current) => !current)}
                        >
                          {showPassword
                            ? t("auth.login.hidePasswordShort")
                            : t("auth.login.showPasswordShort")}
                        </button>
                      </div>
                      <p className={styles.helper}>{t("auth.login.passwordHelper")}</p>
                    </div>

                    <button
                      className={styles.primaryButton}
                      type="submit"
                      disabled={submitting}
                    >
                      {submitting ? t("auth.login.signingIn") : t("auth.login.submit")}
                    </button>
                  </form>

                  <div className={styles.divider}>{t("auth.login.or")}</div>

                  <button
                    className={styles.googleButton}
                    type="button"
                    disabled={submitting}
                    onClick={() => void completeSignIn("google")}
                  >
                    <GoogleMark />
                    {t("auth.login.googleSubmit")}
                  </button>
                </>
              ) : (
                <div className={styles.googlePanel}>
                  <p>{t("auth.login.googleDescription")}</p>
                  <button
                    className={styles.googleButton}
                    type="button"
                    disabled={submitting}
                    onClick={() => void completeSignIn("google")}
                  >
                    <GoogleMark />
                    {t("auth.login.googleContinue")}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={submitting}
                    onClick={() => {
                      setMethod("account");
                      setStatusMessage("");
                    }}
                  >
                    {t("auth.login.useAccount")}
                  </button>
                </div>
              )}
            </div>

            <p className={styles.status} aria-live="polite">
              {statusMessage}
            </p>
          </div>
        </div>

        <footer className={styles.authFoot}>
          <span>{t("auth.login.copyright")}</span>
          <span className={styles.footDot} aria-hidden="true" />
          <span>{t("auth.login.secureAccess")}</span>
          <span className={styles.footDot} aria-hidden="true" />
          <span>{t("auth.login.permissionControlled")}</span>
        </footer>
      </section>
    </main>
  );
}
