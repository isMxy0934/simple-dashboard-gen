"use client";

import type { ReactNode } from "react";
import { App as AntdApp, ConfigProvider } from "antd";
import { I18nProvider } from "../client/shared/i18n/i18n-context";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <ConfigProvider>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </I18nProvider>
  );
}
