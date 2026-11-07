/**
 * Settles bootstrap reads independently. Each callback runs as soon as its own read settles; the
 * returned promise is the bounded join used by callers that still need every read to complete.
 */
export type IndependentReadCallbacks<T extends Record<string, Promise<unknown>>> = {
  [K in keyof T]: {
    readonly onFulfilled: (value: Awaited<T[K]>) => void;
    readonly onRejected: (reason: unknown) => void;
  };
};

export async function settleIndependentReads<T extends Record<string, Promise<unknown>>>(
  reads: T,
  callbacks: IndependentReadCallbacks<T>
): Promise<readonly unknown[]> {
  const keys = Object.keys(reads) as Array<keyof T>;
  return Promise.all(
    keys.map(async (key) => {
      try {
        const value = await reads[key];
        callbacks[key].onFulfilled(value);
        return value;
      } catch (reason) {
        callbacks[key].onRejected(reason);
        return reason;
      }
    })
  );
}
