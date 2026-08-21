const { z } = require("zod");
const { Member, User, Session } = require("../models");
const { AppError, notFound } = require("../utils/errors");

const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s|-/g, ""))
  .refine((value) => /^\+?[1-9]\d{9,14}$/.test(value), "Use a valid mobile number.")
  .transform((value) => (value.startsWith("+") ? value : `+91${value}`));
const staffRole = z.enum(["master_tailor", "front_desk"]);

function serialize(member) {
  const user = member.userId && typeof member.userId === "object"
    ? member.userId
    : null;
  return {
    _id: member.id,
    name: member.name || user?.name || "Staff member",
    phone: member.phone,
    role: member.role,
    status: member.status,
    version: member.version,
    linked: Boolean(user),
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

async function revokeMemberSessions(member) {
  if (!member.userId) return;
  await Session.updateMany(
    { userId: member.userId, revokedAt: null },
    { revokedAt: new Date() },
  );
}

async function assertAvailableIdentity(phone, excludedMemberId) {
  const membership = await Member.findOne({
    phone,
    status: { $ne: "removed" },
    ...(excludedMemberId ? { _id: { $ne: excludedMemberId } } : {}),
  });
  if (membership) {
    throw new AppError(
      409,
      "STAFF_PHONE_IN_USE",
      "This mobile number already belongs to a studio member.",
    );
  }
  const user = await User.findOne({ phone, deletedAt: null });
  if (!user) return null;
  const userMembership = await Member.findOne({
    userId: user._id,
    status: { $ne: "removed" },
    ...(excludedMemberId ? { _id: { $ne: excludedMemberId } } : {}),
  });
  if (userMembership) {
    throw new AppError(
      409,
      "STAFF_ACCOUNT_IN_USE",
      "This mobile account already belongs to another studio member.",
    );
  }
  return user;
}

async function assertSeatAvailable(req) {
  const limit = req.auth.subscription?.seatLimit;
  if (limit == null || limit < 0) return;
  const occupied = await Member.countDocuments({
    studioId: req.auth.studio._id,
    role: { $ne: "owner" },
    status: { $in: ["active", "limited"] },
  });
  if (occupied >= limit) {
    throw new AppError(
      403,
      "STAFF_LIMIT_REACHED",
      "Your current plan has reached its active staff seat limit.",
      { limit, occupied },
    );
  }
}

async function list(req, res) {
  const rows = await Member.find({
    studioId: req.auth.studio._id,
    status: { $ne: "removed" },
  })
    .populate("userId", "name phone")
    .sort({ role: 1, createdAt: 1 });
  res.json({ data: rows.map(serialize) });
}

async function create(req, res) {
  const input = z.object({
    name: z.string().trim().min(2).max(100),
    phone: phoneSchema,
    role: staffRole,
  }).parse(req.body);
  await assertSeatAvailable(req);
  const user = await assertAvailableIdentity(input.phone);
  let member = await Member.findOne({
    studioId: req.auth.studio._id,
    phone: input.phone,
    status: "removed",
  });
  if (member) {
    member.name = input.name;
    member.role = input.role;
    member.status = "active";
    member.userId = user?._id;
    member.permissionsOverride = [];
    await member.save();
  } else {
    member = await Member.create({
      studioId: req.auth.studio._id,
      userId: user?._id,
      name: input.name,
      phone: input.phone,
      role: input.role,
      status: "active",
    });
  }
  if (user && user.name !== input.name) {
    user.name = input.name;
    await user.save();
  }
  await member.populate("userId", "name phone");
  res.status(201).json({ data: serialize(member) });
}

async function update(req, res) {
  const input = z.object({
    version: z.number().int().nonnegative(),
    name: z.string().trim().min(2).max(100).optional(),
    phone: phoneSchema.optional(),
    role: staffRole.optional(),
    status: z.enum(["active", "limited", "paused"]).optional(),
  }).parse(req.body);
  const member = await Member.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    status: { $ne: "removed" },
  });
  if (!member) throw notFound("Staff member");
  if (member.role === "owner") {
    throw new AppError(403, "OWNER_MEMBERSHIP_IMMUTABLE", "The studio owner cannot be edited as staff.");
  }
  if (member.version !== input.version) {
    throw new AppError(409, "EDIT_CONFLICT", "This staff member changed. Reload and try again.");
  }
  if (input.status === "active" && !["active", "limited"].includes(member.status)) {
    await assertSeatAvailable(req);
  }
  let user = member.userId ? await User.findById(member.userId) : null;
  if (input.phone && input.phone !== member.phone) {
    const availableUser = await assertAvailableIdentity(input.phone, member._id);
    await revokeMemberSessions(member);
    if (user) {
      if (availableUser && !availableUser._id.equals(user._id)) {
        throw new AppError(409, "STAFF_PHONE_IN_USE", "This mobile number already has an account.");
      }
      user.phone = input.phone;
      await user.save();
    } else {
      user = availableUser;
      member.userId = availableUser?._id;
    }
    member.phone = input.phone;
  }
  if (input.name) {
    member.name = input.name;
    if (user) {
      user.name = input.name;
      await user.save();
    }
  }
  if (input.role) member.role = input.role;
  if (input.status) member.status = input.status;
  await member.save();
  if (input.status === "paused") await revokeMemberSessions(member);
  await member.populate("userId", "name phone");
  res.json({ data: serialize(member) });
}

async function remove(req, res) {
  const member = await Member.findOne({
    _id: req.params.id,
    studioId: req.auth.studio._id,
    status: { $ne: "removed" },
  });
  if (!member) throw notFound("Staff member");
  if (member.role === "owner") {
    throw new AppError(403, "OWNER_MEMBERSHIP_IMMUTABLE", "The studio owner cannot be removed.");
  }
  await revokeMemberSessions(member);
  member.status = "removed";
  await member.save();
  res.status(204).send();
}

module.exports = { list, create, update, remove };
