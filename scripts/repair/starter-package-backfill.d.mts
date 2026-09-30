/**
 * Types for the staging starter-package repair script.
 *
 * The script itself runs under plain `node`, so it is JavaScript; this declaration is what lets a
 * test import it without turning the whole repository into a `checkJs` project.
 */

export const STAGING_DATABASE: string;
export const STAGING_CONFIG: string;

export interface StarterPackageDefinition {
  readonly grantKey: string;
  readonly seedItemDefinitionId: string;
  readonly seedQuantity: number;
  readonly currencyDefinitionId: string;
  readonly goldAmount: number;
}

export interface RepairOptions {
  readonly apply: boolean;
  readonly database: string;
  readonly config: string;
  readonly limit: number | null;
  readonly help: boolean;
}

export function readStarterPackage(gameDataPath?: string): StarterPackageDefinition | null;
export function parseArgs(argv: readonly string[]): RepairOptions;
export function assertStagingTarget(options: {
  readonly database: string;
  readonly config: string;
  readonly limit: number | null;
}): void;
export function selectUnreceiptedPlayersSql(definition: StarterPackageDefinition): string;
export function planStatements(
  definition: StarterPackageDefinition,
  playerIds: readonly string[],
  options?: { readonly now?: string; readonly newTransactionId?: () => string }
): readonly string[];
