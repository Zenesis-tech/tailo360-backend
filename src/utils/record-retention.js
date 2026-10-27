const RECORD_RETENTION_DAYS = 30;
const RECORD_RETENTION_MS = RECORD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - RECORD_RETENTION_MS);
}

module.exports = { RECORD_RETENTION_DAYS, RECORD_RETENTION_MS, retentionCutoff };
