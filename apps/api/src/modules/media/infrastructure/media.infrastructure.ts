import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { TenantContext } from '../../../shared/application/tenant-context.js';
import type { Db } from '../../../shared/infrastructure/prisma/client.js';
import type {
  CreateMediaAssetInput,
  MediaAssetRecord,
  MediaRepository,
  MediaStorage,
} from '../domain/media.js';

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * Bytes no disco local.
 *
 * A chave é montada por NÓS a partir de ids gerados por nós — nunca do nome que
 * o usuário mandou. Um arquivo chamado `../../.env` viraria escrita fora do
 * diretório, e é o tipo de falha que só aparece quando já é tarde.
 */
export class LocalFileMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(storageKey: string): string {
    const target = resolve(this.root, storageKey);
    // Cinto e suspensório: mesmo montando a chave, confirmamos que o caminho
    // final não escapou da raiz.
    if (!target.startsWith(this.root)) {
      throw new Error('Chave de storage fora do diretório permitido.');
    }
    return target;
  }

  async put(accountId: string, assetId: string, mimeType: string, bytes: Buffer): Promise<string> {
    const extension = EXTENSIONS[mimeType] ?? 'bin';
    const storageKey = join(accountId, `${assetId}.${extension}`);
    const target = this.pathFor(storageKey);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);

    return storageKey;
  }

  async get(storageKey: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(storageKey));
    } catch {
      return null;
    }
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.pathFor(storageKey), { force: true });
  }
}

function toRecord(row: {
  id: string;
  accountId: string;
  mimeType: string;
  byteSize: number;
  fileName: string;
  storageKey: string;
  width: number | null;
  height: number | null;
  createdAt: Date;
}): MediaAssetRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    fileName: row.fileName,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
  };
}

export class PrismaMediaRepository implements MediaRepository {
  constructor(private readonly db: Db) {}

  async create(context: TenantContext, input: CreateMediaAssetInput): Promise<MediaAssetRecord> {
    const row = await this.db.mediaAsset.create({
      data: { ...input, accountId: context.accountId },
    });
    return toRecord(row);
  }

  async findById(context: TenantContext, id: string): Promise<MediaAssetRecord | null> {
    // findFirst com accountId — findUnique por id é o padrão que abre IDOR.
    const row = await this.db.mediaAsset.findFirst({
      where: { id, accountId: context.accountId },
    });
    return row ? toRecord(row) : null;
  }

  async findManyByIds(context: TenantContext, ids: string[]): Promise<MediaAssetRecord[]> {
    if (ids.length === 0) return [];

    const rows = await this.db.mediaAsset.findMany({
      where: { id: { in: ids }, accountId: context.accountId },
    });

    // Preserva a ordem pedida: o usuário colou as imagens numa sequência, e é
    // nela que elas fazem sentido junto do texto.
    return ids
      .map((id) => rows.find((row) => row.id === id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map(toRecord);
  }
}
