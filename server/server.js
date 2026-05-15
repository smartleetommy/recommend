import "dotenv/config";
import http from "node:http";
import { pool } from "./db.js";

const PORT = Number(process.env.PORT ?? 3001);

function getCorsOrigin(req) {
  const allowedOrigins = new Set(
    [
      process.env.CORS_ORIGIN,
      "http://localhost:4173",
      "http://localhost:5173"
    ]
      .filter(Boolean)
      .join(",")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
  const requestOrigin = req.headers.origin;

  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    return requestOrigin;
  }

  return allowedOrigins.values().next().value || "http://localhost:4173";
}

function sendJson(req, res, statusCode, payload) {
  const body = JSON.stringify(payload);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": getCorsOrigin(req),
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS"
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;

      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function getUserId(req, body) {
  return req.headers["x-user-id"] || body.userId;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag).trim())
        .filter(Boolean)
    )
  );
}

function mapTodoPlan(row) {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    note: row.note,
    dueAt: row.due_at,
    priority: row.priority,
    remindBefore: row.remind_before_minutes,
    tags: row.tags,
    done: row.is_done,
    notified: row.is_notified,
    completedAt: row.completed_at,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: row.updated_at
  };
}

async function createTodoPlan(req, res) {
  const body = await parseJsonBody(req);
  const userId = getUserId(req, body);
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!userId) {
    sendJson(req, res, 401, { error: "Missing user id" });
    return;
  }

  if (!title) {
    sendJson(req, res, 400, { error: "Todo title is required" });
    return;
  }

  const priority = ["low", "medium", "high"].includes(body.priority)
    ? body.priority
    : "medium";
  const remindBeforeMinutes = Number.isFinite(Number(body.remindBeforeMinutes))
    ? Number(body.remindBeforeMinutes)
    : 10;

  const result = await pool.query(
    `insert into public.todo_plans (
      user_id,
      title,
      note,
      due_at,
      priority,
      remind_before_minutes,
      tags
    )
    values ($1, $2, $3, $4, $5, $6, $7)
    returning *`,
    [
      userId,
      title,
      typeof body.note === "string" ? body.note.trim() : "",
      body.dueAt || null,
      priority,
      remindBeforeMinutes,
      normalizeTags(body.tags)
    ]
  );

  sendJson(req, res, 201, { todo: mapTodoPlan(result.rows[0]) });
}

async function listTodoPlans(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = req.headers["x-user-id"] || url.searchParams.get("userId");

  if (!userId) {
    sendJson(req, res, 401, { error: "Missing user id" });
    return;
  }

  const result = await pool.query(
    `select *
    from public.todo_plans
    where user_id = $1
    order by is_done asc, due_at asc nulls last, created_at desc`,
    [userId]
  );

  sendJson(req, res, 200, { todos: result.rows.map(mapTodoPlan) });
}

async function updateTodoPlan(req, res, id) {
  const body = await parseJsonBody(req);
  const userId = getUserId(req, body);

  if (!userId) {
    sendJson(req, res, 401, { error: "Missing user id" });
    return;
  }

  const result = await pool.query(
    `update public.todo_plans
    set is_done = coalesce($3, is_done),
      is_notified = coalesce($4, is_notified)
    where id = $1 and user_id = $2
    returning *`,
    [
      id,
      userId,
      typeof body.done === "boolean" ? body.done : null,
      typeof body.notified === "boolean" ? body.notified : null
    ]
  );

  if (!result.rowCount) {
    sendJson(req, res, 404, { error: "Todo plan not found" });
    return;
  }

  sendJson(req, res, 200, { todo: mapTodoPlan(result.rows[0]) });
}

async function deleteTodoPlan(req, res, id) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const userId = req.headers["x-user-id"] || url.searchParams.get("userId");

  if (!userId) {
    sendJson(req, res, 401, { error: "Missing user id" });
    return;
  }

  const result = await pool.query(
    `delete from public.todo_plans
    where id = $1 and user_id = $2`,
    [id, userId]
  );

  if (!result.rowCount) {
    sendJson(req, res, 404, { error: "Todo plan not found" });
    return;
  }

  sendJson(req, res, 200, { ok: true });
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(req, res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/todo-plans" && req.method === "GET") {
    await listTodoPlans(req, res);
    return;
  }

  if (url.pathname === "/api/todo-plans" && req.method === "POST") {
    await createTodoPlan(req, res);
    return;
  }

  const todoMatch = url.pathname.match(/^\/api\/todo-plans\/([0-9a-f-]+)$/i);

  if (todoMatch && req.method === "PATCH") {
    await updateTodoPlan(req, res, todoMatch[1]);
    return;
  }

  if (todoMatch && req.method === "DELETE") {
    await deleteTodoPlan(req, res, todoMatch[1]);
    return;
  }

  sendJson(req, res, 404, { error: "Not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    sendJson(req, res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Todo plan API listening on http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  await pool.end();
  server.close(() => process.exit(0));
});
