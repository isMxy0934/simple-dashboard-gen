import type {
  DashboardRendererSlotFormatter,
  JsonValue,
} from "@/contracts";

const INTEGER_FORMATTER = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const USD_0_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const USD_2_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatRendererSlotValue(
  value: JsonValue,
  formatter?: DashboardRendererSlotFormatter,
): JsonValue {
  if (!formatter || typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  if (formatter === "integer") {
    return INTEGER_FORMATTER.format(value);
  }

  if (formatter === "usd_0") {
    return USD_0_FORMATTER.format(value);
  }

  if (formatter === "usd_2") {
    return USD_2_FORMATTER.format(value);
  }

  return value;
}
