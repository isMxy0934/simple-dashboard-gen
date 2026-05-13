import "server-only";

export interface EditingSessionCleanupStatus {
  session_cleaned: boolean;
  cleanup_warning?: string;
}

export async function runEditingSessionCleanupBestEffort(input: {
  operation: "save" | "publish";
  cleanup: () => Promise<unknown>;
}): Promise<EditingSessionCleanupStatus> {
  try {
    await input.cleanup();
    return { session_cleaned: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Editing session cleanup failed.";
    console.error(
      `[dashboard-service] markEditingSessionClean after ${input.operation} failed:`,
      error,
    );
    return {
      session_cleaned: false,
      cleanup_warning: message,
    };
  }
}
