import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate, requireTenant } from '../../../http/middlewares/authenticate.js';
import { parseParams } from '../../../http/validate.js';
import type { IdGenerator, TokenService } from '../../../shared/application/ports.js';
import { AppError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  isAcceptedImage,
  MAX_UPLOAD_BYTES,
  readImageSize,
  type MediaRepository,
  type MediaStorage,
} from '../domain/media.js';

export interface MediaRouterDependencies {
  tokens: TokenService;
  media: MediaRepository;
  storage: MediaStorage;
  ids: IdGenerator;
}

const idParamSchema = z.object({ id: z.string().length(26, 'Identificador inválido.') });

/**
 * Upload em memória, com teto.
 *
 * `memoryStorage` porque o arquivo é pequeno por contrato (8MB) e precisa ser
 * inspecionado antes de tocar o disco: gravar primeiro e validar depois deixa
 * lixo no volume a cada tentativa recusada.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

export function createMediaRouter(deps: MediaRouterDependencies): Router {
  const router = Router();
  const auth = authenticate(deps.tokens);

  router.post('/media', auth, upload.single('file'), async (request, response) => {
    const tenant = requireTenant(request);
    const file = request.file;

    if (!file) {
      throw new AppError('VALIDATION_ERROR', 'Nenhum arquivo enviado.', { httpStatus: 400 });
    }

    if (!isAcceptedImage(file.mimetype)) {
      throw new AppError('VALIDATION_ERROR', 'Formato não aceito. Envie PNG, JPEG, WebP ou GIF.', {
        httpStatus: 415,
      });
    }

    // O `Content-Type` vem do cliente e pode mentir. Só um arquivo cujo
    // CABEÇALHO é reconhecível passa — é o que impede um script disfarçado de
    // PNG de ser servido de volta como imagem depois.
    const size = readImageSize(file.buffer);
    if (!size) {
      throw new AppError('VALIDATION_ERROR', 'O arquivo não parece ser uma imagem válida.', {
        httpStatus: 415,
      });
    }

    const id = deps.ids.generate();
    const storageKey = await deps.storage.put(tenant.accountId, id, file.mimetype, file.buffer);

    const asset = await deps.media.create(tenant, {
      id,
      mimeType: file.mimetype,
      byteSize: file.size,
      // Nome só para exibição; o caminho em disco nunca sai daqui.
      fileName: file.originalname.slice(0, 255) || 'imagem',
      storageKey,
      width: size.width,
      height: size.height,
      uploadedBy: tenant.userId ?? 'system',
    });

    response.status(201).json({
      id: asset.id,
      mimeType: asset.mimeType,
      byteSize: asset.byteSize,
      fileName: asset.fileName,
      width: asset.width,
      height: asset.height,
      url: `/api/media/${asset.id}`,
    });
  });

  /** Serve o arquivo. Escopado por tenant: o id sozinho não dá acesso. */
  router.get('/media/:id', auth, async (request, response) => {
    const tenant = requireTenant(request);
    const { id } = parseParams(idParamSchema, request);

    const asset = await deps.media.findById(tenant, id);
    if (!asset) throw new NotFoundError('NOT_FOUND', 'Arquivo não encontrado.');

    const bytes = await deps.storage.get(asset.storageKey);
    if (!bytes) throw new NotFoundError('NOT_FOUND', 'Arquivo não encontrado.');

    response.setHeader('Content-Type', asset.mimeType);
    // O conteúdo é imutável e o id é único: cache longo sem risco de servir
    // versão velha. `private` porque é dado de uma conta.
    response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    // Defesa em profundidade: mesmo validando o cabeçalho, não deixamos o
    // navegador adivinhar outro tipo e executar o conteúdo.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(bytes);
  });

  return router;
}
