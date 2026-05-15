import { useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "codex-todo-reminder-items";

const priorityOptions = [
  { value: "high", label: "高优先级" },
  { value: "medium", label: "中优先级" },
  { value: "low", label: "低优先级" }
];

const filterOptions = [
  { value: "all", label: "全部" },
  { value: "pending", label: "进行中" },
  { value: "done", label: "已完成" },
  { value: "today", label: "今天到期" }
];

const notificationStatusLabels = {
  granted: "已允许",
  denied: "已拒绝",
  default: "未设置",
  unsupported: "当前浏览器不支持"
};

function formatDateTime(value) {
  if (!value) return "未设置时间";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间无效";

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function loadTodos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function getNotificationStatusLabel(status) {
  return notificationStatusLabels[status] || status;
}

export default function App() {
  const [todos, setTodos] = useState(loadTodos);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("all");
  const [notificationReady, setNotificationReady] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [form, setForm] = useState({
    title: "",
    note: "",
    dueAt: "",
    priority: "medium",
    remindBefore: 10
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  }, [todos]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();

      setTodos((current) =>
        current.map((todo) => {
          if (todo.done || todo.notified || !todo.dueAt) return todo;

          const dueAtMs = new Date(todo.dueAt).getTime();
          const remindAtMs = dueAtMs - todo.remindBefore * 60 * 1000;

          if (now >= remindAtMs) {
            if (notificationReady === "granted") {
              new Notification(`待办提醒：${todo.title}`, {
                body: todo.note || `截止时间 ${formatDateTime(todo.dueAt)}`
              });
            }

            return { ...todo, notified: true };
          }

          return todo;
        })
      );
    }, 15000);

    return () => window.clearInterval(timer);
  }, [notificationReady]);

  const stats = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((item) => item.done).length;
    const urgent = todos.filter(
      (item) => !item.done && item.priority === "high"
    ).length;
    const upcoming = todos.filter((item) => {
      if (!item.dueAt || item.done) return false;
      const diff = new Date(item.dueAt).getTime() - Date.now();
      return diff > 0 && diff <= 24 * 60 * 60 * 1000;
    }).length;

    return { total, done, urgent, upcoming };
  }, [todos]);

  const visibleTodos = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    return todos
      .filter((todo) => {
        const matchedKeyword =
          !keyword ||
          todo.title.toLowerCase().includes(keyword.toLowerCase()) ||
          todo.note.toLowerCase().includes(keyword.toLowerCase());

        if (!matchedKeyword) return false;
        if (filter === "pending") return !todo.done;
        if (filter === "done") return todo.done;

        if (filter === "today") {
          if (!todo.dueAt) return false;
          const date = new Date(todo.dueAt);
          const dueKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
          return dueKey === todayKey;
        }

        return true;
      })
      .sort((a, b) => {
        if (a.done !== b.done) return Number(a.done) - Number(b.done);
        if (!a.dueAt && !b.dueAt) return b.createdAt - a.createdAt;
        if (!a.dueAt) return 1;
        if (!b.dueAt) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      });
  }, [todos, keyword, filter]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function addTodo(event) {
    event.preventDefault();

    const title = form.title.trim();
    if (!title) return;

    const newTodo = {
      id: crypto.randomUUID(),
      title,
      note: form.note.trim(),
      dueAt: form.dueAt,
      priority: form.priority,
      remindBefore: Number(form.remindBefore),
      done: false,
      notified: false,
      createdAt: Date.now()
    };

    setTodos((current) => [newTodo, ...current]);
    setForm({
      title: "",
      note: "",
      dueAt: "",
      priority: "medium",
      remindBefore: 10
    });
  }

  function toggleTodo(id) {
    setTodos((current) =>
      current.map((todo) =>
        todo.id === id ? { ...todo, done: !todo.done } : todo
      )
    );
  }

  function removeTodo(id) {
    setTodos((current) => current.filter((todo) => todo.id !== id));
  }

  async function requestNotification() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setNotificationReady(permission);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">React Todo Reminder</p>
          <h1>把待办事项排成清晰节奏</h1>
          <p className="hero-text">
            记录任务、设置提醒、按优先级聚焦。所有数据保存在本地浏览器里，适合日常学习、工作和个人安排。
          </p>
        </div>

        <div className="hero-actions">
          <button
            className="notify-button"
            onClick={requestNotification}
            disabled={
              notificationReady === "granted" ||
              notificationReady === "unsupported"
            }
          >
            {notificationReady === "granted"
              ? "已开启浏览器提醒"
              : notificationReady === "unsupported"
                ? "当前浏览器不支持通知"
                : "开启浏览器提醒"}
          </button>
          <p className="notify-tip">
            当前通知权限：
            <strong>{getNotificationStatusLabel(notificationReady)}</strong>
          </p>
        </div>
      </section>

      <section className="dashboard" aria-label="待办统计">
        <article className="stat-card accent">
          <span>全部事项</span>
          <strong>{stats.total}</strong>
        </article>
        <article className="stat-card">
          <span>已完成</span>
          <strong>{stats.done}</strong>
        </article>
        <article className="stat-card">
          <span>高优先级</span>
          <strong>{stats.urgent}</strong>
        </article>
        <article className="stat-card">
          <span>24 小时内到期</span>
          <strong>{stats.upcoming}</strong>
        </article>
      </section>

      <section className="workspace">
        <form className="panel composer" onSubmit={addTodo}>
          <div className="panel-head">
            <h2>新增待办</h2>
            <p>给任务一个明确的时间和优先级。</p>
          </div>

          <label>
            <span>事项标题</span>
            <input
              value={form.title}
              onChange={(event) => updateForm("title", event.target.value)}
              placeholder="比如：整理周报，19:00 前发出"
            />
          </label>

          <label>
            <span>补充备注</span>
            <textarea
              rows="4"
              value={form.note}
              onChange={(event) => updateForm("note", event.target.value)}
              placeholder="记录细节、会议链接或执行步骤"
            />
          </label>

          <div className="grid-two">
            <label>
              <span>截止时间</span>
              <input
                type="datetime-local"
                value={form.dueAt}
                onChange={(event) => updateForm("dueAt", event.target.value)}
              />
            </label>

            <label>
              <span>优先级</span>
              <select
                value={form.priority}
                onChange={(event) => updateForm("priority", event.target.value)}
              >
                {priorityOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>提前提醒</span>
            <select
              value={form.remindBefore}
              onChange={(event) =>
                updateForm("remindBefore", event.target.value)
              }
            >
              <option value="5">提前 5 分钟</option>
              <option value="10">提前 10 分钟</option>
              <option value="30">提前 30 分钟</option>
              <option value="60">提前 1 小时</option>
            </select>
          </label>

          <button className="primary-button" type="submit">
            添加事项
          </button>
        </form>

        <section className="panel list-panel">
          <div className="panel-head row">
            <div>
              <h2>待办清单</h2>
              <p>按关键词或状态快速聚焦。</p>
            </div>

            <div className="filters">
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索标题或备注"
              />
              <div className="filter-pills" role="group" aria-label="筛选待办">
                {filterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`pill ${filter === option.value ? "active" : ""}`}
                    type="button"
                    onClick={() => setFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="todo-list">
            {visibleTodos.length ? (
              visibleTodos.map((todo) => (
                <article
                  key={todo.id}
                  className={`todo-card priority-${todo.priority} ${
                    todo.done ? "done" : ""
                  }`}
                >
                  <div className="todo-main">
                    <div className="todo-topline">
                      <span className="badge">
                        {
                          priorityOptions.find(
                            (item) => item.value === todo.priority
                          )?.label
                        }
                      </span>
                      <span className="due">{formatDateTime(todo.dueAt)}</span>
                    </div>
                    <h3>{todo.title}</h3>
                    <p>{todo.note || "这个事项还没有补充备注。"}</p>
                  </div>

                  <div className="todo-actions">
                    <button type="button" onClick={() => toggleTodo(todo.id)}>
                      {todo.done ? "恢复" : "完成"}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => removeTodo(todo.id)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="empty-state">
                <h3>还没有匹配的事项</h3>
                <p>先添加一个待办，或者换个筛选条件看看。</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
