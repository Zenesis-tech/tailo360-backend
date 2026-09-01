const { AppError } = require('./errors');

const regions = {
  IN: { dialCode: '+91', nationalLength: 10, pattern: /^[6-9]\d{9}$/ },
  US: { dialCode: '+1', nationalLength: 10, pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  CA: { dialCode: '+1', nationalLength: 10, pattern: /^[2-9]\d{2}[2-9]\d{6}$/ },
  GB: { dialCode: '+44', nationalLength: 10, pattern: /^[1-9]\d{9}$/, trunkPrefix: true },
  AU: { dialCode: '+61', nationalLength: 9, pattern: /^[2-478]\d{8}$/, trunkPrefix: true },
};

function studioCountry(req) {
  return req.auth.studio.settings?.country || req.auth.user.country || 'IN';
}

function normalizeRegionalPhone(value, country) {
  const region = regions[country] || regions.IN;
  const compact = String(value || '').trim().replace(/[\s().-]/g, '');
  const hasInternationalPrefix = compact.startsWith('+');
  if (hasInternationalPrefix && !compact.startsWith(region.dialCode)) {
    throw new AppError(
      422,
      'PHONE_COUNTRY_MISMATCH',
      `Use a ${region.dialCode} mobile number for this studio.`,
    );
  }

  let national = hasInternationalPrefix
    ? compact.substring(region.dialCode.length)
    : compact.replace(/\D/g, '');
  const dialDigits = region.dialCode.substring(1);
  if (
    !hasInternationalPrefix &&
    national.startsWith(dialDigits) &&
    national.length === region.nationalLength + dialDigits.length
  ) {
    national = national.substring(dialDigits.length);
  }
  if (
    region.trunkPrefix &&
    national.startsWith('0') &&
    national.length === region.nationalLength + 1
  ) {
    national = national.substring(1);
  }
  if (!region.pattern.test(national)) {
    throw new AppError(
      422,
      'PHONE_INVALID',
      `Use a valid ${region.dialCode} mobile number.`,
    );
  }
  return `${region.dialCode}${national}`;
}

module.exports = { normalizeRegionalPhone, studioCountry };
