import type { Knex } from 'knex';
import type { FrameworkMetadata, CreateFrameworkMetadata, SymbolWithFile } from '../models';

export async function storeFrameworkMetadata(
  db: Knex,
  data: CreateFrameworkMetadata
): Promise<FrameworkMetadata> {
  const existingMetadata = await db('framework_metadata')
    .where({ repo_id: data.repo_id, framework_type: data.framework_type })
    .first();

  if (existingMetadata) {
    const [metadata] = await db('framework_metadata')
      .where({ id: existingMetadata.id })
      .update({ ...data, updated_at: new Date() })
      .returning('*');
    return metadata as FrameworkMetadata;
  } else {
    const [metadata] = await db('framework_metadata').insert(data).returning('*');
    return metadata as FrameworkMetadata;
  }
}

export async function getFrameworkStack(db: Knex, repoId: number): Promise<FrameworkMetadata[]> {
  const metadata = await db('framework_metadata')
    .where({ repo_id: repoId })
    .orderBy('framework_type');
  return metadata as FrameworkMetadata[];
}

export async function getFrameworkMetadata(
  db: Knex,
  repoId: number,
  frameworkType: string
): Promise<FrameworkMetadata | null> {
  const metadata = await db('framework_metadata')
    .where({ repo_id: repoId, framework_type: frameworkType })
    .first();
  return (metadata as FrameworkMetadata) || null;
}

export async function findSymbolByName(
  db: Knex,
  repoId: number,
  name: string
): Promise<SymbolWithFile | null> {
  const result = await db('symbols')
    .leftJoin('files', 'symbols.file_id', 'files.id')
    .select('symbols.*', 'files.path as file_path', 'files.language as file_language')
    .where('files.repo_id', repoId)
    .where('symbols.name', name)
    .first();

  if (!result) return null;

  return {
    ...result,
    file: {
      id: result.file_id,
      path: result.file_path,
      language: result.file_language,
    },
  } as SymbolWithFile;
}
