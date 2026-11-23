import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DocumentKind,
  DocumentStatus,
  DocumentTrustStatus,
  IngestionJobStatus,
  KnowledgeBaseStatus,
  OrgRole,
  ParseStatus,
  Prisma,
} from '@prisma/client';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_UPLOAD_BYTES,
} from '../common/constants/upload.constants';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';
import type { AuthUser } from '../auth/types/auth-user.type';
import { createHash, randomUUID } from 'crypto';
import { AclService } from '../acl/acl.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly ingestionQueue: IngestionQueueService,
    private readonly acl: AclService,
  ) {}

  private maxUploadBytes() {
    return Number(
      this.config.get('MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES),
    );
  }

  private assertWriteRole(role: OrgRole) {
    if (role === OrgRole.viewer) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Viewers cannot upload or modify documents',
      });
    }
  }

  private validateFileMeta(mimeType: string, filename: string, byteSize: number) {
    if (byteSize > this.maxUploadBytes()) {
      throw new PayloadTooLargeException({
        code: 'PAYLOAD_TOO_LARGE',
        message: `File exceeds max size of ${this.maxUploadBytes()} bytes`,
      });
    }

    const ext = extname(filename).toLowerCase();
    if (
      !(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType) ||
      !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)
    ) {
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      });
    }
  }

  private async getActiveKb(orgId: string, kbId: string) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: kbId,
        organizationId: orgId,
        deletedAt: null,
        status: KnowledgeBaseStatus.active,
      },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found or not active',
      });
    }
    return kb;
  }

  private serializeDocument(doc: {
    id: string;
    organizationId: string;
    knowledgeBaseId: string;
    title: string;
    status: DocumentStatus;
    kind?: DocumentKind;
    trustStatus?: DocumentTrustStatus;
    verifiedAt?: Date | null;
    verifiedBy?: string | null;
    expiresAt?: Date | null;
    ownerUserId?: string | null;
    externalAcl?: Prisma.JsonValue;
    currentVersionId: string | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    currentVersion?: {
      id: string;
      versionNumber: number;
      mimeType: string;
      byteSize: bigint;
      checksumSha256: string;
      storageKey: string;
      parseStatus: ParseStatus;
      originalFilename: string | null;
      errorMessage: string | null;
      createdAt: Date;
    } | null;
  }) {
    const expired =
      !!doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now();
    const trustStatus =
      expired && doc.trustStatus === DocumentTrustStatus.verified
        ? DocumentTrustStatus.unverified
        : (doc.trustStatus ?? DocumentTrustStatus.unverified);
    return {
      id: doc.id,
      organizationId: doc.organizationId,
      knowledgeBaseId: doc.knowledgeBaseId,
      title: doc.title,
      status: doc.status,
      kind: doc.kind ?? DocumentKind.file,
      trustStatus,
      verifiedAt: doc.verifiedAt ?? null,
      verifiedBy: doc.verifiedBy ?? null,
      expiresAt: doc.expiresAt ?? null,
      ownerUserId: doc.ownerUserId ?? null,
      externalAcl: doc.externalAcl ?? [],
      currentVersionId: doc.currentVersionId,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      currentVersion: doc.currentVersion
        ? {
            id: doc.currentVersion.id,
            versionNumber: doc.currentVersion.versionNumber,
            mimeType: doc.currentVersion.mimeType,
            byteSize: Number(doc.currentVersion.byteSize),
            checksumSha256: doc.currentVersion.checksumSha256,
            storageKey: doc.currentVersion.storageKey,
            parseStatus: doc.currentVersion.parseStatus,
            originalFilename: doc.currentVersion.originalFilename,
            errorMessage: doc.currentVersion.errorMessage,
            createdAt: doc.currentVersion.createdAt,
          }
        : null,
    };
  }

  async updateGovernance(
    orgId: string,
    docId: string,
    user: AuthUser,
    role: OrgRole,
    body: {
      verify?: boolean;
      reject?: boolean;
      expiresAt?: string | null;
      ownerUserId?: string | null;
    },
  ) {
    this.assertWriteRole(role);
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
    });
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }

    const data: Prisma.DocumentUpdateInput = {};
    if (body.verify === true) {
      data.trustStatus = DocumentTrustStatus.verified;
      data.verifiedAt = new Date();
      data.verifier = { connect: { id: user.id } };
    } else if (body.verify === false || body.reject === true) {
      data.trustStatus = body.reject
        ? DocumentTrustStatus.rejected
        : DocumentTrustStatus.unverified;
      data.verifiedAt = null;
      data.verifier = { disconnect: true };
    }
    if (body.expiresAt !== undefined) {
      data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    }
    if (body.ownerUserId !== undefined) {
      data.owner = body.ownerUserId
        ? { connect: { id: body.ownerUserId } }
        : { disconnect: true };
    }

    const updated = await this.prisma.document.update({
      where: { id: docId },
      data,
      include: { currentVersion: true },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.governance_update',
      resourceType: 'document',
      resourceId: docId,
      metadata: body as Prisma.InputJsonValue,
    });

    return this.serializeDocument(updated);
  }

  async createNote(
    orgId: string,
    kbId: string,
    user: AuthUser,
    role: OrgRole,
    body: { title: string; content: string },
  ) {
    this.assertWriteRole(role);
    await this.getActiveKb(orgId, kbId);
    const title = body.title.trim();
    const content = body.content ?? '';
    if (!title) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'title is required',
      });
    }

    const documentId = randomUUID();
    const versionId = randomUUID();
    const filename = `${title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'note'}.md`;
    const buffer = Buffer.from(content, 'utf8');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const storageKey = `orgs/${orgId}/kbs/${kbId}/documents/${documentId}/versions/${versionId}/${filename}`;

    await this.storage.putObject({
      key: storageKey,
      body: buffer,
      contentType: 'text/markdown',
    });

    const job = await this.prisma.$transaction(async (tx) => {
      await tx.document.create({
        data: {
          id: documentId,
          organizationId: orgId,
          knowledgeBaseId: kbId,
          title,
          kind: DocumentKind.note,
          status: DocumentStatus.pending,
          createdBy: user.id,
          ownerUserId: user.id,
          contentChecksum: checksum,
        },
      });
      await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          organizationId: orgId,
          versionNumber: 1,
          storageKey,
          mimeType: 'text/markdown',
          byteSize: BigInt(buffer.length),
          checksumSha256: checksum,
          originalFilename: filename,
          createdBy: user.id,
        },
      });
      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: versionId },
      });
      return tx.ingestionJob.create({
        data: {
          organizationId: orgId,
          documentId,
          documentVersionId: versionId,
          status: IngestionJobStatus.queued,
        },
      });
    });

    await this.ingestionQueue.enqueueParseChunk(job.id);
    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.note_create',
      resourceType: 'document',
      resourceId: documentId,
    });

    const doc = await this.prisma.document.findUniqueOrThrow({
      where: { id: documentId },
      include: { currentVersion: true },
    });
    return {
      ...this.serializeDocument(doc),
      ingestionJob: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
      },
    };
  }

  async createUploadUrl(
    orgId: string,
    kbId: string,
    user: AuthUser,
    role: OrgRole,
    dto: CreateUploadUrlDto,
  ) {
    this.assertWriteRole(role);
    await this.getActiveKb(orgId, kbId);
    this.validateFileMeta(dto.mimeType, dto.filename, dto.byteSize);

    let documentId = dto.documentId ?? randomUUID();
    let versionId = randomUUID();
    let versionNumber = 1;

    if (dto.documentId) {
      const existing = await this.prisma.document.findFirst({
        where: {
          id: dto.documentId,
          organizationId: orgId,
          knowledgeBaseId: kbId,
          deletedAt: null,
        },
        include: {
          versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Document not found',
        });
      }
      documentId = existing.id;
      versionNumber = (existing.versions[0]?.versionNumber ?? 0) + 1;
    }

    const storageKey = this.storage.buildObjectKey({
      organizationId: orgId,
      knowledgeBaseId: kbId,
      documentId,
      versionId,
      filename: dto.filename,
    });

    const presign = await this.storage.createPresignedUpload({
      storageKey,
      mimeType: dto.mimeType,
      byteSize: dto.byteSize,
    });

    return {
      documentId,
      versionId,
      versionNumber,
      title: dto.title?.trim() || dto.filename,
      ...presign,
    };
  }

  async confirmUpload(
    orgId: string,
    kbId: string,
    user: AuthUser,
    role: OrgRole,
    dto: ConfirmDocumentDto,
  ) {
    this.assertWriteRole(role);
    await this.getActiveKb(orgId, kbId);
    this.validateFileMeta(
      dto.mimeType,
      dto.originalFilename || dto.title,
      dto.byteSize,
    );

    const expectedPrefix = `orgs/${orgId}/kbs/${kbId}/documents/`;
    if (!dto.storageKey.startsWith(expectedPrefix)) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'storageKey does not belong to this knowledge base',
      });
    }

    const documentId = dto.documentId ?? randomUUID();
    const versionId = dto.versionId ?? randomUUID();

    const result = await this.prisma.$transaction(async (tx) => {
      let document = await tx.document.findFirst({
        where: {
          id: documentId,
          organizationId: orgId,
          knowledgeBaseId: kbId,
          deletedAt: null,
        },
        include: {
          versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
        },
      });

      let versionNumber = 1;

      if (!document) {
        document = await tx.document.create({
          data: {
            id: documentId,
            organizationId: orgId,
            knowledgeBaseId: kbId,
            title: dto.title.trim(),
            status: DocumentStatus.pending,
            createdBy: user.id,
          },
          include: {
            versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
          },
        });
      } else {
        versionNumber = (document.versions[0]?.versionNumber ?? 0) + 1;
        await tx.document.update({
          where: { id: document.id },
          data: {
            title: dto.title.trim(),
            status: DocumentStatus.pending,
          },
        });
      }

      const version = await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId: document.id,
          organizationId: orgId,
          versionNumber,
          storageKey: dto.storageKey,
          mimeType: dto.mimeType,
          byteSize: BigInt(dto.byteSize),
          checksumSha256: dto.checksum.toLowerCase(),
          parseStatus: ParseStatus.pending,
          originalFilename: dto.originalFilename ?? null,
          createdBy: user.id,
        },
      });

      await tx.document.update({
        where: { id: document.id },
        data: { currentVersionId: version.id },
      });

      const job = await tx.ingestionJob.create({
        data: {
          organizationId: orgId,
          documentId: document.id,
          documentVersionId: version.id,
          status: IngestionJobStatus.queued,
        },
      });

      const full = await tx.document.findUniqueOrThrow({
        where: { id: document.id },
        include: { currentVersion: true },
      });

      return { document: full, job };
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.upload_confirm',
      resourceType: 'document',
      resourceId: result.document.id,
      metadata: {
        versionId: result.document.currentVersionId,
        jobId: result.job.id,
      },
    });

    await this.ingestionQueue.enqueueParseChunk(result.job.id);

    return {
      ...this.serializeDocument(result.document),
      ingestionJob: {
        id: result.job.id,
        status: result.job.status,
        createdAt: result.job.createdAt,
      },
    };
  }

  async list(
    orgId: string,
    kbId: string,
    status?: DocumentStatus,
    userId?: string,
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: { id: kbId, organizationId: orgId, deletedAt: null },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }

    const visible =
      userId != null
        ? await this.acl.visibleDocumentIds(orgId, kbId, userId)
        : null;

    const docs = await this.prisma.document.findMany({
      where: {
        organizationId: orgId,
        knowledgeBaseId: kbId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(visible ? { id: { in: visible } } : {}),
      },
      include: { currentVersion: true },
      orderBy: { createdAt: 'desc' },
    });

    return docs.map((d) => this.serializeDocument(d));
  }

  async getOne(orgId: string, docId: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
      include: { currentVersion: true },
    });
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }
    return this.serializeDocument(doc);
  }

  async createDownloadUrl(
    orgId: string,
    docId: string,
    userId: string,
    versionId?: string,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
      include: { currentVersion: true },
    });
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }

    const visible = await this.acl.visibleDocumentIds(
      orgId,
      doc.knowledgeBaseId,
      userId,
    );
    if (visible && !visible.includes(docId)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'No permission to view this document',
      });
    }

    const version = versionId
      ? await this.prisma.documentVersion.findFirst({
          where: { id: versionId, documentId: docId },
        })
      : doc.currentVersion;

    if (!version?.storageKey) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document file not found',
      });
    }

    const mime = version.mimeType || 'application/octet-stream';
    const filename =
      version.originalFilename || doc.title || `document-${docId}`;
    const inline =
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      mime.startsWith('text/') ||
      mime === 'application/json';

    const signed = await this.storage.createPresignedDownload({
      storageKey: version.storageKey,
      filename,
      mimeType: mime,
      disposition: inline ? 'inline' : 'attachment',
      expiresInSeconds: 600,
    });

    return {
      url: signed.url,
      expiresInSeconds: signed.expiresInSeconds,
      mimeType: mime,
      filename,
      disposition: inline ? 'inline' : 'attachment',
      versionId: version.id,
    };
  }

  async softDelete(orgId: string, docId: string, user: AuthUser, role: OrgRole) {
    this.assertWriteRole(role);
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
    });
    if (!doc) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }

    await this.prisma.document.update({
      where: { id: docId },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: docId,
    });

    return { success: true };
  }

  async listVersions(orgId: string, docId: string) {
    await this.getOne(orgId, docId);
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId: docId, organizationId: orgId },
      orderBy: { versionNumber: 'desc' },
    });
    return versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      mimeType: v.mimeType,
      byteSize: Number(v.byteSize),
      checksumSha256: v.checksumSha256,
      storageKey: v.storageKey,
      parseStatus: v.parseStatus,
      originalFilename: v.originalFilename,
      errorMessage: v.errorMessage,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
    }));
  }

  async activateVersion(
    orgId: string,
    docId: string,
    versionId: string,
    user: AuthUser,
    role: OrgRole,
  ) {
    this.assertWriteRole(role);
    await this.getOne(orgId, docId);

    const version = await this.prisma.documentVersion.findFirst({
      where: { id: versionId, documentId: docId, organizationId: orgId },
    });
    if (!version) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Document version not found',
      });
    }

    const doc = await this.prisma.document.update({
      where: { id: docId },
      data: {
        currentVersionId: version.id,
        status:
          version.parseStatus === ParseStatus.succeeded
            ? DocumentStatus.ready
            : version.parseStatus === ParseStatus.failed
              ? DocumentStatus.failed
              : DocumentStatus.pending,
      },
      include: { currentVersion: true },
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.version_activate',
      resourceType: 'document_version',
      resourceId: versionId,
    });

    return this.serializeDocument(doc);
  }

  async listChunks(orgId: string, docId: string) {
    const doc = await this.getOne(orgId, docId);
    if (!doc.currentVersionId) {
      return [];
    }
    const chunks = await this.prisma.documentChunk.findMany({
      where: {
        organizationId: orgId,
        documentId: docId,
        documentVersionId: doc.currentVersionId,
      },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        chunkIndex: true,
        content: true,
        tokenCount: true,
        metadata: true,
        createdAt: true,
      },
    });
    return chunks;
  }

  async listJobs(orgId: string, docId: string) {
    await this.getOne(orgId, docId);
    const jobs = await this.prisma.ingestionJob.findMany({
      where: { documentId: docId, organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    });
    return jobs.map((j) => ({
      id: j.id,
      documentId: j.documentId,
      documentVersionId: j.documentVersionId,
      status: j.status,
      attempts: j.attempts,
      errorMessage: j.errorMessage,
      startedAt: j.startedAt,
      finishedAt: j.finishedAt,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    }));
  }

  async retryJob(orgId: string, jobId: string, user: AuthUser, role: OrgRole) {
    this.assertWriteRole(role);
    const job = await this.prisma.ingestionJob.findFirst({
      where: { id: jobId, organizationId: orgId },
    });
    if (!job) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Ingestion job not found',
      });
    }
    if (job.status !== IngestionJobStatus.failed) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Only failed jobs can be retried',
      });
    }

    const retried = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ingestionJob.update({
        where: { id: jobId },
        data: {
          status: IngestionJobStatus.queued,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
        },
      });
      await tx.document.update({
        where: { id: job.documentId },
        data: { status: DocumentStatus.pending },
      });
      await tx.documentVersion.update({
        where: { id: job.documentVersionId },
        data: { parseStatus: ParseStatus.pending, errorMessage: null },
      });
      return updated;
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'ingestion_job.retry',
      resourceType: 'ingestion_job',
      resourceId: jobId,
    });

    await this.ingestionQueue.enqueueParseChunk(retried.id);

    return {
      id: retried.id,
      status: retried.status,
      attempts: retried.attempts,
      documentId: retried.documentId,
      documentVersionId: retried.documentVersionId,
    };
  }

  async reprocess(orgId: string, docId: string, user: AuthUser, role: OrgRole) {
    this.assertWriteRole(role);
    const doc = await this.prisma.document.findFirst({
      where: { id: docId, organizationId: orgId, deletedAt: null },
    });
    if (!doc?.currentVersionId) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Document has no current version to reprocess',
      });
    }

    const job = await this.prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: docId },
        data: { status: DocumentStatus.pending },
      });
      await tx.documentVersion.update({
        where: { id: doc.currentVersionId! },
        data: { parseStatus: ParseStatus.pending, errorMessage: null },
      });
      return tx.ingestionJob.create({
        data: {
          organizationId: orgId,
          documentId: docId,
          documentVersionId: doc.currentVersionId!,
          status: IngestionJobStatus.queued,
        },
      });
    });

    await this.audit.log({
      organizationId: orgId,
      actorUserId: user.id,
      action: 'document.reprocess',
      resourceType: 'document',
      resourceId: docId,
      metadata: { jobId: job.id },
    });

    await this.ingestionQueue.enqueueParseChunk(job.id);

    return {
      documentId: docId,
      ingestionJob: {
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
      },
    };
  }
}
