export function assertFocusedViewAccess(input: {
  focusedViewId: string | null;
  requestedViewId: string | null | undefined;
  action: string;
}) {
  if (
    input.focusedViewId &&
    input.requestedViewId &&
    input.requestedViewId !== input.focusedViewId
  ) {
    throw new Error(
      `${input.action} is restricted to "${input.focusedViewId}".`,
    );
  }
}

export function resolveScopedViewId(input: {
  focusedViewId: string | null;
  requestedViewId?: string | null;
}) {
  return input.requestedViewId ?? input.focusedViewId ?? "";
}

export function assertNoFocusedLayoutMutation(input: {
  focusedViewId: string | null;
  hasLayoutChange: boolean;
}) {
  if (input.focusedViewId && input.hasLayoutChange) {
    throw new Error("View worker cannot modify layout.");
  }
}
