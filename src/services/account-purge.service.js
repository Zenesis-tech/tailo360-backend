const {
  User,
  Studio,
  Member,
  Otp,
  Session,
  Customer,
  Measurement,
  GarmentTemplate,
  Price,
  Order,
  Subscription,
  SubscriptionEvent,
  Referral,
  Idempotency,
  Media,
  Device,
  Notification,
  SupportTicket,
  AuditLog,
  BackupRecord,
  RealtimeEvent,
} = require('../models');
const r2 = require('./r2.service');
const { firebaseAdmin } = require('./firebase-admin.service');

const staleClaimMs = 30 * 60 * 1000;
const rowIds = (rows) => rows.map((row) => row._id);

async function claimExpiredUser(userId, now) {
  return User.findOneAndUpdate(
    {
      _id: userId,
      // Non-null means deletion was requested. This also drains requests
      // created by the former delayed-deletion flow.
      deletionScheduledFor: { $ne: null },
      $or: [
        { purgeStartedAt: null },
        { purgeStartedAt: { $exists: false } },
        { purgeStartedAt: { $lte: new Date(now.getTime() - staleClaimMs) } },
      ],
    },
    {
      $set: { purgeStartedAt: now, deletedAt: now, purgeLastError: null },
      $inc: { purgeAttempts: 1 },
    },
    { new: true },
  );
}

async function deleteStoredMedia(media) {
  // Storage goes first. On an R2 failure the user remains as a retry marker,
  // and no object key is discarded from the database.
  for (const row of media) await r2.deleteObject(row.objectKey);
}

async function deleteFirebaseIdentity(firebaseUid) {
  if (!firebaseUid) return;
  try {
    await firebaseAdmin({ required: true }).auth().deleteUser(firebaseUid);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return;
    throw error;
  }
}

async function scrubUserReferences(userId, ownedStudioIds) {
  const outsideOwnedStudios = ownedStudioIds.length
    ? { studioId: { $nin: ownedStudioIds } }
    : {};
  const retainedMedia = await Media.find({
    ...outsideOwnedStudios,
    ownerUserId: userId,
    studioId: { $ne: null, ...(ownedStudioIds.length ? { $nin: ownedStudioIds } : {}) },
  }).select('_id studioId').lean();
  if (retainedMedia.length) {
    const retainedStudioIds = [...new Set(retainedMedia.map((row) => String(row.studioId)))];
    const retainedStudios = await Studio.find({ _id: { $in: retainedStudioIds } })
      .select('_id ownerUserId')
      .lean();
    const ownerByStudio = new Map(
      retainedStudios.map((studio) => [String(studio._id), studio.ownerUserId]),
    );
    const operations = retainedMedia
      .filter((row) => ownerByStudio.has(String(row.studioId)))
      .map((row) => ({
        updateOne: {
          filter: { _id: row._id, ownerUserId: userId },
          update: { $set: { ownerUserId: ownerByStudio.get(String(row.studioId)) } },
        },
      }));
    if (operations.length) await Media.bulkWrite(operations);
  }

  await Promise.all([
    Measurement.updateMany(
      { ...outsideOwnedStudios, createdBy: userId },
      { $unset: { createdBy: '' } },
    ),
    Measurement.updateMany(
      { ...outsideOwnedStudios, restoredBy: userId },
      { $unset: { restoredBy: '' } },
    ),
    Order.updateMany(
      { ...outsideOwnedStudios, 'payments.recordedBy': userId },
      { $unset: { 'payments.$[item].recordedBy': '' } },
      { arrayFilters: [{ 'item.recordedBy': userId }] },
    ),
    Order.updateMany(
      { ...outsideOwnedStudios, 'activity.actorId': userId },
      { $unset: { 'activity.$[item].actorId': '' } },
      { arrayFilters: [{ 'item.actorId': userId }] },
    ),
    Notification.updateMany(
      { ...outsideOwnedStudios, createdBy: userId },
      { $unset: { createdBy: '' } },
    ),
    SupportTicket.updateMany(
      { ...outsideOwnedStudios, 'messages.authorId': userId },
      { $unset: { 'messages.$[item].authorId': '' } },
      { arrayFilters: [{ 'item.authorId': userId }] },
    ),
    SupportTicket.updateMany(
      { ...outsideOwnedStudios, assignedTo: userId },
      { $unset: { assignedTo: '' } },
    ),
    Subscription.updateMany(
      { ...outsideOwnedStudios, 'adminGrant.grantedBy': userId },
      { $unset: { 'adminGrant.grantedBy': '' } },
    ),
    Media.updateMany(
      { ...outsideOwnedStudios, ownerUserId: userId },
      { $unset: { ownerUserId: '' } },
    ),
    BackupRecord.updateMany(
      { createdBy: userId },
      { $unset: { createdBy: '' } },
    ),
  ]);
}

async function purgeAccount(userId, now = new Date()) {
  const user = await claimExpiredUser(userId, now);
  if (!user) return false;

  try {
    const ownedStudios = await Studio.find({ ownerUserId: user._id })
      .select('_id')
      .lean();
    const studioIds = rowIds(ownedStudios);
    const studioFilter = { studioId: { $in: studioIds } };

    const [studioMedia, templates, orders, subscriptions, tickets] = studioIds.length
      ? await Promise.all([
        Media.find(studioFilter).select('_id objectKey').lean(),
        GarmentTemplate.find(studioFilter).select('_id').lean(),
        Order.find(studioFilter).select('_id').lean(),
        Subscription.find(studioFilter).select('_id').lean(),
        SupportTicket.find(studioFilter).select('_id').lean(),
      ])
      : [[], [], [], [], []];

    await deleteFirebaseIdentity(user.firebaseUid);
    await deleteStoredMedia(studioMedia);
    await scrubUserReferences(user._id, studioIds);

    if (studioIds.length) {
      const auditTargetIds = [
        ...studioIds,
        ...rowIds(templates),
        ...rowIds(orders),
        ...rowIds(subscriptions),
        ...rowIds(tickets),
      ].map(String);

      await Promise.all([
        Member.deleteMany(studioFilter),
        Customer.deleteMany(studioFilter),
        Measurement.deleteMany(studioFilter),
        GarmentTemplate.deleteMany(studioFilter),
        Price.deleteMany(studioFilter),
        Order.deleteMany(studioFilter),
        Subscription.deleteMany(studioFilter),
        SubscriptionEvent.deleteMany(studioFilter),
        Referral.deleteMany({
          $or: [
            { referrerStudioId: { $in: studioIds } },
            { refereeStudioId: { $in: studioIds } },
          ],
        }),
        Idempotency.deleteMany(studioFilter),
        Media.deleteMany(studioFilter),
        Device.deleteMany(studioFilter),
        Notification.deleteMany(studioFilter),
        SupportTicket.deleteMany(studioFilter),
        RealtimeEvent.deleteMany(studioFilter),
        AuditLog.deleteMany({ targetId: { $in: auditTargetIds } }),
      ]);
      await Studio.deleteMany({ _id: { $in: studioIds } });
    }

    await Promise.all([
      Member.deleteMany({ userId: user._id }),
      Session.deleteMany({ userId: user._id }),
      Device.deleteMany({ userId: user._id }),
      Notification.deleteMany({ userId: user._id }),
      AuditLog.deleteMany({
        $or: [
          { actorId: user._id },
          { targetType: 'user', targetId: String(user._id) },
        ],
      }),
      Otp.deleteMany({ phone: user.phone }),
    ]);

    // Keep the user document until last because it is also the retry marker.
    await User.deleteOne({ _id: user._id });
    return true;
  } catch (error) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          purgeStartedAt: null,
          purgeLastError: String(error?.message || 'Account purge failed').slice(0, 500),
        },
      },
    ).catch(() => {});
    throw error;
  }
}

async function purgeExpiredAccounts(now = new Date(), { limit = 20 } = {}) {
  const candidates = await User.find({
    // Account deletion is immediate; the marker is retained only while a
    // purge is being retried after an infrastructure failure.
    deletionScheduledFor: { $ne: null },
    $or: [
      { purgeStartedAt: null },
      { purgeStartedAt: { $exists: false } },
      { purgeStartedAt: { $lte: new Date(now.getTime() - staleClaimMs) } },
    ],
  })
    .select('_id')
    .sort({ deletionScheduledFor: 1 })
    .limit(limit)
    .lean();

  let purged = 0;
  const failures = [];
  for (const candidate of candidates) {
    try {
      if (await purgeAccount(candidate._id, now)) purged += 1;
    } catch (error) {
      failures.push({ userId: String(candidate._id), error });
    }
  }
  return { scanned: candidates.length, purged, failures };
}

module.exports = { purgeAccount, purgeExpiredAccounts };
