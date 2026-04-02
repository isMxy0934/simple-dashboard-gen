function randomUuid(): string {
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.randomUUID) {
    return c.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function createSessionId() {
  return `sess_${randomUuid()}`;
}

export function createTurnId() {
  return `turn_${randomUuid()}`;
}
