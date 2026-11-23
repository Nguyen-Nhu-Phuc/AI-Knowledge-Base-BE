import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { basename, extname, join } from 'path';
import {
  ConnectorStatus,
  ConnectorSyncStatus,
  ConnectorType,
  DocumentStatus,
  IngestionJobStatus,
  ParseStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { IngestionQueueService } from '../queue/ingestion-queue.service';
import { ConnectorSyncQueueService } from '../queue/connector-sync-queue.service';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
} from '../common/constants/upload.constants';
import type { AuthUser } from '../auth/types/auth-user.type';

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

@Injectable()
export class ConnectorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ingestionQueue: IngestionQueueService,
    private readonly syncQueue: ConnectorSyncQueueService,
  ) {}

  list(orgId: string) {
    return this.prisma.connector.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: {
        syncRuns: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
    });
  }

  async create(
    orgId: string,
    user: AuthUser,
    body: {
      knowledgeBaseId: string;
      type:
        | 'local_folder'
        | 'google_drive'
        | 'notion'
        | 'confluence'
        | 'slack_export';
      name: string;
      config: Record<string, unknown>;
    },
  ) {
    const kb = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: body.knowledgeBaseId,
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!kb) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Knowledge base not found',
      });
    }
    if (body.type === 'local_folder') {
      const folderPath = String(body.config.folderPath || '');
      if (!folderPath) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'config.folderPath is required for local_folder',
        });
      }
    }
    if (body.type === 'google_drive') {
      const folderId = String(body.config.folderId || '');
      if (!folderId) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'config.folderId is required for google_drive',
        });
      }
    }
    if (body.type === 'notion') {
      const exportPath = String(body.config.exportPath || '');
      const token = String(body.config.apiToken || '');
      if (!exportPath && !token) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'notion requires config.exportPath or config.apiToken',
        });
      }
    }
    if (body.type === 'confluence') {
      const exportPath = String(body.config.exportPath || '');
      const baseUrl = String(body.config.baseUrl || '');
      if (!exportPath && !baseUrl) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'confluence requires config.exportPath or config.baseUrl',
        });
      }
    }
    if (body.type === 'slack_export') {
      const exportPath = String(body.config.exportPath || '');
      if (!exportPath) {
        throw new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'config.exportPath is required for slack_export',
        });
      }
    }

    return this.prisma.connector.create({
      data: {
        organizationId: orgId,
        knowledgeBaseId: body.knowledgeBaseId,
        type: body.type as ConnectorType,
        name: body.name.trim(),
        config: body.config as Prisma.InputJsonValue,
        createdBy: user.id,
      },
    });
  }

  async syncNow(orgId: string, connectorId: string) {
    const connector = await this.prisma.connector.findFirst({
      where: { id: connectorId, organizationId: orgId },
    });
    if (!connector) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Connector not found',
      });
    }
    const run = await this.prisma.connectorSyncRun.create({
      data: {
        connectorId,
        organizationId: orgId,
        status: ConnectorSyncStatus.queued,
      },
    });
    await this.syncQueue.enqueue(run.id);
    return run;
  }

  async runSync(runId: string) {
    const run = await this.prisma.connectorSyncRun.findUnique({
      where: { id: runId },
      include: { connector: true },
    });
    if (!run) return;

    await this.prisma.connectorSyncRun.update({
      where: { id: runId },
      data: { status: ConnectorSyncStatus.running, startedAt: new Date() },
    });

    try {
      let stats: Record<string, unknown>;
      switch (run.connector.type) {
        case ConnectorType.local_folder:
          stats = await this.syncLocalFolder(run.connector);
          break;
        case ConnectorType.google_drive:
          stats = await this.syncGoogleDrive(run.connector);
          break;
        case ConnectorType.notion:
          stats = await this.syncExportFolder(run.connector, 'notion');
          break;
        case ConnectorType.confluence:
          stats = await this.syncExportFolder(run.connector, 'confluence');
          break;
        case ConnectorType.slack_export:
          stats = await this.syncSlackExport(run.connector);
          break;
        default:
          throw new Error(`Unsupported connector type: ${run.connector.type}`);
      }

      await this.prisma.connectorSyncRun.update({
        where: { id: runId },
        data: {
          status: ConnectorSyncStatus.succeeded,
          stats: stats as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      await this.prisma.connector.update({
        where: { id: run.connectorId },
        data: {
          lastSyncAt: new Date(),
          status: ConnectorStatus.active,
          cursor: ((stats.cursor || {}) as Prisma.InputJsonValue),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.connectorSyncRun.update({
        where: { id: runId },
        data: {
          status: ConnectorSyncStatus.failed,
          error: message,
          finishedAt: new Date(),
        },
      });
      await this.prisma.connector.update({
        where: { id: run.connectorId },
        data: { status: ConnectorStatus.error },
      });
    }
  }

  private async syncLocalFolder(connector: {
    id: string;
    organizationId: string;
    knowledgeBaseId: string;
    createdBy: string;
    config: unknown;
  }) {
    const cfg = (connector.config || {}) as { folderPath?: string };
    const folderPath = cfg.folderPath || '';
    if (!existsSync(folderPath)) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    const entries = await fs.readdir(folderPath);
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const name of entries) {
      const full = join(folderPath, name);
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      const ext = extname(name).toLowerCase();
      if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
        skipped += 1;
        continue;
      }
      const mime = EXT_MIME[ext] || 'application/octet-stream';
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
        skipped += 1;
        continue;
      }
      const buf = await fs.readFile(full);
      const checksum = createHash('sha256').update(buf).digest('hex');
      const externalId = full;
      const result = await this.upsertExternalDocument({
        orgId: connector.organizationId,
        kbId: connector.knowledgeBaseId,
        userId: connector.createdBy,
        title: basename(name),
        filename: name,
        mimeType: mime,
        buffer: buf,
        checksum,
        externalId,
        externalSource: `local_folder:${connector.id}`,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    return { created, updated, skipped, cursor: { scannedAt: new Date().toISOString() } };
  }

  private async syncGoogleDrive(connector: {
    id: string;
    organizationId: string;
    knowledgeBaseId: string;
    createdBy: string;
    config: unknown;
    cursor: unknown;
  }) {
    const cfg = (connector.config || {}) as {
      folderId?: string;
      accessToken?: string;
      refreshToken?: string;
    };
    const folderId = cfg.folderId;
    if (!folderId) throw new Error('google_drive config.folderId missing');

    const token = cfg.accessToken || cfg.refreshToken;
    if (!token) {
      throw new Error(
        'google_drive requires config.accessToken or config.refreshToken. ' +
          'Set OAuth tokens in connector config after authorizing the Google app.',
      );
    }

    // List files in folder via Drive API v3
    const listUrl = new URL('https://www.googleapis.com/drive/v3/files');
    listUrl.searchParams.set('q', `'${folderId}' in parents and trashed=false`);
    listUrl.searchParams.set(
      'fields',
      'files(id,name,mimeType,md5Checksum,modifiedTime,permissions(emailAddress,type,role,domain))',
    );
    listUrl.searchParams.set('pageSize', '100');

    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const detail = await listRes.text();
      throw new Error(`Drive list failed (${listRes.status}): ${detail.slice(0, 300)}`);
    }
    const data = (await listRes.json()) as {
      files?: Array<{
        id: string;
        name: string;
        mimeType: string;
        md5Checksum?: string;
        permissions?: Array<{
          emailAddress?: string;
          type?: string;
          role?: string;
          domain?: string;
        }>;
      }>;
    };

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const file of data.files || []) {
      const name = file.name || file.id;
      const ext = extname(name).toLowerCase();
      let mime = file.mimeType;
      // Google Docs export as plain text / PDF not in v1 — skip native Google types
      if (mime.startsWith('application/vnd.google-apps.')) {
        skipped += 1;
        continue;
      }
      if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext) &&
          !(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
        skipped += 1;
        continue;
      }
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
        mime = EXT_MIME[ext] || mime;
      }

      const dl = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dl.ok) {
        skipped += 1;
        continue;
      }
      const ab = await dl.arrayBuffer();
      const buf = Buffer.from(ab);
      const checksum =
        file.md5Checksum ||
        createHash('sha256').update(buf).digest('hex');

      const externalAcl = (file.permissions || [])
        .filter((p) => p.emailAddress || p.domain || p.type === 'anyone')
        .map((p) => ({
          email: p.emailAddress || null,
          type: p.type || 'user',
          role: p.role || 'reader',
          domain: p.domain || null,
        }));

      const result = await this.upsertExternalDocument({
        orgId: connector.organizationId,
        kbId: connector.knowledgeBaseId,
        userId: connector.createdBy,
        title: name,
        filename: name,
        mimeType: mime,
        buffer: buf,
        checksum,
        externalId: file.id,
        externalSource: `google_drive:${connector.id}`,
        externalAcl,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    return {
      created,
      updated,
      skipped,
      cursor: { syncedAt: new Date().toISOString() },
    };
  }

  /** Notion / Confluence: sync markdown/text export folder (or API dump). */
  private async syncExportFolder(
    connector: {
      id: string;
      organizationId: string;
      knowledgeBaseId: string;
      createdBy: string;
      config: unknown;
    },
    source: 'notion' | 'confluence',
  ) {
    const cfg = (connector.config || {}) as { exportPath?: string };
    const folderPath = cfg.exportPath || '';
    if (!folderPath || !existsSync(folderPath)) {
      throw new Error(
        `${source} exportPath missing or not found. Set config.exportPath to a local export directory.`,
      );
    }
    const entries = await fs.readdir(folderPath);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const allowed = new Set(['.md', '.markdown', '.txt', '.html', '.pdf', '.docx']);

    for (const name of entries) {
      const full = join(folderPath, name);
      const st = await fs.stat(full);
      if (!st.isFile()) continue;
      const ext = extname(name).toLowerCase();
      if (!allowed.has(ext)) {
        skipped += 1;
        continue;
      }
      const mime = EXT_MIME[ext] || 'text/plain';
      const buf = await fs.readFile(full);
      const checksum = createHash('sha256').update(buf).digest('hex');
      const result = await this.upsertExternalDocument({
        orgId: connector.organizationId,
        kbId: connector.knowledgeBaseId,
        userId: connector.createdBy,
        title: basename(name, ext),
        filename: name,
        mimeType: mime,
        buffer: buf,
        checksum,
        externalId: full,
        externalSource: `${source}:${connector.id}`,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    return {
      created,
      updated,
      skipped,
      cursor: { scannedAt: new Date().toISOString() },
    };
  }

  /** Slack workspace export: channel JSON → markdown notes. */
  private async syncSlackExport(connector: {
    id: string;
    organizationId: string;
    knowledgeBaseId: string;
    createdBy: string;
    config: unknown;
  }) {
    const cfg = (connector.config || {}) as { exportPath?: string };
    const root = cfg.exportPath || '';
    if (!root || !existsSync(root)) {
      throw new Error(`slack_export exportPath not found: ${root}`);
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const channels = await fs.readdir(root);

    for (const channel of channels) {
      const channelDir = join(root, channel);
      const st = await fs.stat(channelDir);
      if (!st.isDirectory()) continue;
      const files = (await fs.readdir(channelDir)).filter((f) =>
        f.endsWith('.json'),
      );
      const lines: string[] = [`# Slack #${channel}`, ''];
      for (const file of files.slice(0, 50)) {
        try {
          const raw = await fs.readFile(join(channelDir, file), 'utf8');
          const msgs = JSON.parse(raw) as Array<{
            user?: string;
            text?: string;
            ts?: string;
          }>;
          for (const m of msgs) {
            if (!m.text) continue;
            lines.push(`- **${m.user || 'user'}** (${m.ts || ''}): ${m.text}`);
          }
        } catch {
          skipped += 1;
        }
      }
      if (lines.length <= 2) {
        skipped += 1;
        continue;
      }
      const content = lines.join('\n');
      const buf = Buffer.from(content, 'utf8');
      const checksum = createHash('sha256').update(buf).digest('hex');
      const result = await this.upsertExternalDocument({
        orgId: connector.organizationId,
        kbId: connector.knowledgeBaseId,
        userId: connector.createdBy,
        title: `Slack #${channel}`,
        filename: `${channel}.md`,
        mimeType: 'text/markdown',
        buffer: buf,
        checksum,
        externalId: channelDir,
        externalSource: `slack_export:${connector.id}`,
      });
      if (result === 'created') created += 1;
      else if (result === 'updated') updated += 1;
      else skipped += 1;
    }

    return {
      created,
      updated,
      skipped,
      cursor: { scannedAt: new Date().toISOString() },
    };
  }

  private async upsertExternalDocument(params: {
    orgId: string;
    kbId: string;
    userId: string;
    title: string;
    filename: string;
    mimeType: string;
    buffer: Buffer;
    checksum: string;
    externalId: string;
    externalSource: string;
    externalAcl?: Array<Record<string, unknown>>;
  }): Promise<'created' | 'updated' | 'skipped'> {
    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId: params.orgId,
        externalSource: params.externalSource,
        externalId: params.externalId,
        deletedAt: null,
      },
      include: { currentVersion: true },
    });

    if (
      existing?.contentChecksum &&
      existing.contentChecksum === params.checksum &&
      existing.status === DocumentStatus.ready
    ) {
      return 'skipped';
    }

    const documentId = existing?.id ?? randomUUID();
    const versionId = randomUUID();
    const storageKey = `orgs/${params.orgId}/kbs/${params.kbId}/documents/${documentId}/versions/${versionId}/${params.filename}`;

    await this.storage.putObject({
      key: storageKey,
      body: params.buffer,
      contentType: params.mimeType,
    });

    const versionNumber = existing
      ? (await this.prisma.documentVersion.count({
          where: { documentId: existing.id },
        })) + 1
      : 1;

    const job = await this.prisma.$transaction(async (tx) => {
      const aclJson = (params.externalAcl ||
        []) as Prisma.InputJsonValue;
      if (!existing) {
        await tx.document.create({
          data: {
            id: documentId,
            organizationId: params.orgId,
            knowledgeBaseId: params.kbId,
            title: params.title,
            status: DocumentStatus.pending,
            createdBy: params.userId,
            externalId: params.externalId,
            externalSource: params.externalSource,
            contentChecksum: params.checksum,
            externalAcl: aclJson,
          },
        });
      } else {
        await tx.document.update({
          where: { id: documentId },
          data: {
            title: params.title,
            status: DocumentStatus.pending,
            contentChecksum: params.checksum,
            externalAcl: aclJson,
          },
        });
      }

      await tx.documentVersion.create({
        data: {
          id: versionId,
          documentId,
          organizationId: params.orgId,
          versionNumber,
          storageKey,
          mimeType: params.mimeType,
          byteSize: BigInt(params.buffer.byteLength),
          checksumSha256: params.checksum,
          parseStatus: ParseStatus.pending,
          originalFilename: params.filename,
          createdBy: params.userId,
        },
      });

      await tx.document.update({
        where: { id: documentId },
        data: { currentVersionId: versionId },
      });

      return tx.ingestionJob.create({
        data: {
          organizationId: params.orgId,
          documentId,
          documentVersionId: versionId,
          status: IngestionJobStatus.queued,
        },
      });
    });

    await this.ingestionQueue.enqueueParseChunk(job.id);

    if (params.externalAcl?.length) {
      await this.mapExternalAclToGrants(
        params.orgId,
        documentId,
        params.externalAcl,
      );
    }

    return existing ? 'updated' : 'created';
  }

  /** Map Drive/source emails to DocumentAcl for matching org members. */
  private async mapExternalAclToGrants(
    orgId: string,
    documentId: string,
    externalAcl: Array<Record<string, unknown>>,
  ) {
    const emails = externalAcl
      .map((e) => String(e.email || '').toLowerCase())
      .filter(Boolean);
    if (!emails.length) return;

    const members = await this.prisma.organizationMember.findMany({
      where: { organizationId: orgId },
      include: { user: { select: { id: true, email: true } } },
    });
    const byEmail = new Map(
      members.map((m) => [m.user.email.toLowerCase(), m.user.id]),
    );

    for (const email of emails) {
      const userId = byEmail.get(email);
      if (!userId) continue;
      await this.prisma.documentAcl.upsert({
        where: {
          documentId_principalType_principalId: {
            documentId,
            principalType: 'user',
            principalId: userId,
          },
        },
        create: {
          documentId,
          principalType: 'user',
          principalId: userId,
          permission: 'read',
        },
        update: { permission: 'read' },
      });
    }
  }

  async remove(orgId: string, connectorId: string) {
    await this.prisma.connector.deleteMany({
      where: { id: connectorId, organizationId: orgId },
    });
    return { success: true };
  }
}
