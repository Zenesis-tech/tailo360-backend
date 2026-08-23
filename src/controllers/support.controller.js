const { z } = require('zod');
const { AppConfig, SupportTicket } = require('../models');

const defaultSupport = { whatsappNumber: '', deliveryMode: 'ticket' };

async function config(req, res) {
  const platform = await AppConfig.findOne({ key: 'platform' }).select('support');
  res.set('Cache-Control', 'no-store');
  res.json({ data: { ...defaultSupport, ...(platform?.support?.toObject?.() || platform?.support || {}) } });
}

async function createTicket(req, res) {
  const input = z.object({
    subject: z.string().trim().min(3).max(120),
    category: z.enum(['order_workflow', 'payments', 'subscription', 'bug_report', 'other']),
    message: z.string().trim().min(3).max(3000),
  }).parse(req.body);
  const ticket = await SupportTicket.create({
    studioId: req.auth.studio._id,
    subject: input.subject,
    category: input.category,
    messages: [{ body: input.message, authorId: req.auth.user._id }],
  });
  res.status(201).json({ data: ticket });
}

module.exports = { config, createTicket };
