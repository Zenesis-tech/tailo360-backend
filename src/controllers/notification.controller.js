const { z } = require('zod'); const { Device, Notification } = require('../models');
async function register(req, res) { const body = z.object({ token: z.string().min(20), platform: z.enum(['android', 'ios']) }).parse(req.body); const device = await Device.findOneAndUpdate({ token: body.token }, { ...body, userId: req.auth.user._id, studioId: req.auth.studio._id, active: true }, { upsert: true, new: true }); res.status(201).json({ data: device }); }
async function list(req, res) { res.json({ data: await Notification.find({ studioId: req.auth.studio._id }).sort({ createdAt: -1 }).limit(100) }); }
module.exports = { register, list };
