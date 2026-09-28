import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type { D1DatabaseLike, D1PreparedStatementLike, D1RunResultLike } from "../src/d1-types";

/**
 * Development-only D1 port backed by `node:sqlite`.
 *
 * The production Worker always talks to Cloudflare D1. This adapter exists so the real
 * development Worker entrypoint (`src/dev-index.ts`) can be hosted locally on a machine
 * where `workerd` cannot run. It implements the same narrow `D1DatabaseLike` surface the
 * repositories already depend on, including D1's implicit-batch transaction semantics.
 */
class SqlitePreparedStatement implements D1PreparedStatementLike {
  private values: readonly unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    const bound = new SqlitePreparedStatement(this.statement);
    bound.values = values;
    return bound;
  }

  first<T>(): Promise<T | null> {
    const row = this.statement.get(...(this.values as readonly SQLInputValue[]));
    return Promise.resolve(row === undefined ? null : (row as T));
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  all<T>(): Promise<{ readonly results: T[] }> {
    const rows = this.statement.all(...(this.values as readonly SQLInputValue[]));
    return Promise.resolve({ results: rows as T[] });
  }

  run(): Promise<D1RunResultLike> {
    const result = this.statement.run(...(this.values as readonly SQLInputValue[]));
    return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
  }
}

export class SqliteD1Database implements D1DatabaseLike {
  private batchTail: Promise<void> = Promise.resolve();

  constructor(readonly sqlite: DatabaseSync) {
    // Mirrors D1: foreign keys are always enforced.
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query: string): D1PreparedStatementLike {
    return new SqlitePreparedStatement(this.sqlite.prepare(query));
  }

  batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]> {
    const run = async (): Promise<readonly D1RunResultLike[]> => {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results: D1RunResultLike[] = [];
        for (const statement of statements) {
          results.push(await statement.run());
        }
        this.sqlite.exec("COMMIT");
        return results;
      } catch (error: unknown) {
        this.sqlite.exec("ROLLBACK");
        throw error;
      }
    };
    const result = this.batchTail.then(run, run);
    this.batchTail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  close(): void {
    this.sqlite.close();
  }
}
