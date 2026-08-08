const env = require('../config/env');
const providers = {
  msg91: require('./msg91-otp.service'),
  twilio: require('./twilio-otp.service'),
};

module.exports = providers[env.OTP_PROVIDER];
