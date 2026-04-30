export type MutationDescriptor =
  | { kind: "view"; view_id: string }
  | { kind: "layout"; view_id: string }
  | { kind: "query"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding"; binding_id: string; view_id: string }
  | { kind: "view-delete"; view_id: string }
  | { kind: "query-delete"; query_id: string; affected_view_ids: string[] }
  | { kind: "binding-delete"; binding_id: string; view_id: string }
  | { kind: "patch-apply" };
