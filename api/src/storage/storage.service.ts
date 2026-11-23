import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  /** Server-side client (may use Docker-internal MinIO host). */
  private readonly client: S3Client;
  /** Browser-facing client — presign with public host so signatures stay valid. */
  private readonly publicClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = config.getOrThrow<string>('S3_ENDPOINT');
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.publicEndpoint = config.get<string>('S3_PUBLIC_ENDPOINT', endpoint);
    const region = config.get<string>('S3_REGION', 'us-east-1');
    const forcePathStyle =
      config.get<string>('S3_FORCE_PATH_STYLE', 'true') === 'true';
    const credentials = {
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
    };

    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials,
    });

    this.publicClient = new S3Client({
      region,
      endpoint: this.publicEndpoint,
      forcePathStyle,
      credentials,
    });
  }

  async onModuleInit() {
    if (this.config.get<string>('S3_AUTO_CREATE_BUCKET', 'true') !== 'true') {
      return;
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created S3/MinIO bucket: ${this.bucket}`);
      } catch (err) {
        this.logger.warn(
          `Could not ensure bucket "${this.bucket}" exists (MinIO may be down). ${String(err)}`,
        );
      }
    }
  }

  buildObjectKey(params: {
    organizationId: string;
    knowledgeBaseId: string;
    documentId: string;
    versionId: string;
    filename: string;
  }): string {
    const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180);
    return [
      'orgs',
      params.organizationId,
      'kbs',
      params.knowledgeBaseId,
      'documents',
      params.documentId,
      'versions',
      params.versionId,
      safeName || `file-${randomUUID()}`,
    ].join('/');
  }

  async createPresignedUpload(params: {
    storageKey: string;
    mimeType: string;
    byteSize: number;
    expiresInSeconds?: number;
  }) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.storageKey,
      ContentType: params.mimeType,
      ContentLength: params.byteSize,
    });

    // Sign with public endpoint so browser PUT host matches signature.
    const uploadUrl = await getSignedUrl(this.publicClient, command, {
      expiresIn: params.expiresInSeconds ?? 900,
    });

    return {
      uploadUrl,
      storageKey: params.storageKey,
      bucket: this.bucket,
      expiresInSeconds: params.expiresInSeconds ?? 900,
      publicEndpoint: this.publicEndpoint,
    };
  }

  async putObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
        ContentLength: params.body.byteLength,
      }),
    );
    return { storageKey: params.key, bucket: this.bucket };
  }

  async downloadObject(storageKey: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      }),
    );

    const body = response.Body;
    if (!body) {
      throw new Error(`Empty object body for key ${storageKey}`);
    }

    if (typeof body.transformToByteArray === 'function') {
      const bytes = await body.transformToByteArray();
      return Buffer.from(bytes);
    }

    throw new Error(`Unsupported S3 body type for key ${storageKey}`);
  }

  async createPresignedDownload(params: {
    storageKey: string;
    filename?: string;
    mimeType?: string;
    disposition?: 'inline' | 'attachment';
    expiresInSeconds?: number;
  }) {
    const safeName = (params.filename || 'file')
      .replace(/["\\\r\n]/g, '_')
      .slice(0, 180);
    const disposition = params.disposition ?? 'inline';
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: params.storageKey,
      ResponseContentType: params.mimeType,
      ResponseContentDisposition: `${disposition}; filename="${safeName}"`,
    });

    const url = await getSignedUrl(this.publicClient, command, {
      expiresIn: params.expiresInSeconds ?? 600,
    });

    return {
      url,
      expiresInSeconds: params.expiresInSeconds ?? 600,
      publicEndpoint: this.publicEndpoint,
    };
  }
}
