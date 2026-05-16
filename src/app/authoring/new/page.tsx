import type { Metadata } from "next";
import { TemplatePickerPage } from "../../../web/authoring";

export const metadata: Metadata = {
  title: "Choose Report Template | Mercaso Reports",
  description: "Create a new report from a shared dashboard template.",
};

export default function AuthoringNewPage() {
  return <TemplatePickerPage />;
}
