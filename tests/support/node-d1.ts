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

  run(): Promise<D1RunResultLike> {
    const result = this.statement.run(...(this.values as readonly SQLInputValue[]));
    return Promise.resolve({ success: true, meta: { changes: Number(result.changes) } });
  }
}

export class NodeD1Database implements D1DatabaseLike {
  readonly sqlite = new DatabaseSync(":memory:");

  constructor(migrationSql: string) {
    this.sqlite.exec(migrationSql);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
  }

  prepare(query: string): D1PreparedStatementLike {
    return new NodeD1PreparedStatement(this.sqlite.prepare(query));
  }

  async batch(statements: readonly D1PreparedStatementLike[]): Promise<readonly D1RunResultLike[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results: D1RunResultLike[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error: unknown) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.sqlite.close();
  }
}
