import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";
const USER_ID =
  import.meta.env.VITE_DEMO_USER_ID || "00000000-0000-4000-8000-000000000001";

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

const quoteOptions = [
  {
    text: "每一个不曾起舞的日子，都是对生命的辜负。",
    author: "尼采"
  },
  {
    text: "今日事，今日毕。",
    author: "富兰克林"
  },
  {
    text: "伟大的思想，只有付诸行动才能成为壮举。",
    author: "赫兹里特"
  },
  {
    text: "时间是最公平的秤，行动是最可靠的砝码。",
    author: "佚名"
  }
];

function normalizeTags(value) {
  if (!value) return [];

  return Array.from(
    new Set(
      value
        .split(/[,，\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  );
}

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

function getNotificationStatusLabel(status) {
  return notificationStatusLabels[status] || status;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": USER_ID,
      ...options.headers
    }
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "请求失败");
  }

  return data;
}

export default function App() {
  const [todos, setTodos] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [notificationReady, setNotificationReady] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [form, setForm] = useState({
    title: "",
    note: "",
    dueAt: "",
    priority: "medium",
    remindBefore: 10,
    tags: ""
  });

  useEffect(() => {
    loadTodos();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quoteOptions.length);
    }, 5200);

    return () => window.clearInterval(timer);
  }, []);

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

            requestJson(`/api/todo-plans/${todo.id}`, {
              method: "PATCH",
              body: JSON.stringify({ notified: true })
            }).catch(() => {});

            return { ...todo, notified: true };
          }

          return todo;
        })
      );
    }, 15000);

    return () => window.clearInterval(timer);
  }, [notificationReady]);

  async function loadTodos() {
    setIsLoading(true);

    try {
      const data = await requestJson(`/api/todo-plans?userId=${USER_ID}`);
      setTodos(Array.isArray(data.todos) ? data.todos : []);
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }

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

  const allTags = useMemo(() => {
    return Array.from(
      new Set(todos.flatMap((todo) => (Array.isArray(todo.tags) ? todo.tags : [])))
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [todos]);

  const visibleTodos = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    return todos
      .filter((todo) => {
        const todoTags = Array.isArray(todo.tags) ? todo.tags : [];
        const normalizedKeyword = keyword.toLowerCase();
        const matchedKeyword =
          !normalizedKeyword ||
          todo.title.toLowerCase().includes(normalizedKeyword) ||
          (todo.note || "").toLowerCase().includes(normalizedKeyword) ||
          todoTags.some((tag) => tag.toLowerCase().includes(normalizedKeyword));
        const matchedTag =
          selectedTag === "all" || todoTags.includes(selectedTag);

        if (!matchedKeyword || !matchedTag) return false;
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
  }, [todos, keyword, filter, selectedTag]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function addTodo(event) {
    event.preventDefault();

    const title = form.title.trim();
    if (!title || isSaving) return;

    setIsSaving(true);

    try {
      const data = await requestJson("/api/todo-plans", {
        method: "POST",
        body: JSON.stringify({
          title,
          note: form.note.trim(),
          dueAt: form.dueAt || null,
          priority: form.priority,
          remindBeforeMinutes: Number(form.remindBefore),
          tags: normalizeTags(form.tags)
        })
      });

      setTodos((current) => [data.todo, ...current]);
      setForm({
        title: "",
        note: "",
        dueAt: "",
        priority: "medium",
        remindBefore: 10,
        tags: ""
      });
      setIsConnected(true);
    } catch (error) {
      setIsConnected(false);
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleTodo(id) {
    const todo = todos.find((item) => item.id === id);
    if (!todo) return;

    const nextDone = !todo.done;
    setTodos((current) =>
      current.map((item) =>
        item.id === id ? { ...item, done: nextDone } : item
      )
    );

    try {
      const data = await requestJson(`/api/todo-plans/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ done: nextDone })
      });
      setTodos((current) =>
        current.map((item) => (item.id === id ? data.todo : item))
      );
      setIsConnected(true);
    } catch (error) {
      setTodos((current) =>
        current.map((item) =>
          item.id === id ? { ...item, done: todo.done } : item
        )
      );
      setIsConnected(false);
    }
  }

  async function removeTodo(id) {
    const previous = todos;
    setTodos((current) => current.filter((todo) => todo.id !== id));

    try {
      await requestJson(`/api/todo-plans/${id}?userId=${USER_ID}`, {
        method: "DELETE"
      });
      setIsConnected(true);
    } catch (error) {
      setTodos(previous);
      setIsConnected(false);
    }
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
          <p className="hero-text quote-carousel" key={quoteIndex}>
            <span className="quote-mark">“</span>
            <span className="quote-line">{quoteOptions[quoteIndex].text}</span>
            <span className="quote-author">作者：{quoteOptions[quoteIndex].author}</span>
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
            通知权限：
            <strong>{getNotificationStatusLabel(notificationReady)}</strong>
          </p>
          <p className="notify-tip">
            数据状态：<strong>{isConnected ? "已连接" : "未连接"}</strong>
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
            <p>给任务一个明确的时间、优先级和标签。</p>
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

          <label>
            <span>标签</span>
            <input
              value={form.tags}
              onChange={(event) => updateForm("tags", event.target.value)}
              placeholder="用空格或逗号分隔，比如：工作 重要"
            />
          </label>

          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? "保存中..." : "添加事项"}
          </button>
        </form>

        <section className="panel list-panel">
          <div className="panel-head row">
            <div>
              <h2>待办清单</h2>
              <p>按关键词、状态或标签快速聚焦。</p>
            </div>

            <div className="filters">
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="搜索标题、备注或标签"
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

              <div className="tag-filters" role="group" aria-label="按标签筛选待办">
                <button
                  className={`tag-chip ${selectedTag === "all" ? "active" : ""}`}
                  type="button"
                  onClick={() => setSelectedTag("all")}
                >
                  全部标签
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    className={`tag-chip ${selectedTag === tag ? "active" : ""}`}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="todo-list">
            {isLoading ? (
              <div className="empty-state">
                <h3>正在加载待办</h3>
                <p>正在从 Supabase 读取你的计划表。</p>
              </div>
            ) : visibleTodos.length ? (
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
                    {Array.isArray(todo.tags) && todo.tags.length > 0 ? (
                      <div className="todo-tags" aria-label="待办标签">
                        {todo.tags.map((tag) => (
                          <button
                            key={tag}
                            className="tag-chip compact"
                            type="button"
                            onClick={() => setSelectedTag(tag)}
                          >
                            #{tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
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
