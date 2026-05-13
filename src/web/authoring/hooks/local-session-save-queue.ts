export interface LatestWinsQueueContext {
  sequence: number;
  isLatest: () => boolean;
}

export interface LatestWinsPromiseQueue<TPayload> {
  enqueue: (payload: TPayload) => void;
  drain: () => Promise<void>;
}

export function createLatestWinsPromiseQueue<TPayload>(
  runner: (payload: TPayload, context: LatestWinsQueueContext) => Promise<void>,
): LatestWinsPromiseQueue<TPayload> {
  let chain: Promise<void> = Promise.resolve();
  let latestSequence = 0;

  return {
    enqueue(payload) {
      const sequence = ++latestSequence;
      chain = chain
        .catch(() => undefined)
        .then(async () => {
          if (sequence !== latestSequence) {
            return;
          }
          await runner(payload, {
            sequence,
            isLatest: () => sequence === latestSequence,
          });
        })
        .catch(() => undefined);
    },
    drain() {
      return chain;
    },
  };
}
