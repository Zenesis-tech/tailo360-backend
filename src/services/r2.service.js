const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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
async function putObject({ key, body, contentType }) { return client().send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: contentType })); }
async function deleteObject(key) { return client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key })); }
module.exports = { createUploadUrl, createReadUrl, objectMetadata, putObject, deleteObject };
