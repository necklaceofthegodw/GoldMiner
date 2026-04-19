import { buildUserDecisionRows } from "./_decision-log.js";
import { readEntriesForNick, readUsersSummaryFromIndex } from "./_decision-log-blob.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildPaging(total, queryPage, queryLimit, maxLimit) {
  const page = parsePositiveInt(queryPage, 1);
  const limit = Math.min(maxLimit, parsePositiveInt(queryLimit, 200));
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  return { page: safePage, limit, totalPages, start };
}

function renderMessage(query) {
  const msg = typeof query?.msg === "string" ? query.msg : "";
  const count = Number(query?.count) || 0;
  const nick = typeof query?.nick === "string" ? query.nick : "";

  if (!msg) return "";
  if (msg === "deleted_all") return `<p class="ok">Usunieto wszystkie logi. Chunks: ${count}.</p>`;
  if (msg === "deleted_user") {
    return `<p class="ok">Usunieto logi gracza <strong>${escapeHtml(nick)}</strong>. Chunks: ${count}.</p>`;
  }
  if (msg === "nick_required") return '<p class="err">Brak nicku do usuniecia.</p>';
  if (msg === "invalid_action") return '<p class="err">Niepoprawna akcja usuwania.</p>';
  if (msg === "delete_failed") return '<p class="err">Nie udalo sie usunac logow.</p>';
  return "";
}

function renderUsersPager(page, totalPages, limit) {
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  return `<div class="pager">
    <span>Strona ${page} / ${totalPages}</span>
    <div class="pager-links">
      <a href="/api/decision-log-view?page=${prevPage}&limit=${limit}">Poprzednia</a>
      <a href="/api/decision-log-view?page=${nextPage}&limit=${limit}">Nastepna</a>
    </div>
  </div>`;
}

function renderUsersList(users, query, paging) {
  const rows =
    users.length === 0
      ? '<tr><td colspan="6">Brak danych.</td></tr>'
      : users
          .map(
            (user) => `<tr>
      <td><a href="/api/decision-log-view?nick=${encodeURIComponent(user.nick)}">${escapeHtml(user.nick)}</a></td>
      <td>${user.totalDecisions}</td>
      <td>${user.ones}</td>
      <td>${user.zeros}</td>
      <td>${Array.isArray(user.sessions) ? user.sessions.length : Number(user.sessions) || 0}</td>
      <td>
        <form method="POST" action="/api/decision-log-delete" onsubmit="return confirm('Usunac logi gracza ${escapeHtml(user.nick)}?');">
          <input type="hidden" name="action" value="user" />
          <input type="hidden" name="nick" value="${escapeHtml(user.nick)}" />
          <button type="submit" class="btn btn-danger">Usun</button>
        </form>
      </td>
    </tr>`
          )
          .join("");

  const message = renderMessage(query);
  const pager = renderUsersPager(paging.page, paging.totalPages, paging.limit);

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
      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; vertical-align: middle; }
      th { background: #f3e6ba; }
      a { color: #0b61a4; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
      .btn { border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 700; }
      .btn-danger { background: #b52a2a; color: #fff; }
      .btn-danger:hover { filter: brightness(1.06); }
      .pager { display: flex; justify-content: space-between; align-items: center; margin: 10px 0; }
      .pager-links { display: flex; gap: 10px; }
      .ok { background: #e6f7e8; border: 1px solid #9ed0a3; padding: 8px 10px; border-radius: 8px; }
      .err { background: #fde9e9; border: 1px solid #e0a8a8; padding: 8px 10px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h1>Logi graczy</h1>
    <div class="toolbar">
      <a href="/api/decision-log-csv">Pobierz caly CSV</a>
      <a href="/api/decision-users?page=${paging.page}&limit=${paging.limit}">JSON users</a>
      <form method="POST" action="/api/decision-log-delete" onsubmit="return confirm('Na pewno usunac wszystkie logi?');">
        <input type="hidden" name="action" value="all" />
        <button type="submit" class="btn btn-danger">Usun wszystko</button>
      </form>
    </div>
    ${message}
    ${pager}
    <table>
      <thead>
        <tr>
          <th>Nick</th>
          <th>Decyzje</th>
          <th>Jedynki</th>
          <th>Zera</th>
          <th>Sesje</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${pager}
  </body>
</html>`;
}

function renderUserLog(nick, rows, query) {
  const bodyRows =
    rows.length === 0
      ? '<tr><td colspan="3">Brak decyzji dla tego nicku.</td></tr>'
      : rows
          .map(
            (row) => `<tr>
      <td>${escapeHtml(row.seconds)}</td>
      <td>${row.decision}</td>
      <td>${escapeHtml(row.sessionId)}</td>
    </tr>`
          )
          .join("");

  const message = renderMessage(query);

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
      .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
      .btn { border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; font-weight: 700; }
      .btn-danger { background: #b52a2a; color: #fff; }
      .ok { background: #e6f7e8; border: 1px solid #9ed0a3; padding: 8px 10px; border-radius: 8px; }
      .err { background: #fde9e9; border: 1px solid #e0a8a8; padding: 8px 10px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <p><a href="/api/decision-log-view">&larr; Wroc do listy graczy</a></p>
    <h1>Log gracza: ${escapeHtml(nick)}</h1>
    <div class="toolbar">
      <a href="/api/decision-user-log?nick=${encodeURIComponent(nick)}">Pobierz CSV tego gracza</a>
      <form method="POST" action="/api/decision-log-delete" onsubmit="return confirm('Usunac logi gracza ${escapeHtml(nick)}?');">
        <input type="hidden" name="action" value="user" />
        <input type="hidden" name="nick" value="${escapeHtml(nick)}" />
        <button type="submit" class="btn btn-danger">Usun logi tego gracza</button>
      </form>
    </div>
    ${message}
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
    const nick = typeof req.query?.nick === "string" ? req.query.nick : "";

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");

    if (nick.trim()) {
      const entries = await readEntriesForNick(nick);
      const rows = buildUserDecisionRows(entries, nick);
      res.end(renderUserLog(nick, rows, req.query));
      return;
    }

    const users = await readUsersSummaryFromIndex();
    const paging = buildPaging(users.length, req.query?.page, req.query?.limit, 500);
    const pagedUsers = users.slice(paging.start, paging.start + paging.limit);
    res.end(renderUsersList(pagedUsers, req.query, paging));
  } catch {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Nie udalo sie odczytac logow.");
  }
}
