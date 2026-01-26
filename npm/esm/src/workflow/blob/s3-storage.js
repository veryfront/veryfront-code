/**
 * S3 Blob Storage
 *
 * Stores blobs in AWS S3.
 *
 * NOTE: This module uses dynamic imports for @aws-sdk/client-s3 to avoid
 * requiring the AWS SDK as a mandatory dependency. The SDK is only loaded
 * when S3BlobStorage is instantiated.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { agentLogger as logger } from "../../utils/index.js";
import { isDeno } from "../../platform/compat/runtime.js";
let s3Module = null;
async function getS3Module() {
    if (s3Module)
        return s3Module;
    try {
        s3Module = isDeno
            ? await import("@aws-sdk/client-s3")
            : await import("@aws-sdk/client-s3");
        return s3Module;
    }
    catch (error) {
        throw new Error(`Failed to load @aws-sdk/client-s3. Please install it: npm install @aws-sdk/client-s3\n` +
            `Original error: ${error instanceof Error ? error.message : String(error)}`);
    }
}
export class S3BlobStorage {
    config;
    client = null;
    initPromise = null;
    constructor(config) {
        this.config = config;
        this.initPromise = this.initialize();
    }
    async initialize() {
        const { S3Client } = await getS3Module();
        this.client = new S3Client({
            region: this.config.region,
            credentials: {
                accessKeyId: this.config.accessKeyId,
                secretAccessKey: this.config.secretAccessKey,
            },
            endpoint: this.config.endpoint,
            forcePathStyle: this.config.forcePathStyle,
        });
    }
    async ensureInitialized() {
        if (this.initPromise) {
            await this.initPromise;
            this.initPromise = null;
        }
        if (!this.client)
            throw new Error("S3BlobStorage: Client failed to initialize");
        return this.client;
    }
    getKey(id) {
        return this.config.prefix ? `${this.config.prefix}${id}` : id;
    }
    async put(data, options = {}) {
        const client = await this.ensureInitialized();
        const { PutObjectCommand, CreateBucketCommand, HeadObjectCommand } = await getS3Module();
        const id = options.id ?? dntShim.crypto.randomUUID();
        const key = this.getKey(id);
        const mimeType = options.mimeType ?? "application/octet-stream";
        const createdAt = new Date();
        const ttl = options.ttl ?? this.config.defaultTtl;
        const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;
        let body;
        let contentLength;
        if (typeof data === "string") {
            const bytes = new TextEncoder().encode(data);
            body = bytes;
            contentLength = bytes.byteLength;
        }
        else if (data instanceof Uint8Array) {
            body = data;
            contentLength = data.byteLength;
        }
        else if (data instanceof dntShim.Blob) {
            body = data;
            contentLength = data.size;
        }
        else if (data instanceof ReadableStream) {
            body = data;
        }
        else {
            throw new Error("Unsupported data type for S3BlobStorage");
        }
        const putCommand = new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: key,
            Body: body,
            ContentType: mimeType,
            ContentLength: contentLength,
            Expires: expiresAt,
            Metadata: options.metadata,
        });
        try {
            await client.send(putCommand);
        }
        catch (e) {
            const name = e?.name;
            if (name !== "NoSuchBucket" || !this.config.autoCreateBucket)
                throw e;
            try {
                await client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
                await client.send(putCommand);
            }
            catch (createError) {
                logger.error("Failed to auto-create bucket:", createError);
                throw e;
            }
        }
        let size = contentLength ?? 0;
        if (size === 0) {
            try {
                const headResult = await client.send(new HeadObjectCommand({
                    Bucket: this.config.bucket,
                    Key: key,
                }));
                size = headResult.ContentLength ?? 0;
            }
            catch (e) {
                logger.warn(`Could not get size for S3 blob ${key} after put:`, e);
            }
        }
        return {
            __kind: "blob",
            id,
            size,
            mimeType,
            createdAt,
            expiresAt,
            metadata: options.metadata,
            url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : undefined,
        };
    }
    async getStream(id) {
        const client = await this.ensureInitialized();
        const { GetObjectCommand } = await getS3Module();
        const key = this.getKey(id);
        try {
            const response = await client.send(new GetObjectCommand({
                Bucket: this.config.bucket,
                Key: key,
            }));
            return response.Body ?? null;
        }
        catch (e) {
            if (e instanceof Error && e.name === "NoSuchKey")
                return null;
            throw e;
        }
    }
    async getText(id) {
        const stream = await this.getStream(id);
        if (!stream)
            return null;
        // @ts-ignore - Deno's ReadableStream vs Web ReadableStream type mismatch
        return await new dntShim.Response(stream).text();
    }
    async getBytes(id) {
        const stream = await this.getStream(id);
        if (!stream)
            return null;
        // @ts-ignore - Deno's ReadableStream vs Web ReadableStream type mismatch
        const buffer = await new dntShim.Response(stream).arrayBuffer();
        return new Uint8Array(buffer);
    }
    async delete(id) {
        const client = await this.ensureInitialized();
        const { DeleteObjectCommand } = await getS3Module();
        const key = this.getKey(id);
        try {
            await client.send(new DeleteObjectCommand({
                Bucket: this.config.bucket,
                Key: key,
            }));
        }
        catch (e) {
            if (e instanceof Error && e.name === "NoSuchKey")
                return;
            throw e;
        }
    }
    async exists(id) {
        const client = await this.ensureInitialized();
        const { HeadObjectCommand } = await getS3Module();
        const key = this.getKey(id);
        try {
            await client.send(new HeadObjectCommand({
                Bucket: this.config.bucket,
                Key: key,
            }));
            return true;
        }
        catch (e) {
            if (e instanceof Error && e.name === "NotFound")
                return false;
            throw e;
        }
    }
    async stat(id) {
        const client = await this.ensureInitialized();
        const { HeadObjectCommand } = await getS3Module();
        const key = this.getKey(id);
        try {
            const headResult = await client.send(new HeadObjectCommand({
                Bucket: this.config.bucket,
                Key: key,
            }));
            if (!headResult.LastModified)
                return null;
            const metadata = {};
            for (const [k, v] of Object.entries(headResult.Metadata ?? {})) {
                if (v != null)
                    metadata[k] = v;
            }
            let expiresAt;
            if (headResult.Expires) {
                expiresAt = new Date(headResult.Expires);
            }
            else {
                const raw = headResult.Metadata?.["expiresat"];
                if (raw)
                    expiresAt = new Date(raw);
            }
            return {
                __kind: "blob",
                id,
                size: headResult.ContentLength ?? 0,
                mimeType: headResult.ContentType ?? "application/octet-stream",
                createdAt: headResult.LastModified,
                expiresAt,
                metadata,
                url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : undefined,
            };
        }
        catch (e) {
            if (e instanceof Error && e.name === "NotFound")
                return null;
            throw e;
        }
    }
}
