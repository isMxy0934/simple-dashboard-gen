import "server-only";

import type { LogSink, ObservabilityEvent } from "../observability";

export class JsonlFileSink implements LogSink {
  readonly name = "jsonl-file";

  async write(_event: ObservabilityEvent): Promise<void> {
    throw new Error("NOT_IMPLEMENTED: JsonlFileSink.write");
  }
}
