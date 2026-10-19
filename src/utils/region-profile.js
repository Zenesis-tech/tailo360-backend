const regions = {
  IN: { currency: 'INR', dialCode: '+91', timezone: 'Asia/Kolkata', locale: 'en-IN' },
  US: { currency: 'USD', dialCode: '+1', timezone: 'America/New_York', locale: 'en-US' },
  CA: { currency: 'CAD', dialCode: '+1', timezone: 'America/Toronto', locale: 'en-CA' },
  GB: { currency: 'GBP', dialCode: '+44', timezone: 'Europe/London', locale: 'en-GB' },
  AU: { currency: 'AUD', dialCode: '+61', timezone: 'Australia/Sydney', locale: 'en-AU' },
};

function regionalProfile(input = {}) {
  const country = input.country || 'IN';
  const defaults = regions[country];
  return {
    country,
    currency: defaults.currency,
    dialCode: defaults.dialCode,
    timezone: input.timezone || defaults.timezone,
    locale: input.locale || defaults.locale,
  };
}

module.exports = { regions, regionalProfile };
