/**
 * Simple async error handler
 */
export function catchError<T>(
  promise: Promise<T>,
): Promise<[undefined, T] | [Error, undefined]> {
  return promise
    .then((data) => [undefined, data] as [undefined, T])
    .catch((error) => [error instanceof Error ? error : new Error(String(error)), undefined] as [Error, undefined]);
}

/**
 * Type-safe async error handler with expected error types
 */
export function catchErrorTyped<T, E extends new (message?: string) => Error>(
  promise: Promise<T>,
  errorToCatch?: E[],
): Promise<[undefined, T] | [InstanceType<E>, undefined]> {
  return promise
    .then((data) => [undefined, data] as [undefined, T])
    .catch((error) => {
      if (errorToCatch === undefined) {
        return [error instanceof Error ? error : new Error(String(error)), undefined] as [InstanceType<E>, undefined];
      }
      if (errorToCatch.some((e) => error instanceof e)) {
        return [error as InstanceType<E>, undefined] as [InstanceType<E>, undefined];
      }
      throw error; // Re-throw unexpected errors
    });
}

/**
 * Simple sync error handler
 */
export function catchErrorSync<T>(fn: () => T): [undefined, T] | [Error, undefined] {
  try {
    const data = fn();
    return [undefined, data];
  } catch (error) {
    return [error instanceof Error ? error : new Error(String(error)), undefined];
  }
}

/**
 * Type-safe sync error handler
 */
export function catchErrorTypedSync<T, E extends new (message?: string) => Error>(
  fn: () => T,
  errorToCatch?: E[],
): [undefined, T] | [InstanceType<E>, undefined] {
  try {
    const data = fn();
    return [undefined, data];
  } catch (error) {
    if (errorToCatch === undefined) {
      return [error instanceof Error ? error : new Error(String(error)), undefined] as [InstanceType<E>, undefined];
    }
    if (errorToCatch.some((e) => error instanceof e)) {
      return [error as InstanceType<E>, undefined];
    }
    throw error; // Re-throw unexpected errors
  }
}
