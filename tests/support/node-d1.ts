import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type {
  D1DatabaseLike,
  D1PreparedStatementLike,
  D1RunResultLike
} from "../../workers/api/src/d1-types";

class NodeD1PreparedStatement implements D1PreparedStatementLike {
  private values: readonly unknown[] = [];

  constructor(private readonly statement: StatementSync) {}

  bind(...values: readonly unknown[]): D1PreparedStatementLike {
    const bound = new NodeD1PreparedStatement(this.statement);
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

export class NodeD1Database implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");
  private batchTail: Promise<void> = Promise.resolve();

  constructor(
    migrationSql: string,
    private readonly failures: {
      readonly afterStatement?: (statementIndex: number) => void;
      readonly beforeCommit?: () => void;
    } = {}
  ) {
    this.sqlite.exec(migrationSql);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query: string): D1PreparedStatementLike {
    return new NodeD1PreparedStatement(this.sqlite.prepare(query));
  }

  batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]> {
    const run = async (): Promise<readonly D1RunResultLike[]> => {
      this.sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results: D1RunResultLike[] = [];
        for (const [index, statement] of statements.entries()) {
          results.push(await statement.run());
          this.failures.afterStatement?.(index);
        }
        this.failures.beforeCommit?.();
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
