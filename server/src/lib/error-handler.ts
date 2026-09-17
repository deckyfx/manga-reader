/** Go-style error handling — avoids catch(e: unknown) patterns. */

export function catchError<T>(
  promise: Promise<T>,
): Promise<[undefined, T] | [Error]> {
  return promise.then(
    (data) => [undefined, data] as [undefined, T],
    (err) => [err instanceof Error ? err : new Error(String(err))],
  );
}

export function catchErrorTyped<T, E extends new (...args: never[]) => Error>(
  promise: Promise<T>,
  errorTypes: E[],
): Promise<[undefined, T] | [InstanceType<E>]> {
  return promise.then(
    (data) => [undefined, data] as [undefined, T],
    (err) => {
      if (errorTypes.some((E) => err instanceof E)) return [err] as [InstanceType<E>];
      throw err; // re-throw unexpected errors (fail-fast)
    },
  );
}

export function catchErrorSync<T>(fn: () => T): [undefined, T] | [Error] {
  try {
    return [undefined, fn()];
  } catch (err) {
    return [err instanceof Error ? err : new Error(String(err))];
  }
}
