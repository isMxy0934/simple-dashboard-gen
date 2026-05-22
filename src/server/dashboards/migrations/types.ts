export interface Migrator {
  readonly from: string;
  readonly to: string;
  migrate(input: unknown): unknown;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}
