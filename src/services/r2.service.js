const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

function client() {
  if (!env.R2_ACCOUNT_ID || !env.R2_BUCKET || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Media storage is not configured.');
  }
  return new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } });
}
async function createUploadUrl({ key, contentType }) { return getSignedUrl(client(), new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: env.R2_SIGNED_URL_TTL_SECONDS }); }
async function createReadUrl(key) { return getSignedUrl(client(), new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: env.R2_SIGNED_URL_TTL_SECONDS }); }
async function objectMetadata(key) { return client().send(new HeadObjectCommand({ Bucket: env.R2_BUCKET, Key: key })); }
async function putObject({ key, body, contentType, encrypted = false, bucket = env.R2_BUCKET }) { return client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, ...(encrypted ? { ServerSideEncryption: 'AES256' } : {}) })); }
async function getObject(key, { bucket = env.R2_BUCKET } = {}) {
  const response = await client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) return null;
  return Buffer.from(await response.Body.transformToByteArray());
}
async function deleteObject(key) { return client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })); }
async function listObjects(prefix, { bucket = env.R2_BUCKET } = {}) {
  const rows = [];
  let continuationToken;
  do {
    const response = await client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }));
    rows.push(...(response.Contents || []));
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
  return rows;
}
async function deletePrefix(prefix, { bucket = env.R2_BUCKET } = {}) {
  const rows = await listObjects(prefix, { bucket });
  for (let index = 0; index < rows.length; index += 1000) {
    await client().send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: rows.slice(index, index + 1000).map((row) => ({ Key: row.Key })), Quiet: true } }));
  }
}
module.exports = { createUploadUrl, createReadUrl, objectMetadata, putObject, getObject, deleteObject, listObjects, deletePrefix };
