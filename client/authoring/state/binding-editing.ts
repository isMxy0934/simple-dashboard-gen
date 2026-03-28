import {
  createBindingForView,
  createMockBindingForView,
  getBindingMode,
  isLiveBinding,
} from "../../../domain/dashboard/bindings";
import { collectTemplateFieldsFromView } from "../../../domain/dashboard/views";
import type { Binding, DashboardDocument, DashboardView, QueryDef } from "../../../contracts";

export function findBindingByViewId(bindings: Binding[], viewId: string): Binding | undefined {
  return bindings.find((binding) => binding.view_id === viewId);
}

export function upsertBinding(bindings: Binding[], binding: Binding): void {
  const index = bindings.findIndex((candidate) => candidate.id === binding.id);
  if (index >= 0) {
    bindings[index] = binding;
    return;
  }

  bindings.push(binding);
}

export function reconcileBindingShape(
  binding: Binding,
  view: DashboardView,
  query: QueryDef,
): Binding {
  const nextBinding = createBindingForView(view, query);
  if (!isLiveBinding(binding)) {
    return nextBinding;
  }

  const nextParamMapping =
    nextBinding.param_mapping as NonNullable<Binding["param_mapping"]>;
  const nextFieldMapping =
    nextBinding.field_mapping as NonNullable<Binding["field_mapping"]>;

  for (const param of query.params) {
    if (binding.param_mapping[param.name]) {
      nextParamMapping[param.name] = binding.param_mapping[param.name];
    }
  }

  for (const templateField of collectTemplateFieldsFromView(view)) {
    if (binding.field_mapping[templateField]) {
      nextFieldMapping[templateField] = binding.field_mapping[templateField];
    }
  }

  return {
    ...binding,
    query_id: query.id,
    param_mapping: nextParamMapping,
    field_mapping: nextFieldMapping,
  };
}

export function createOrUpdateBindingForView(
  document: DashboardDocument,
  viewId: string,
  queryId: string,
): string | null {
  const query = document.query_defs.find((candidate) => candidate.id === queryId);
  const view = document.dashboard_spec.views.find((candidate) => candidate.id === viewId);

  if (!query || !view) {
    return null;
  }

  const existingBinding = findBindingByViewId(document.bindings, view.id);
  if (existingBinding) {
    existingBinding.mode = "live";
    existingBinding.query_id = query.id;
    delete existingBinding.mock_data;
    Object.assign(existingBinding, reconcileBindingShape(existingBinding, view, query));
    return query.id;
  }

  document.bindings.push(createBindingForView(view, query));
  return query.id;
}

export function updateBindingParamMapping(
  document: DashboardDocument,
  viewId: string,
  paramName: string,
  field: "source" | "value",
  value: string,
): void {
  const binding = findBindingByViewId(document.bindings, viewId);
  if (!isLiveBinding(binding)) {
    return;
  }

  const existing = binding.param_mapping[paramName] ?? {
    source: "constant",
    value: "",
  };
  binding.param_mapping[paramName] = {
    source: field === "source" ? (value as typeof existing.source) : existing.source,
    value: field === "value" ? value : existing.value,
  };
}

export function updateBindingFieldMapping(
  document: DashboardDocument,
  viewId: string,
  templateField: string,
  resultField: string,
): void {
  const binding = findBindingByViewId(document.bindings, viewId);
  if (!isLiveBinding(binding)) {
    return;
  }

  if (!resultField) {
    delete binding.field_mapping[templateField];
    return;
  }

  binding.field_mapping[templateField] = resultField;
}

export function createOrUpdateMockBindingForView(
  document: DashboardDocument,
  viewId: string,
): void {
  const view = document.dashboard_spec.views.find((candidate) => candidate.id === viewId);
  if (!view) {
    return;
  }

  const nextBinding = createMockBindingForView(view);
  upsertBinding(document.bindings, nextBinding);
}
