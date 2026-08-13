const supported = new Set(["en", "hi", "gu", "mr"]);

function requestLocale(req, res, next) {
  const explicit = req.get("X-App-Language")?.toLowerCase();
  const accepted = req.acceptsLanguages(...supported);
  req.locale = supported.has(explicit)
    ? explicit
    : supported.has(accepted)
    ? accepted
    : "en";
  res.setHeader("Content-Language", req.locale);
  next();
}

module.exports = { requestLocale, supportedLocales: supported };
