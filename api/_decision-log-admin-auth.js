function readHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

export function getConfiguredAdminKey() {
  return String(
    process.env.DECISION_LOG_ADMIN_KEY ||
      process.env.DECISION_LOG_VIEW_KEY ||
      process.env.DECISION_LOG_KEY ||
      ""
  ).trim();
}

export function readAdminKeyFromRequest(req) {
  const queryKey = typeof req.query?.key === "string" ? req.query.key.trim() : "";
  if (queryKey) return queryKey;

  const bearer = readHeaderValue(req.headers?.authorization);
  if (bearer.toLowerCase().startsWith("bearer ")) {
    return bearer.slice(7).trim();
  }

  const customHeader = readHeaderValue(req.headers?.["x-log-admin-key"]);
  if (customHeader) return customHeader;

  return "";
}

function renderHtmlError(title, message) {
  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Blad autoryzacji</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; background: #faf7ef; }
      .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 16px; max-width: 760px; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      p { margin: 10px 0; }
      code { background: #f2f2f2; padding: 1px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${message}</p>
      <p>Uzyj parametru <code>?key=...</code> albo naglowka <code>x-log-admin-key</code>.</p>
    </div>
  </body>
</html>`;
}

export function requireDecisionLogAdminAuth(req, res, { html = false } = {}) {
  const configuredKey = getConfiguredAdminKey();
  if (!configuredKey) {
    res.statusCode = 503;
    if (html) {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        renderHtmlError(
          "Brak konfiguracji klucza admin",
          "Ustaw zmienna DECISION_LOG_ADMIN_KEY na Vercelu, aby zabezpieczyc endpointy logow."
        )
      );
      return false;
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Missing DECISION_LOG_ADMIN_KEY configuration." }));
    return false;
  }

  const providedKey = readAdminKeyFromRequest(req);
  if (providedKey === configuredKey) return true;

  res.statusCode = 401;
  res.setHeader("WWW-Authenticate", 'Bearer realm="decision-log-admin"');
  if (html) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      renderHtmlError(
        "Brak dostepu",
        "Ten endpoint jest zabezpieczony. Podaj poprawny klucz administratora."
      )
    );
    return false;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: "Unauthorized." }));
  return false;
}

export function withAdminKey(pathname, key) {
  const trimmedPath = String(pathname || "").trim() || "/";
  const trimmedKey = String(key || "").trim();
  if (!trimmedKey) return trimmedPath;

  const hasQuery = trimmedPath.includes("?");
  const glue = hasQuery ? "&" : "?";
  return `${trimmedPath}${glue}key=${encodeURIComponent(trimmedKey)}`;
}
