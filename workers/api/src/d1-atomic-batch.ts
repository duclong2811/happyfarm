import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "./d1-types";

/** A trusted, server-created slice of one D1 atomic batch. */
export interface D1AtomicBatchComponent<T> {
  readonly statements: readonly D1PreparedStatementLike[];
  /** Verifies only this component's result slice after the database transaction completes. */
  readonly verify: (results: readonly D1RunResultLike[]) => T;
}

/**
 * Executes trusted mutation components in one D1 batch and gives each verifier only its own results.
 *
 * A component that needs optimistic protection must encode a failed guard as a SQL error inside its
 * statements (for example through an existing constraint/marker pattern). A zero-row UPDATE noticed
 * only by `verify` is too late: D1 has already committed the batch at that point.
 */
export async function executeD1AtomicBatch<T extends readonly unknown[]>(
  db: D1DatabaseLike,
  components: { readonly [K in keyof T]: D1AtomicBatchComponent<T[K]> }
): Promise<T> {
  const statements: D1PreparedStatementLike[] = [];
  const offsets: number[] = [];
  for (const component of components) {
    offsets.push(statements.length);
    statements.push(...component.statements);
  }
  const results = await db.batch(statements);
  const values = components.map((component, index) => {
    const start = offsets[index] ?? 0;
    const end = start + component.statements.length;
    return component.verify(results.slice(start, end));
  }) as unknown as T;
  return values;
}

/** Convenience component for a single guarded statement whose SQL already aborts on conflict. */
export function requiredSingleStatement<T>(
  statement: D1PreparedStatementLike,
  verify: (result: D1RunResultLike) => T
): D1AtomicBatchComponent<T> {
  return {
    statements: [statement],
    verify: (results) => {
      const result = results[0];
      if (result === undefined) throw new Error("Atomic batch result is missing");
      return verify(result);
    }
  };
}

/** The B0.1 composition point: economic Plant first, Auto timeline/receipt second. */
export async function executeD1AtomicAutoPlant(
  db: D1DatabaseLike,
  plant: D1AtomicBatchComponent<void>,
  auto: D1AtomicBatchComponent<void>
): Promise<void> {
  await executeD1AtomicBatch(db, [plant, auto]);
}
