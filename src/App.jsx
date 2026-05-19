import { useEffect, useMemo, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const USER_STORAGE_KEY = "todo-reminder-current-user";
const DEFAULT_FOLDER = "默认";

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

const recurrenceOptions = [
  { value: "none", label: "不重复" },
  { value: "daily", label: "每天" },
  { value: "weekly", label: "每周" },
  { value: "monthly", label: "每月" },
  { value: "yearly", label: "每年" }
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

const emptyForm = {
  title: "",
  note: "",
  dueAt: "",
  priority: "medium",
  remindBefore: 10,
  tags: "",
  folder: DEFAULT_FOLDER,
  recurrence: "none",
  progressCurrent: 0,
  progressTotal: 7
};

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

function normalizeTodo(todo) {
  return {
    ...todo,
    tags: Array.isArray(todo.tags) ? todo.tags : [],
    folder: todo.folder || DEFAULT_FOLDER,
    recurrence: todo.recurrence || "none",
    sortOrder: Number.isFinite(Number(todo.sortOrder))
      ? Number(todo.sortOrder)
      : todo.createdAt || Date.now(),
    progressCurrent: Number.isFinite(Number(todo.progressCurrent))
      ? Number(todo.progressCurrent)
      : 0,
    progressTotal: Number.isFinite(Number(todo.progressTotal))
      ? Math.max(1, Number(todo.progressTotal))
      : 1
  };
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 16);
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

function normalizeUserName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function createUserIdFromName(name) {
  const input = normalizeUserName(name).toLowerCase();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
    h3 = Math.imul(h3 ^ code, 2246822507);
    h4 = Math.imul(h4 ^ code, 3266489909);
  }

  const bytes = [h1, h2, h3, h4].flatMap((value) => {
    const number = value >>> 0;
    return [
      (number >>> 24) & 255,
      (number >>> 16) & 255,
      (number >>> 8) & 255,
      number & 255
    ];
  });

  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;

  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join("")
  ].join("-");
}

function readStoredUser() {
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;

    const user = JSON.parse(raw);
    if (user?.name && user?.id) return user;
  } catch {
    window.localStorage.removeItem(USER_STORAGE_KEY);
  }

  return null;
}

function addRecurringInterval(value, recurrence) {
  if (!value || recurrence === "none") return value || null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  if (recurrence === "daily") date.setDate(date.getDate() + 1);
  if (recurrence === "weekly") date.setDate(date.getDate() + 7);
  if (recurrence === "monthly") date.setMonth(date.getMonth() + 1);
  if (recurrence === "yearly") date.setFullYear(date.getFullYear() + 1);

  return date.toISOString();
}

async function requestJson(path, userId, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-User-Id": userId,
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
  const [currentUser, setCurrentUser] = useState(readStoredUser);
  const [loginName, setLoginName] = useState(currentUser?.name || "");
  const [todos, setTodos] = useState([]);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState("all");
  const [selectedTag, setSelectedTag] = useState("all");
  const [selectedFolder, setSelectedFolder] = useState("all");
  const [editingId, setEditingId] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(currentUser));
  const [isSaving, setIsSaving] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [notificationReady, setNotificationReady] = useState(
    typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  );
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!currentUser?.id) {
      setTodos([]);
      setIsLoading(false);
      setIsConnected(false);
      return;
    }

    loadTodos(currentUser.id);
  }, [currentUser?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quoteOptions.length);
    }, 5200);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return undefined;

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

            requestJson(`/api/todo-plans/${todo.id}`, currentUser.id, {
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
  }, [notificationReady, currentUser?.id]);

  async function loadTodos(userId = currentUser?.id) {
    if (!userId) return;

    setIsLoading(true);

    try {
      const data = await requestJson("/api/todo-plans", userId);
      setTodos(Array.isArray(data.todos) ? data.todos.map(normalizeTodo) : []);
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    } finally {
      setIsLoading(false);
    }
  }

  const stats = useMemo(() => {
    const total = todos.length;
    const done = todos.filter((item) => item.done).length;
    const recurring = todos.filter((item) => item.recurrence !== "none").length;
    const upcoming = todos.filter((item) => {
      if (!item.dueAt || item.done) return false;
      const diff = new Date(item.dueAt).getTime() - Date.now();
      return diff > 0 && diff <= 24 * 60 * 60 * 1000;
    }).length;

    return { total, done, recurring, upcoming };
  }, [todos]);

  const allTags = useMemo(() => {
    return Array.from(new Set(todos.flatMap((todo) => todo.tags))).sort((a, b) =>
      a.localeCompare(b, "zh-CN")
    );
  }, [todos]);

  const allFolders = useMemo(() => {
    return Array.from(new Set(todos.map((todo) => todo.folder || DEFAULT_FOLDER))).sort(
      (a, b) => a.localeCompare(b, "zh-CN")
    );
  }, [todos]);

  const visibleTodos = useMemo(() => {
    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

    return todos
      .filter((todo) => {
        const normalizedKeyword = keyword.toLowerCase();
        const matchedKeyword =
          !normalizedKeyword ||
          todo.title.toLowerCase().includes(normalizedKeyword) ||
          (todo.note || "").toLowerCase().includes(normalizedKeyword) ||
          todo.folder.toLowerCase().includes(normalizedKeyword) ||
          todo.tags.some((tag) => tag.toLowerCase().includes(normalizedKeyword));
        const matchedTag = selectedTag === "all" || todo.tags.includes(selectedTag);
        const matchedFolder =
          selectedFolder === "all" || todo.folder === selectedFolder;

        if (!matchedKeyword || !matchedTag || !matchedFolder) return false;
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
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
  }, [todos, keyword, filter, selectedTag, selectedFolder]);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function resetComposer() {
    setEditingId(null);
    setForm(emptyForm);
  }

  function handleLogin(event) {
    event.preventDefault();

    const name = normalizeUserName(loginName);
    if (!name) return;

    const nextUser = {
      id: createUserIdFromName(name),
      name
    };

    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    setSelectedTag("all");
    setSelectedFolder("all");
    setKeyword("");
    setFilter("all");
    setCurrentUser(nextUser);
  }

  function handleLogout() {
    window.localStorage.removeItem(USER_STORAGE_KEY);
    setCurrentUser(null);
    setLoginName("");
    resetComposer();
  }

  function createPayload(title) {
    const recurrence = form.recurrence;
    const progressTotal = Math.max(1, Number(form.progressTotal) || 1);

    return {
      title,
      note: form.note.trim(),
      dueAt: form.dueAt || null,
      priority: form.priority,
      remindBeforeMinutes: Number(form.remindBefore),
      tags: normalizeTags(form.tags),
      folder: form.folder.trim() || DEFAULT_FOLDER,
      recurrence,
      progressCurrent:
        recurrence === "none"
          ? 0
          : Math.min(progressTotal, Math.max(0, Number(form.progressCurrent) || 0)),
      progressTotal: recurrence === "none" ? 1 : progressTotal
    };
  }

  async function saveTodo(event) {
    event.preventDefault();

    const title = form.title.trim();
    if (!title || isSaving || !currentUser?.id) return;

    setIsSaving(true);

    try {
      const payload = createPayload(title);
      const path = editingId ? `/api/todo-plans/${editingId}` : "/api/todo-plans";
      const data = await requestJson(path, currentUser.id, {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify({
          ...payload,
          sortOrder: editingId
            ? todos.find((todo) => todo.id === editingId)?.sortOrder
            : Math.max(0, ...todos.map((todo) => todo.sortOrder || 0)) + 1000
        })
      });

      const savedTodo = normalizeTodo(data.todo);
      setTodos((current) =>
        editingId
          ? current.map((todo) => (todo.id === editingId ? savedTodo : todo))
          : [...current, savedTodo]
      );
      setSelectedFolder(savedTodo.folder);
      resetComposer();
      setIsConnected(true);
    } catch {
      setIsConnected(false);
    } finally {
      setIsSaving(false);
    }
  }

  function editTodo(todo) {
    setEditingId(todo.id);
    setForm({
      title: todo.title,
      note: todo.note || "",
      dueAt: toDatetimeLocal(todo.dueAt),
      priority: todo.priority,
      remindBefore: todo.remindBefore,
      tags: todo.tags.join(" "),
      folder: todo.folder || DEFAULT_FOLDER,
      recurrence: todo.recurrence || "none",
      progressCurrent: todo.progressCurrent || 0,
      progressTotal: todo.progressTotal || 1
    });
  }

  async function patchTodo(id, body, rollback) {
    if (!currentUser?.id) return;

    try {
      const data = await requestJson(`/api/todo-plans/${id}`, currentUser.id, {
        method: "PATCH",
        body: JSON.stringify(body)
      });
      const savedTodo = normalizeTodo(data.todo);
      setTodos((current) =>
        current.map((item) => (item.id === id ? savedTodo : item))
      );
      setIsConnected(true);
    } catch {
      if (rollback) setTodos(rollback);
      setIsConnected(false);
    }
  }

  async function toggleTodo(id) {
    const todo = todos.find((item) => item.id === id);
    if (!todo) return;

    const previous = todos;

    if (todo.recurrence !== "none" && !todo.done) {
      const nextProgress = Math.min(
        todo.progressTotal,
        (todo.progressCurrent || 0) + 1
      );
      const isComplete = nextProgress >= todo.progressTotal;
      const optimistic = {
        ...todo,
        done: isComplete,
        notified: false,
        progressCurrent: nextProgress,
        dueAt: isComplete ? todo.dueAt : addRecurringInterval(todo.dueAt, todo.recurrence)
      };

      setTodos((current) =>
        current.map((item) => (item.id === id ? optimistic : item))
      );
      await patchTodo(
        id,
        {
          done: isComplete,
          notified: false,
          progressCurrent: nextProgress,
          dueAt: optimistic.dueAt
        },
        previous
      );
      return;
    }

    const nextDone = !todo.done;
    setTodos((current) =>
      current.map((item) => (item.id === id ? { ...item, done: nextDone } : item))
    );
    await patchTodo(id, { done: nextDone }, previous);
  }

  async function removeTodo(id) {
    if (!currentUser?.id) return;

    const previous = todos;
    setTodos((current) => current.filter((todo) => todo.id !== id));

    try {
      await requestJson(`/api/todo-plans/${id}`, currentUser.id, {
        method: "DELETE"
      });
      if (editingId === id) resetComposer();
      setIsConnected(true);
    } catch {
      setTodos(previous);
      setIsConnected(false);
    }
  }

  async function moveTodo(id, direction) {
    const index = visibleTodos.findIndex((todo) => todo.id === id);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= visibleTodos.length) return;

    const source = visibleTodos[index];
    const target = visibleTodos[targetIndex];
    const previous = todos;

    setTodos((current) =>
      current.map((todo) => {
        if (todo.id === source.id) return { ...todo, sortOrder: target.sortOrder };
        if (todo.id === target.id) return { ...todo, sortOrder: source.sortOrder };
        return todo;
      })
    );

    try {
      await Promise.all([
        requestJson(`/api/todo-plans/${source.id}`, currentUser.id, {
          method: "PATCH",
          body: JSON.stringify({ sortOrder: target.sortOrder })
        }),
        requestJson(`/api/todo-plans/${target.id}`, currentUser.id, {
          method: "PATCH",
          body: JSON.stringify({ sortOrder: source.sortOrder })
        })
      ]);
      setIsConnected(true);
    } catch {
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
            <span className="quote-author">
              作者：{quoteOptions[quoteIndex].author}
            </span>
          </p>
        </div>

        <div className="hero-actions">
          {currentUser ? (
            <div className="account-panel">
              <p className="notify-tip">
                当前用户：<strong>{currentUser.name}</strong>
              </p>
              <button className="account-button" type="button" onClick={handleLogout}>
                切换用户
              </button>
            </div>
          ) : (
            <form className="account-panel" onSubmit={handleLogin}>
              <label>
                <span>登录用户</span>
                <input
                  value={loginName}
                  onChange={(event) => setLoginName(event.target.value)}
                  placeholder="输入你的用户名"
                />
              </label>
              <button className="account-button" type="submit">
                进入我的清单
              </button>
            </form>
          )}

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
          <div className="status-list" aria-label="应用状态">
            <span
              className="status-row"
              aria-label={`通知权限：${getNotificationStatusLabel(notificationReady)}`}
              title={`通知权限：${getNotificationStatusLabel(notificationReady)}`}
            >
              <span
                className={`status-dot ${
                  notificationReady === "granted" ? "ok" : "error"
                }`}
                aria-hidden="true"
              />
            </span>
            <span
              className="status-row"
              aria-label={`数据状态：${isConnected ? "已连接" : "未连接"}`}
              title={`数据状态：${isConnected ? "已连接" : "未连接"}`}
            >
              <span
                className={`status-dot ${isConnected ? "ok" : "error"}`}
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </section>

      {currentUser ? (
        <>
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
              <span>重复任务</span>
              <strong>{stats.recurring}</strong>
            </article>
            <article className="stat-card">
              <span>24 小时内到期</span>
              <strong>{stats.upcoming}</strong>
            </article>
          </section>

          <section className="workspace">
            <form className="panel composer" onSubmit={saveTodo}>
              <div className="panel-head">
                <h2>{editingId ? "编辑待办" : "新增待办"}</h2>
                <p>设置时间、分类、重复节奏和进度目标。</p>
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

              <div className="grid-two">
                <label>
                  <span>重复频次</span>
                  <select
                    value={form.recurrence}
                    onChange={(event) => updateForm("recurrence", event.target.value)}
                  >
                    {recurrenceOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

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
              </div>

              {form.recurrence !== "none" ? (
                <div className="grid-two">
                  <label>
                    <span>已完成次数</span>
                    <input
                      type="number"
                      min="0"
                      value={form.progressCurrent}
                      onChange={(event) =>
                        updateForm("progressCurrent", event.target.value)
                      }
                    />
                  </label>

                  <label>
                    <span>目标次数</span>
                    <input
                      type="number"
                      min="1"
                      value={form.progressTotal}
                      onChange={(event) =>
                        updateForm("progressTotal", event.target.value)
                      }
                    />
                  </label>
                </div>
              ) : null}

              <label>
                <span>文件夹</span>
                <input
                  value={form.folder}
                  onChange={(event) => updateForm("folder", event.target.value)}
                  placeholder="比如：工作、学习、家庭"
                  list="folder-options"
                />
                <datalist id="folder-options">
                  {allFolders.map((folder) => (
                    <option key={folder} value={folder} />
                  ))}
                </datalist>
              </label>

              <label>
                <span>标签</span>
                <input
                  value={form.tags}
                  onChange={(event) => updateForm("tags", event.target.value)}
                  placeholder="用空格或逗号分隔，比如：工作 重要"
                />
              </label>

              <div className="composer-actions">
                {editingId ? (
                  <button className="secondary-button" type="button" onClick={resetComposer}>
                    取消编辑
                  </button>
                ) : null}
                <button className="primary-button" type="submit" disabled={isSaving}>
                  {isSaving ? "保存中..." : editingId ? "保存修改" : "添加事项"}
                </button>
              </div>
            </form>

            <section className="panel list-panel">
              <div className="panel-head row">
                <div>
                  <h2>待办清单</h2>
                  <p>按关键词、状态、标签或文件夹快速聚焦。</p>
                </div>

                <div className="filters">
                  <input
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    placeholder="搜索标题、备注、文件夹或标签"
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

                  <div className="tag-filters" role="group" aria-label="按文件夹筛选待办">
                    <button
                      className={`tag-chip ${selectedFolder === "all" ? "active" : ""}`}
                      type="button"
                      onClick={() => setSelectedFolder("all")}
                    >
                      全部文件夹
                    </button>
                    {allFolders.map((folder) => (
                      <button
                        key={folder}
                        className={`tag-chip ${
                          selectedFolder === folder ? "active" : ""
                        }`}
                        type="button"
                        onClick={() => setSelectedFolder(folder)}
                      >
                        {folder}
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
                  visibleTodos.map((todo, index) => {
                    const isRecurring = todo.recurrence !== "none";
                    const progressPercent = Math.min(
                      100,
                      Math.round((todo.progressCurrent / todo.progressTotal) * 100)
                    );

                    return (
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

                          <div className="todo-meta">
                            <button
                              className="tag-chip compact"
                              type="button"
                              onClick={() => setSelectedFolder(todo.folder)}
                            >
                              {todo.folder}
                            </button>
                            {isRecurring ? (
                              <span className="recurrence-chip">
                                {
                                  recurrenceOptions.find(
                                    (item) => item.value === todo.recurrence
                                  )?.label
                                }
                              </span>
                            ) : null}
                          </div>

                          {isRecurring ? (
                            <div className="progress-block">
                              <div className="progress-line">
                                <span>完成进度</span>
                                <strong>
                                  {todo.progressCurrent}/{todo.progressTotal}
                                </strong>
                              </div>
                              <div className="progress-track" aria-hidden="true">
                                <span style={{ width: `${progressPercent}%` }} />
                              </div>
                            </div>
                          ) : null}

                          {todo.tags.length > 0 ? (
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
                          <div className="move-actions">
                            <button
                              type="button"
                              className="ghost icon-button"
                              disabled={index === 0}
                              onClick={() => moveTodo(todo.id, "up")}
                              title="上移"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="ghost icon-button"
                              disabled={index === visibleTodos.length - 1}
                              onClick={() => moveTodo(todo.id, "down")}
                              title="下移"
                            >
                              ↓
                            </button>
                          </div>
                          <button type="button" onClick={() => toggleTodo(todo.id)}>
                            {todo.done
                              ? "恢复"
                              : isRecurring
                                ? "完成一次"
                                : "完成"}
                          </button>
                          <button type="button" className="ghost" onClick={() => editTodo(todo)}>
                            修改
                          </button>
                          <button
                            type="button"
                            className="ghost danger"
                            onClick={() => removeTodo(todo.id)}
                          >
                            删除
                          </button>
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <h3>还没有匹配的事项</h3>
                    <p>先添加一个待办，或者换个筛选条件看看。</p>
                  </div>
                )}
              </div>
            </section>
          </section>
        </>
      ) : (
        <section className="panel signed-out-panel">
          <div className="empty-state">
            <h3>先选择你的用户</h3>
            <p>不同用户名会进入不同的待办清单。</p>
          </div>
        </section>
      )}
    </main>
  );
}
