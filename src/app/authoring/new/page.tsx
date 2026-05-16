import type { Metadata } from "next";
import { TemplatePickerPage } from "../../../web/authoring";

export const metadata: Metadata = {
  title: "Choose Report Template | Hermes Reports",
  description: "Create a new report from a shared dashboard template.",
};

export default function AuthoringNewPage() {
  return <TemplatePickerPage />;
}
