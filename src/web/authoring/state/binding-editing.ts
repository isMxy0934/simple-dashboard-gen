import {
  createBindingForView,
  createMockBindingForView,
  getBindingMode,
  isLiveBinding,
  reconcileBindingShape,
} from "../../../domain/dashboard/bindings";
import { DEFAULT_SLOT_ID, getPrimarySlotId } from "../../../domain/dashboard/contract-kernel";
import {
  getBindingsForView,
  getQueryById,
  getViewById,
  upsertBindingInDocument,
} from "../../../domain/dashboard/document";
import type { DashboardDocument } from "../../../contracts";

export function createOrUpdateBindingForView(
  document: DashboardDocument,
  viewId: string,
  queryId: string,
): { document: DashboardDocument; queryId: string | null } {
  const query = getQueryById(document, queryId);
  const view = getViewById(document, viewId);

  if (!query || !view) {
    return { document, queryId: null };
  }

  const existingBinding = findBindingByViewId(document, view.id, getPrimarySlotId(view));
  if (existingBinding) {
    const nextBinding = reconcileBindingShape(
      {
        ...existingBinding,
        mode: "live",
        slot_id: getPrimarySlotId(view),
        query_id: query.id,
        mock_data: undefined,
        mock_value: undefined,
      },
      view,
      query,
    );
    return {
      document: upsertBindingInDocument(document, nextBinding),
      queryId: query.id,
    };
  }

  return {
    document: upsertBindingInDocument(document, createBindingForView(view, query)),
    queryId: query.id,
  };
}

export function updateBindingParamMapping(
  document: DashboardDocument,
  viewId: string,
  paramName: string,
  field: "source" | "value",
  value: string,
): DashboardDocument {
  const binding = findBindingByViewId(document, viewId);
  if (!isLiveBinding(binding)) {
    return document;
  }

  const existing = binding.param_mapping[paramName] ?? {
    source: "constant",
    value: "",
  };
  return upsertBindingInDocument(document, {
    ...binding,
    param_mapping: {
      ...binding.param_mapping,
      [paramName]: {
        source:
          field === "source" ? (value as typeof existing.source) : existing.source,
        value: field === "value" ? value : existing.value,
      },
    },
  });
}

export function updateBindingFieldMapping(
  document: DashboardDocument,
  viewId: string,
  templateField: string,
  resultField: string,
): DashboardDocument {
  const binding = findBindingByViewId(document, viewId);
  if (!isLiveBinding(binding)) {
    return document;
  }

  if (!resultField) {
    const nextFieldMapping = { ...binding.field_mapping };
    delete nextFieldMapping[templateField];
    return upsertBindingInDocument(document, {
      ...binding,
      field_mapping: nextFieldMapping,
    });
  }

  return upsertBindingInDocument(document, {
    ...binding,
    field_mapping: {
      ...binding.field_mapping,
      [templateField]: resultField,
    },
  });
}

export function createOrUpdateMockBindingForView(
  document: DashboardDocument,
  viewId: string,
): DashboardDocument {
  const view = getViewById(document, viewId);
  if (!view) {
    return document;
  }

  const nextBinding = createMockBindingForView(view);
  return upsertBindingInDocument(document, nextBinding);
}

function findBindingByViewId(
  document: DashboardDocument,
  viewId: string,
  slotId = DEFAULT_SLOT_ID,
) {
  return getBindingsForView(document, viewId, slotId)[0];
}
