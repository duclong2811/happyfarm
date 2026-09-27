export interface D1RunResultLike {
  readonly success: boolean;
  readonly meta: { readonly changes?: number };
}

export interface D1PreparedStatementLike {
  bind(...values: readonly unknown[]): D1PreparedStatementLike;
  first<T>(): Promise<T | null>;
  // The generic mirrors D1's typed row projection at the query boundary.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  all<T>(): Promise<{ readonly results: T[] }>;
  run(): Promise<D1RunResultLike>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]>;
}
