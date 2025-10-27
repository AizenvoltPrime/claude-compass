import type { Knex } from 'knex';
import type { Symbol, File, CreateSymbol } from '../models';

export async function getSymbolsByType(
  db: Knex,
  repoId: number,
  symbolType: string
): Promise<Symbol[]> {
  const symbols = await db('symbols')
    .join('files', 'symbols.file_id', 'files.id')
    .where('files.repo_id', repoId)
    .where('symbols.symbol_type', symbolType)
    .select('symbols.*')
    .orderBy('symbols.name');

  return symbols as Symbol[];
}

export async function getFilesByLanguage(
  db: Knex,
  repoId: number,
  language: string
): Promise<File[]> {
  const files = await db('files').where({ repo_id: repoId, language }).orderBy('path');

  return files as File[];
}

export function deduplicateSymbolsForInsertion(symbols: CreateSymbol[]): CreateSymbol[] {
  const seen = new Map<string, CreateSymbol>();

  for (const symbol of symbols) {
    const key = `${symbol.file_id}:${symbol.name}:${symbol.symbol_type}:${symbol.start_line}`;

    if (!seen.has(key) || isMoreCompleteSymbolForInsertion(symbol, seen.get(key)!)) {
      seen.set(key, symbol);
    }
  }

  return Array.from(seen.values());
}

function isMoreCompleteSymbolForInsertion(s1: CreateSymbol, s2: CreateSymbol): boolean {
  if (s1.signature && !s2.signature) return true;
  if (!s1.signature && s2.signature) return false;

  if (s1.is_exported && !s2.is_exported) return true;
  if (!s1.is_exported && s2.is_exported) return false;

  if (s1.description && !s2.description) return true;
  if (!s1.description && s2.description) return false;

  if (s1.qualified_name && !s2.qualified_name) return true;
  if (!s1.qualified_name && s2.qualified_name) return false;

  return false;
}
