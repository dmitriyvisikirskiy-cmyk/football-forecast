// Small helper to run async work with bounded concurrency. Used for DB
// upserts during the cron run: doing 100+ upserts one at a time is too slow
// to fit Vercel Hobby's 60s function cap, but firing all of them at once
// risks overwhelming the Postgres connection pool. A modest concurrency
// limit gets most of the speed-up safely.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
