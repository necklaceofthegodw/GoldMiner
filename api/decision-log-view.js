import {
  readAdminKeyFromRequest,
  requireDecisionLogAdminAuth,
} from "./_decision-log-admin-auth.js";
import { normalizeNick, summarizeUsersFromRuns } from "./_decision-log.js";
import { readAllRunSummaries, readRunSummariesForNick } from "./_decision-log-blob.js";

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

function withQuery(pathname, values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

function renderMessage(query) {
  const msg = typeof query?.msg === "string" ? query.msg : "";
  const count = Number(query?.count) || 0;
  const nick = typeof query?.nick === "string" ? query.nick : "";

  if (!msg) return "";
  if (msg === "deleted_all") return `<p class="ok">Usunieto wszystkie podsumowania runow. Blobs: ${count}.</p>`;
  if (msg === "deleted_user") {
    return `<p class="ok">Usunieto podsumowania gracza <strong>${escapeHtml(nick)}</strong>. Blobs: ${count}.</p>`;
  }
  if (msg === "nick_required") return '<p class="err">Brak nicku do usuniecia.</p>';
  if (msg === "invalid_action") return '<p class="err">Niepoprawna akcja usuwania.</p>';
  if (msg === "delete_failed") return '<p class="err">Nie udalo sie usunac logow.</p>';
  return "";
}

function renderUsersPager(page, totalPages, limit, adminKey) {
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(totalPages, page + 1);
  const prevHref = withQuery("/api/decision-log-view", { page: prevPage, limit, key: adminKey });
  const nextHref = withQuery("/api/decision-log-view", { page: nextPage, limit, key: adminKey });
  return `<div class="pager">
    <span>Strona ${page} / ${totalPages}</span>
    <div class="pager-links">
      <a href="${prevHref}">Poprzednia</a>
      <a href="${nextHref}">Nastepna</a>
    </div>
  </div>`;
}

function renderUsersList(users, query, paging, adminKey) {
  const rows =
    users.length === 0
      ? '<tr><td colspan="8">Brak danych.</td></tr>'
      : users
          .map((user) => {
            const userHref = withQuery("/api/decision-log-view", { nick: user.nick, key: adminKey });
            const decisionsCsvHref = withQuery("/api/decision-user-decisions-csv", {
              nick: user.nick,
              key: adminKey,
            });
            return `<tr>
      <td><a href="${userHref}">${escapeHtml(user.nick)}</a></td>
      <td>${user.runs}</td>
      <td>${user.wins}</td>
      <td>${user.fails}</td>
      <td>${user.totalDecisions}</td>
      <td>${user.ones}</td>
      <td>${user.zeros}</td>
      <td>
        <div class="row-actions">
          <a href="${decisionsCsvHref}">CSV decyzji</a>
          <form method="POST" action="${withQuery("/api/decision-log-delete", { key: adminKey })}" onsubmit="return confirm('Usunac podsumowania gracza ${escapeHtml(user.nick)}?');">
            <input type="hidden" name="action" value="user" />
            <input type="hidden" name="nick" value="${escapeHtml(user.nick)}" />
            <button type="submit" class="btn btn-danger">Usun</button>
          </form>
        </div>
      </td>
    </tr>`;
          })
          .join("");

  const message = renderMessage(query);
  const pager = renderUsersPager(paging.page, paging.totalPages, paging.limit, adminKey);
  const deleteAction = withQuery("/api/decision-log-delete", { key: adminKey });

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Podsumowania Runow</title>
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
      .row-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
      .ok { background: #e6f7e8; border: 1px solid #9ed0a3; padding: 8px 10px; border-radius: 8px; }
      .err { background: #fde9e9; border: 1px solid #e0a8a8; padding: 8px 10px; border-radius: 8px; }
      .note { background: #fffbe8; border: 1px solid #e8d89a; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <h1>Gold Miner logs</h1>
    <p class="note">W chmurze masz agregaty runow oraz CSV decyzji gracza (timestamp,decyzja).</p>
    <div class="toolbar">
      <form method="POST" action="${deleteAction}" onsubmit="return confirm('Na pewno usunac wszystkie podsumowania runow?');">
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
          <th>Runy</th>
          <th>Wygrane</th>
          <th>Przegrane</th>
          <th>Decyzje</th>
          <th>Jedynki</th>
          <th>Zera</th>
          <th>Akcje</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function renderUserRuns(nick, summaries, query, adminKey) {
  const rows =
    summaries.length === 0
      ? '<tr><td colspan="10">Brak runow dla tego nicku.</td></tr>'
      : summaries
          .slice()
          .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
          .map(
            (summary) => `<tr>
      <td>${escapeHtml(summary.finishedAt)}</td>
      <td>${summary.success ? "win" : "fail"}</td>
      <td>${summary.lastLevel}</td>
      <td>${summary.completedLevels}</td>
      <td>${summary.totalDecisions}</td>
      <td>${summary.ones}</td>
      <td>${summary.zeros}</td>
      <td>${summary.totalEarned}</td>
      <td>${summary.bank}</td>
      <td>${escapeHtml(summary.sessionId)}</td>
    </tr>`
          )
          .join("");

  const message = renderMessage(query);
  const backHref = withQuery("/api/decision-log-view", { key: adminKey });
  const userCsvHref = withQuery("/api/decision-user-log", { nick, key: adminKey });
  const userDecisionsCsvHref = withQuery("/api/decision-user-decisions-csv", { nick, key: adminKey });
  const deleteAction = withQuery("/api/decision-log-delete", { key: adminKey });

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Runy ${escapeHtml(nick)}</title>
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
      .note { background: #fffbe8; border: 1px solid #e8d89a; padding: 8px 10px; border-radius: 8px; margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <p><a href="${backHref}">&larr; Wroc do listy graczy</a></p>
    <h1>Runy gracza: ${escapeHtml(nick)}</h1>
    <p class="note">To sa agregaty runow z chmury. Pelny CSV decyzji (timestamp,decyzja) jest dostepny ponizej.</p>
    <div class="toolbar">
      <a href="${userCsvHref}">Pobierz CSV runow tego gracza</a>
      <a href="${userDecisionsCsvHref}">Pobierz CSV decyzji tego gracza</a>
      <form method="POST" action="${deleteAction}" onsubmit="return confirm('Usunac podsumowania runow gracza ${escapeHtml(nick)}?');">
        <input type="hidden" name="action" value="user" />
        <input type="hidden" name="nick" value="${escapeHtml(nick)}" />
        <button type="submit" class="btn btn-danger">Usun runy tego gracza</button>
      </form>
    </div>
    ${message}
    <table>
      <thead>
        <tr>
          <th>Zakonczenie</th>
          <th>Wynik</th>
          <th>Ostatni poziom</th>
          <th>Ukonczone poziomy</th>
          <th>Decyzje</th>
          <th>Jedynki</th>
          <th>Zera</th>
          <th>Zarobek</th>
          <th>Bank</th>
          <th>Session ID</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </body>
</html>`;
}

function classifyReadError(error) {
  const rawMessage = String(error?.message || "").trim();
  const message = rawMessage || "Unknown error";
  const isTokenMissing =
    message.includes("No token found") || message.includes("BLOB_READ_WRITE_TOKEN");
  const isForbidden = message.includes("403");

  if (isTokenMissing) {
    return {
      statusCode: 503,
      title: "Brak konfiguracji Vercel Blob",
      hint: [
        "Ustaw zmienna srodowiskowa BLOB_READ_WRITE_TOKEN w projekcie na Vercelu (Production i Preview).",
        "Po zapisaniu zmiennej wykonaj nowy deploy.",
      ],
      details: message,
    };
  }

  if (isForbidden) {
    return {
      statusCode: 500,
      title: "Brak dostepu do Blob Store",
      hint: [
        "Sprawdz czy BLOB_READ_WRITE_TOKEN pochodzi z tego samego Blob Store co projekt.",
        "W razie watpliwosci wygeneruj nowy token i wykonaj redeploy.",
      ],
      details: message,
    };
  }

  return {
    statusCode: 500,
    title: "Nie udalo sie odczytac logow",
    hint: ["Sprawdz konfiguracje Vercel Blob i logi funkcji serverless."],
    details: message,
  };
}

function renderErrorPage(info) {
  const hints = info.hint.map((item) => `<li>${escapeHtml(item)}</li>`).join("");

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gold Miner - Blad logow</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111; background: #faf7ef; }
      .card { background: #fff; border: 1px solid #ddd; border-radius: 10px; padding: 16px; max-width: 760px; }
      h1 { margin: 0 0 10px; font-size: 22px; }
      ul { margin: 10px 0 0 20px; }
      code { background: #f2f2f2; padding: 1px 6px; border-radius: 6px; }
      .details { margin-top: 12px; color: #666; font-size: 14px; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${escapeHtml(info.title)}</h1>
      <p>Widok logow nie moze teraz pobrac danych.</p>
      <ul>${hints}</ul>
      <p class="details">Szczegoly: <code>${escapeHtml(info.details)}</code></p>
    </div>
  </body>
</html>`;
}

export default async function handler(req, res) {
  if (!requireDecisionLogAdminAuth(req, res, { html: true })) return;

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end();
    return;
  }

  try {
    const adminKey = readAdminKeyFromRequest(req);
    const nick = normalizeNick(req.query?.nick);

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=60");

    if (nick) {
      const summaries = await readRunSummariesForNick(nick, { useCache: true });
      res.end(renderUserRuns(nick, summaries, req.query, adminKey));
      return;
    }

    const summaries = await readAllRunSummaries({ useCache: true });
    const users = summarizeUsersFromRuns(summaries);
    const paging = buildPaging(users.length, req.query?.page, req.query?.limit, 500);
    const pagedUsers = users.slice(paging.start, paging.start + paging.limit);
    res.end(renderUsersList(pagedUsers, req.query, paging, adminKey));
  } catch (error) {
    const info = classifyReadError(error);
    res.statusCode = info.statusCode;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(renderErrorPage(info));
  }
}
