const {
  Customer,
  Measurement,
  Order,
  Price,
  GarmentTemplate,
  Studio,
  Member,
} = require('../models');
const { createStudioFor } = require('./auth.service');

const demoPhone = '+919876543210';

function isDemoPhone(phone) {
  return phone === demoPhone;
}

async function ensureDemoStudio(user) {
  let studio = await Studio.findOne({
    ownerUserId: user._id,
    isDemoAccount: true,
  });
  let owner;
  if (!studio) {
    // Adopt a demo studio created by the earlier seed implementation, but do
    // not reuse an ordinary studio that happened to belong to the demo phone.
    studio = await Studio.findOne({
      ownerUserId: user._id,
      name: 'Tailo360 Demo Studio',
    });
    if (studio) {
      studio.isDemoAccount = true;
      await studio.save();
    } else {
      const created = await createStudioFor(user, {
        studioName: 'Tailo360 Demo Studio',
        garmentAudiences: ['men', 'women', 'unisex'],
      });
      studio = created.studio;
      owner = created.owner;
      studio.isDemoAccount = true;
      await studio.save();
    }
  }
  owner ??= await Member.findOneAndUpdate(
    { studioId: studio._id, userId: user._id },
    {
      $set: { role: 'owner', status: 'active', phone: demoPhone },
      $setOnInsert: { name: user.name || 'Demo Owner' },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  // The public demo identity must resolve deterministically even while an
  // older API deployment still selects the first active membership. Retire
  // only this demo user's non-demo memberships; ordinary users are untouched.
  await Member.updateMany(
    {
      userId: user._id,
      studioId: { $ne: studio._id },
      status: { $in: ['active', 'limited'] },
    },
    { $set: { status: 'removed' } },
  );
  return { studio, owner };
}

async function seedDemoStudio({ user, studio }) {
  const [existingCustomers, existingOrders] = await Promise.all([
    Customer.countDocuments({ studioId: studio._id, deletedAt: null }),
    Order.countDocuments({ studioId: studio._id, deletedAt: null }),
  ]);
  if (
    studio.demoSeedVersion === 1 &&
    existingCustomers >= 5 &&
    existingOrders >= 5
  ) return;

  await Studio.updateOne(
    { _id: studio._id },
    {
      $set: {
        name: 'Tailo360 Demo Studio',
        address: 'Shivaji Nagar, Pune, Maharashtra',
        onboardingCompletedAt: new Date(),
        invoicePrefix: 'DEMO-',
        orderSequence: 1005,
        isDemoAccount: true,
      },
    },
  );

  const templates = await GarmentTemplate.find({
    scope: 'global',
    active: true,
    audience: { $in: ['men', 'women', 'unisex'] },
  }).sort({ name: 1 }).limit(3);
  if (!templates.length) return;

  // This studio is reserved exclusively for the public demo identity. Repair
  // an incomplete or legacy seed as one coherent dataset without touching any
  // ordinary studio previously associated with the same phone number.
  await Promise.all([
    Measurement.deleteMany({ studioId: studio._id }),
    Order.deleteMany({ studioId: studio._id }),
    Customer.deleteMany({ studioId: studio._id }),
    Price.deleteMany({ studioId: studio._id }),
  ]);

  const priceByTemplate = new Map();
  for (const [index, template] of templates.entries()) {
    const amountPaise = [129900, 89900, 159900][index] || 99900;
    await Price.findOneAndUpdate(
      { studioId: studio._id, templateId: template._id, active: true },
      { $setOnInsert: { amountPaise, currency: 'INR', effectiveFrom: new Date() } },
      { upsert: true, new: true },
    );
    priceByTemplate.set(template.id, amountPaise);
  }

  const customers = await Customer.insertMany([
    { studioId: studio._id, name: 'Aarav Kulkarni', phone: '+919812345678', address: 'Kothrud, Pune', gender: 'male', fitPreference: 'regular', preferredContact: 'whatsapp', notes: 'Prefers a comfortable fit.' },
    { studioId: studio._id, name: 'Priya Shah', phone: '+919823456789', address: 'Vastrapur, Ahmedabad', gender: 'female', fitPreference: 'slim', preferredContact: 'call', notes: 'Please confirm before delivery.' },
    { studioId: studio._id, name: 'Rohan Patil', phone: '+919834567890', address: 'Baner, Pune', gender: 'male', fitPreference: 'relaxed', preferredContact: 'sms', notes: 'Office-wear customer.' },
    { studioId: studio._id, name: 'Meera Desai', phone: '+919845678901', address: 'Navrangpura, Ahmedabad', gender: 'female', fitPreference: 'regular', preferredContact: 'whatsapp' },
    { studioId: studio._id, name: 'Kabir Joshi', phone: '+919856789012', address: 'Wakad, Pune', gender: 'male', fitPreference: 'slim', preferredContact: 'call' },
  ]);

  const now = new Date();
  const day = (offset) => new Date(now.getTime() + offset * 86400000);
  const orders = [];
  for (const [index, customer] of customers.entries()) {
    const template = templates[index % templates.length];
    const fields = template.fields.slice(0, 5);
    const measurements = Object.fromEntries(
      fields.map((field, fieldIndex) => [field.name, String(28 + index + fieldIndex)]),
    );
    await Measurement.create({
      studioId: studio._id,
      customerId: customer._id,
      templateId: template._id,
      version: 1,
      values: measurements,
      customizations: {},
      unit: 'in',
      createdBy: user._id,
    });
    const amountPaise = priceByTemplate.get(template.id);
    const status = ['cutting', 'stitching', 'trial', 'ready', 'delivered'][index];
    orders.push({
      studioId: studio._id,
      customerId: customer._id,
      code: `DEMO-${1001 + index}`,
      status,
      orderDate: day(-index - 2),
      reminderDate: day(1),
      trialDate: index < 3 ? day(index - 1) : null,
      deliveryDate: day(index + 1),
      priority: index === 0 ? 'urgent' : index === 1 ? 'high' : 'normal',
      notes: 'Demo order created for checking Tailo360 workflows.',
      lines: [{
        templateId: template._id,
        name: template.name,
        quantity: index === 0 ? 2 : 1,
        unitPricePaise: amountPaise,
        lineTotalPaise: amountPaise * (index === 0 ? 2 : 1),
        measurements,
        customizations: {},
        measurementSource: 'saved',
      }],
      totalPaise: amountPaise * (index === 0 ? 2 : 1),
      payments: index === 4 ? [{ amountPaise, direction: 'collection', method: 'upi', noteType: 'full', note: 'Paid in full', recordedBy: user._id }] : [{ amountPaise: Math.round(amountPaise * .4), direction: 'collection', method: 'cash', noteType: 'advance', note: 'Advance received', recordedBy: user._id }],
      activity: [{ type: 'created', actorId: user._id }],
    });
  }
  await Order.insertMany(orders);
  await Studio.updateOne(
    { _id: studio._id },
    { $set: { demoSeedVersion: 1 } },
  );
}

module.exports = {
  demoPhone,
  isDemoPhone,
  ensureDemoStudio,
  seedDemoStudio,
};
