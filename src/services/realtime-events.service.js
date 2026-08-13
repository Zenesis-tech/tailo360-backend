const { Server } = require("socket.io");
const { Types } = require("mongoose");
const env = require("../config/env");
const { RealtimeEvent } = require("../models");

const replayLimit = 500;
const retentionMs = 7 * 24 * 60 * 60 * 1000;
let io;

function roomForStudio(studioId) {
  return `studio:${studioId}`;
}

function roomForUser(userId) {
  return `user:${userId}`;
}

function accessToken(socket) {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken) return authToken;
  return socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
}

function initialize(server) {
  if (io) return io;
  io = new Server(server, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    cors: {
      origin(origin, callback) {
        if (!origin || env.ALLOWED_ORIGINS.length === 0 || env.ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Origin is not allowed by CORS."));
      },
      credentials: false,
    },
  });
  io.use(async (socket, next) => {
    try {
      // Resolve lazily to avoid the auth -> subscription -> notification ->
      // realtime service cycle during application bootstrap.
      const { authenticateToken } = require("../middleware/auth");
      socket.data.auth = await authenticateToken(accessToken(socket));
      next();
    } catch (error) {
      const socketError = new Error("Authentication failed.");
      socketError.data = { code: error.code || "TOKEN_INVALID" };
      next(socketError);
    }
  });
  io.on("connection", async (socket) => {
    const { studio, user } = socket.data.auth;
    socket.join(roomForStudio(studio.id));
    socket.join(roomForUser(user.id));
    socket.emit("sync.connected", { serverTime: new Date().toISOString() });
    await replay(socket, socket.handshake.auth?.lastEventId);
  });
  return io;
}

function serialize(row) {
  return {
    eventId: row.id,
    resource: row.resource,
    action: row.action,
    id: row.entityId || row.data?._id || row.data?.id || null,
    data: row.data ?? null,
    version: Number(row.data?.version || 0),
    updatedAt: row.data?.updatedAt || row.createdAt.toISOString(),
    occurredAt: row.createdAt.toISOString(),
    requestId: row.requestId || null,
  };
}

async function replay(socket, lastEventId) {
  if (!lastEventId) {
    socket.emit("sync.required", { reason: "initial_connect" });
    return;
  }
  if (!Types.ObjectId.isValid(lastEventId)) {
    socket.emit("sync.required", { reason: "invalid_cursor" });
    return;
  }
  const { studio, user } = socket.data.auth;
  const cursor = await RealtimeEvent.findById(lastEventId).select("studioId");
  if (!cursor || String(cursor.studioId) !== studio.id) {
    socket.emit("sync.required", { reason: "expired_cursor" });
    return;
  }
  const rows = await RealtimeEvent.find({
    studioId: studio._id,
    _id: { $gt: cursor._id },
    $or: [{ userIds: { $size: 0 } }, { userIds: user._id }],
  }).sort({ _id: 1 }).limit(replayLimit + 1);
  for (const row of rows.slice(0, replayLimit)) socket.emit("crm.change", serialize(row));
  if (rows.length > replayLimit) socket.emit("sync.required", { reason: "replay_limit" });
  else socket.emit("sync.complete", { replayed: rows.length });
}

async function publish(studioId, payload = {}, options = {}) {
  if (!studioId) return null;
  const data = payload.data?.toObject
    ? payload.data.toObject({ flattenMaps: true })
    : payload.data;
  const row = await RealtimeEvent.create({
    studioId,
    userIds: options.userIds || [],
    resource: payload.resource || "data",
    action: payload.action || "updated",
    entityId: payload.id || data?._id || data?.id,
    data,
    requestId: payload.requestId,
    expiresAt: new Date(Date.now() + retentionMs),
  });
  const event = serialize(row);
  if (io) {
    const userIds = options.userIds || [];
    if (userIds.length) userIds.forEach((id) => io.to(roomForUser(id)).emit("crm.change", event));
    else io.to(roomForStudio(studioId)).emit("crm.change", event);
  }
  return event;
}

module.exports = { initialize, publish, replay };
