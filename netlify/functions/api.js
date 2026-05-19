import pg from "pg";

const { Pool } = pg;
let pool;

function getEnv(name) {
  if (typeof Netlify !== "undefined" && Netlify.env) {
    return Netlify.env.get(name);
  }

  return process.env[name];
}

function createPoolConfig(rawConnectionString) {
  try {
    new URL(rawConnectionString);

    return { connectionString: rawConnectionString };
  } catch {
    const match = rawConnectionString.match(
      /^(postgres(?:ql)?:\/\/)([^:@/]+):(.+)@([^/?#:]+)(?::(\d+))?\/([^?]+)(?:\?.*)?$/
    );

    if (!match) {
      throw new Error("Invalid SUPABASE_DB_SESSION_POOL_URL");
    }

    return {
      user: decodeURIComponent(match[2]),
      password: match[3],
      host: match[4],
      port: match[5] ? Number(match[5]) : 5432,
      database: decodeURIComponent(match[6])
    };
  }
}

function getPool() {
  if (pool) return pool;

  const connectionString = getEnv("SUPABASE_DB_SESSION_POOL_URL");

  if (!connectionString) {
    throw new Error("Missing SUPABASE_DB_SESSION_POOL_URL");
  }

  pool = new Pool({
    ...createPoolConfig(connectionString),
    ssl: { rejectUnauthorized: false },
    max: Number(getEnv("DB_POOL_MAX") ?? 10),
    idleTimeoutMillis: Number(getEnv("DB_IDLE_TIMEOUT_MS") ?? 30000),
    connectionTimeoutMillis: Number(getEnv("DB_CONNECTION_TIMEOUT_MS") ?? 10000)
  });

  return pool;
}

function json(status, payload) {
  return Response.json(payload, { status });
}

function getUserId(request, body) {
  return request.headers.get("x-user-id") || body.userId;
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

async function readBody(request) {
  if (request.method === "GET" || request.method === "DELETE") return {};

  const text = await request.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function createTodoPlan(request) {
  const body = await readBody(request);
  const userId = getUserId(request, body);
  const title = typeof body.title === "string" ? body.title.trim() : "";

  if (!userId) return json(401, { error: "Missing user id" });
  if (!title) return json(400, { error: "Todo title is required" });

  const priority = ["low", "medium", "high"].includes(body.priority)
    ? body.priority
    : "medium";
  const remindBeforeMinutes = Number.isFinite(Number(body.remindBeforeMinutes))
    ? Number(body.remindBeforeMinutes)
    : 10;

  const result = await getPool().query(
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

  return json(201, { todo: mapTodoPlan(result.rows[0]) });
}

async function listTodoPlans(request, url) {
  const userId = request.headers.get("x-user-id") || url.searchParams.get("userId");

  if (!userId) return json(401, { error: "Missing user id" });

  const result = await getPool().query(
    `select *
    from public.todo_plans
    where user_id = $1
    order by is_done asc, due_at asc nulls last, created_at desc`,
    [userId]
  );

  return json(200, { todos: result.rows.map(mapTodoPlan) });
}

async function updateTodoPlan(request, id) {
  const body = await readBody(request);
  const userId = getUserId(request, body);

  if (!userId) return json(401, { error: "Missing user id" });

  const result = await getPool().query(
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

  if (!result.rowCount) return json(404, { error: "Todo plan not found" });

  return json(200, { todo: mapTodoPlan(result.rows[0]) });
}

async function deleteTodoPlan(request, url, id) {
  const userId = request.headers.get("x-user-id") || url.searchParams.get("userId");

  if (!userId) return json(401, { error: "Missing user id" });

  const result = await getPool().query(
    `delete from public.todo_plans
    where id = $1 and user_id = $2`,
    [id, userId]
  );

  if (!result.rowCount) return json(404, { error: "Todo plan not found" });

  return json(200, { ok: true });
}

export default async (request) => {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "GET" && pathname === "/api/todo-plans") {
      return listTodoPlans(request, url);
    }

    if (request.method === "POST" && pathname === "/api/todo-plans") {
      return createTodoPlan(request);
    }

    const todoMatch = pathname.match(/^\/api\/todo-plans\/([0-9a-f-]+)$/i);

    if (todoMatch && request.method === "PATCH") {
      return updateTodoPlan(request, todoMatch[1]);
    }

    if (todoMatch && request.method === "DELETE") {
      return deleteTodoPlan(request, url, todoMatch[1]);
    }

    return json(404, { error: "Not found" });
  } catch (error) {
    return json(500, { error: error.message });
  }
};

export const config = {
  path: "/api/*"
};
