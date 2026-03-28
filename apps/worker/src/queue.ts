type QueueTask<T> = {
  domain: string;
  run: () => Promise<T>;
};

type QueueOptions = {
  maxConcurrent: number;
  maxPerDomain: number;
};

export function createDomainQueue({ maxConcurrent, maxPerDomain }: QueueOptions) {
  const pending: Array<{
    task: QueueTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  const activeByDomain = new Map<string, number>();
  let activeTotal = 0;

  const drain = () => {
    if (activeTotal >= maxConcurrent) {
      return;
    }

    const nextIndex = pending.findIndex(({ task }) => {
      const domainCount = activeByDomain.get(task.domain) ?? 0;
      return domainCount < maxPerDomain;
    });

    if (nextIndex === -1) {
      return;
    }

    const [entry] = pending.splice(nextIndex, 1);
    activeTotal += 1;
    activeByDomain.set(entry.task.domain, (activeByDomain.get(entry.task.domain) ?? 0) + 1);

    entry.task
      .run()
      .then(entry.resolve)
      .catch(entry.reject)
      .finally(() => {
        activeTotal -= 1;
        activeByDomain.set(entry.task.domain, (activeByDomain.get(entry.task.domain) ?? 1) - 1);
        if ((activeByDomain.get(entry.task.domain) ?? 0) <= 0) {
          activeByDomain.delete(entry.task.domain);
        }
        drain();
      });

    drain();
  };

  return {
    push<T>(task: QueueTask<T>) {
      return new Promise<T>((resolve, reject) => {
        pending.push({
          task,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        drain();
      });
    },
  };
}
