import { buildUserDecisionRows, buildUsersSummary } from "./_decision-log.js";
import { readAllEntries } from "./_decision-log-blob.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderUsersList(users) {
  const rows =
    users.length === 0
      ? "<tr><td colspan=\"5\">Brak danych.</td></tr>"
      : users
          .map(
            (user) => `<tr>
      <td><a href="/api/decision-log-view?nick=${encodeURIComponent(user.nick)}">${escapeHtml(user.nick)}</a></td>
      <td>${user.totalDecisions}</td>
      <td>${user.ones}</td>
      <td>${user.zeros}</td>
      <td>${user.sessions}</td>
    </tr>`
          )
          .join("");

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Logi Graczy</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; background: #faf7ef; }
      h1 { margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background: #f3e6ba; }
      a { color: #0b61a4; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <h1>Logi Graczy</h1>
    <p><a href="/api/decision-log-csv">Pobierz cały CSV</a> | <a href="/api/decision-users">JSON users</a></p>
    <table>
      <thead>
        <tr>
          <th>Nick</th>
          <th>Decyzje</th>
          <th>Jedynki</th>
          <th>Zera</th>
          <th>Sesje</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function renderUserLog(nick, rows) {
  const bodyRows =
    rows.length === 0
      ? "<tr><td colspan=\"3\">Brak decyzji dla tego nicku.</td></tr>"
      : rows
          .map(
            (row) => `<tr>
      <td>${escapeHtml(row.seconds)}</td>
      <td>${row.decision}</td>
      <td>${escapeHtml(row.sessionId)}</td>
    </tr>`
          )
          .join("");

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Log ${escapeHtml(nick)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; background: #faf7ef; }
      h1 { margin: 0 0 12px; }
      table { width: 100%; border-collapse: collapse; background: #fff; }
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
      th { background: #f3e6ba; }
      a { color: #0b61a4; text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <p><a href="/api/decision-log-view">← Wróć do listy graczy</a></p>
    <h1>Log gracza: ${escapeHtml(nick)}</h1>
    <p><a href="/api/decision-user-log?nick=${encodeURIComponent(nick)}">Pobierz CSV tego gracza</a></p>
    <table>
      <thead>
        <tr>
          <th>Czas [s]</th>
          <th>Decyzja</th>
          <th>Session ID</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  </body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const entries = await readAllEntries();
    const nick = typeof req.query?.nick === "string" ? req.query.nick : "";

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (nick.trim()) {
      const rows = buildUserDecisionRows(entries, nick);
      res.end(renderUserLog(nick, rows));
      return;
    }

    const users = buildUsersSummary(entries);
    res.end(renderUsersList(users));
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Nie udalo sie odczytac logow.");
  }
}
