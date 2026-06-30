const STORAGE_KEY = "personalPlannerV1";
const COPILOT_STORAGE_KEY = "personalPlannerCopilotV1";
const AUTH_STORAGE_KEY = "personalPlannerAuthV1";
const DAY_NAMES = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "CN"];
const TYPE_LABELS = {
  fixed: "Lịch cố định",
  deadline: "Deadline",
  task: "Việc linh hoạt",
  habit: "Thói quen",
  rest: "Relax"
};
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const WORK_WINDOWS = [
  { start: "08:00", end: "12:00" },
  { start: "13:30", end: "18:00" },
  { start: "19:00", end: "21:30" }
];
const CALENDAR_START_MINUTES = 6 * 60;
const CALENDAR_END_MINUTES = 22 * 60;
const CALENDAR_MAX_END_MINUTES = 24 * 60;
const CALENDAR_PIXELS_PER_MINUTE = 1.05;
const CALENDAR_MIN_PIXELS_PER_MINUTE = 0.7;
const CALENDAR_MAX_PIXELS_PER_MINUTE = 1.8;
const LIGHT_WINDOWS = [
  { start: "07:00", end: "08:30" },
  { start: "16:30", end: "20:30" },
  { start: "09:00", end: "11:30" }
];
const CATEGORY_META = {
  work: { label: "Work", icon: "💼", className: "work" },
  study: { label: "Study", icon: "📚", className: "study" },
  leisure: { label: "Leisure", icon: "🎮", className: "leisure" },
  health: { label: "Health", icon: "🏋", className: "health" }
};
const SMART_CATEGORIES = [
  { id: "health", label: "Health", icon: "🏋" },
  { id: "work", label: "Work", icon: "💼" },
  { id: "personal", label: "Personal", icon: "👤" },
  { id: "learning", label: "Learning", icon: "📖" },
  { id: "social", label: "Social", icon: "👥" },
  { id: "other", label: "Other", icon: "…" }
];

const state = loadState();
const authState = loadAuthState();
const smartAddState = {
  input: "",
  suggestions: [],
  selectedSuggestionIds: new Set(),
  selectedIndex: 0,
  selectedCategory: "other",
  draft: null,
  conflict: null,
  conflicts: [],
  alternative: null,
  missingFields: [],
  pendingAddAnyway: false
};
const copilotState = loadCopilotState();

function loadState() {
  const today = new Date();
  const weekStart = toInputDate(startOfWeek(today));
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const items = Array.isArray(saved.items) ? saved.items.filter((item) => !isMalformedCompactNoteItem(item)) : [];
    const removedIds = new Set((Array.isArray(saved.items) ? saved.items : [])
      .filter(isMalformedCompactNoteItem)
      .map((item) => item.id)
      .filter(Boolean));
    const schedule = Array.isArray(saved.schedule)
      ? saved.schedule.filter((event) => !removedIds.has(event.sourceId) && !isMalformedCompactNoteItem(event) && !isAutoRestEvent(event))
      : [];
    const warnings = Array.isArray(saved.warnings) ? saved.warnings.filter((warning) => !isMalformedCompactText(warning)) : [];
    const next = {
      weekStart: saved.weekStart || weekStart,
      items,
      schedule,
      warnings,
      optimizations: Array.isArray(saved.optimizations) ? saved.optimizations : [],
      completedEvents: saved.completedEvents && typeof saved.completedEvents === "object" ? saved.completedEvents : {},
      settings: {
        calendarPixelsPerMinute: normalizeCalendarPixelsPerMinute(saved.settings?.calendarPixelsPerMinute)
      }
    };
    const changed = items.length !== (Array.isArray(saved.items) ? saved.items.length : 0)
      || schedule.length !== (Array.isArray(saved.schedule) ? saved.schedule.length : 0)
      || warnings.length !== (Array.isArray(saved.warnings) ? saved.warnings.length : 0);
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  } catch {
    return { weekStart, items: [], schedule: [], warnings: [], optimizations: [], completedEvents: {}, settings: { calendarPixelsPerMinute: CALENDAR_PIXELS_PER_MINUTE } };
  }
}

function normalizeCalendarPixelsPerMinute(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return CALENDAR_PIXELS_PER_MINUTE;
  return Math.max(CALENDAR_MIN_PIXELS_PER_MINUTE, Math.min(CALENDAR_MAX_PIXELS_PER_MINUTE, number));
}

function isMalformedCompactNoteItem(item) {
  const text = [
    item?.title,
    item?.notes,
    item?.description,
    item?.task
  ].filter(Boolean).join(" ");
  return isMalformedCompactText(text);
}

function isAutoRestEvent(event) {
  return event?.sourceId === "auto-rest"
    || event?.id === "auto-rest"
    || /Đi bộ \/ nghỉ không màn hình|Tự động chèn để giữ nhịp tuần/i.test(`${event?.title || ""} ${event?.notes || ""}`);
}

function isMalformedCompactText(value) {
  const text = String(value || "");
  if (text.length < 160) return false;
  const sectionCount = (text.match(/\d+[.)]\s+[^:]{2,90}:/g) || []).length;
  const bulletCount = (text.match(/\s-\s+/g) || []).length;
  const knownBadNote = /Quan hệ công chúng|Quan h/i.test(text)
    && /Quản trị phát triển bền vững|Qu.n tr/i.test(text)
    && /Quản trị thương hiệu|Qu.n tr.*th/i.test(text);
  return knownBadNote || sectionCount >= 2 || bulletCount >= 3;
}

function saveState() {
  state.completedEvents = state.completedEvents || {};
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  queueRemoteSync();
}

function loadAuthState() {
  try {
    const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "{}");
    return {
      accessToken: String(saved.accessToken || ""),
      refreshToken: String(saved.refreshToken || ""),
      email: String(saved.email || ""),
      userId: String(saved.userId || ""),
      configured: false,
      syncing: false,
      lastSyncAt: String(saved.lastSyncAt || ""),
      error: ""
    };
  } catch {
    return { accessToken: "", refreshToken: "", email: "", userId: "", configured: false, syncing: false, lastSyncAt: "", error: "" };
  }
}

function saveAuthState() {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
    accessToken: authState.accessToken,
    refreshToken: authState.refreshToken,
    email: authState.email,
    userId: authState.userId,
    lastSyncAt: authState.lastSyncAt
  }));
}

function loadCopilotState() {
  const fallback = {
    conversationId: uid("conversation"),
    messages: [],
    optionBatches: [],
    status: "idle",
    error: "",
    activeSource: null
  };
  try {
    const saved = JSON.parse(localStorage.getItem(COPILOT_STORAGE_KEY) || "{}");
    return {
      conversationId: saved.conversationId || fallback.conversationId,
      messages: Array.isArray(saved.messages) ? saved.messages : [],
      optionBatches: Array.isArray(saved.optionBatches) ? saved.optionBatches : [],
      status: "idle",
      error: "",
      activeSource: null
    };
  } catch {
    return fallback;
  }
}

function saveCopilotState() {
  localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify({
    conversationId: copilotState.conversationId,
    messages: copilotState.messages,
    optionBatches: copilotState.optionBatches
  }));
  queueRemoteSync();
}

let remoteSyncTimer = null;

function hasAuthSession() {
  return Boolean(authState.accessToken);
}

function setSyncStatus(message, tone = "") {
  const status = document.getElementById("syncStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
}

function renderSyncUi() {
  const form = document.getElementById("syncForm");
  const userBox = document.getElementById("syncUserBox");
  const email = document.getElementById("syncUserEmail");
  if (!form || !userBox || !email) return;
  form.hidden = hasAuthSession();
  userBox.hidden = !hasAuthSession();
  email.textContent = authState.email || "Đã đăng nhập";
  if (!authState.configured) {
    setSyncStatus("Chưa cấu hình Supabase trên server.");
  } else if (authState.error) {
    setSyncStatus(authState.error, "error");
  } else if (authState.syncing) {
    setSyncStatus("Đang đồng bộ...");
  } else if (hasAuthSession()) {
    setSyncStatus(authState.lastSyncAt ? `Đã đồng bộ ${formatSyncTime(authState.lastSyncAt)}.` : "Đã đăng nhập. Lịch sẽ tự đồng bộ.");
  } else {
    setSyncStatus("Đăng nhập để đồng bộ lịch giữa laptop và điện thoại.");
  }
}

function formatSyncTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }).format(date);
}

function queueRemoteSync() {
  if (!hasAuthSession()) return;
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = setTimeout(() => syncRemoteState("push"), 900);
}

function copilotStateForRemote() {
  return {
    conversationId: copilotState.conversationId,
    messages: copilotState.messages,
    optionBatches: copilotState.optionBatches
  };
}

async function apiJson(pathname, options = {}, retried = false) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (authState.accessToken) headers.Authorization = `Bearer ${authState.accessToken}`;
  const response = await fetch(pathname, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && authState.refreshToken && !retried) {
    const refreshed = await refreshAuthSession();
    if (refreshed) return apiJson(pathname, options, true);
  }
  if (!response.ok) throw new Error(data.error || data.message || `HTTP ${response.status}`);
  return data;
}

async function refreshAuthSession() {
  if (!authState.refreshToken) return false;
  try {
    const data = await apiJson("/api/auth/refresh", {
      method: "POST",
      body: { refreshToken: authState.refreshToken },
      headers: {}
    }, true);
    applyAuthResult(data);
    return Boolean(authState.accessToken);
  } catch {
    clearAuthSession("Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.");
    return false;
  }
}

function applyAuthResult(data) {
  authState.accessToken = data.accessToken || "";
  authState.refreshToken = data.refreshToken || authState.refreshToken || "";
  authState.email = data.user?.email || authState.email || "";
  authState.userId = data.user?.id || authState.userId || "";
  authState.error = "";
  saveAuthState();
  renderSyncUi();
}

function clearAuthSession(message = "") {
  authState.accessToken = "";
  authState.refreshToken = "";
  authState.email = "";
  authState.userId = "";
  authState.error = message;
  saveAuthState();
  renderSyncUi();
}

async function initSync() {
  renderSyncUi();
  try {
    const status = await apiJson("/api/sync/status");
    authState.configured = Boolean(status.configured);
    authState.error = status.configured ? "" : `Thiếu cấu hình: ${(status.missing || []).join(", ")}`;
    renderSyncUi();
    if (authState.configured && hasAuthSession()) await syncRemoteState("pull");
  } catch (error) {
    authState.configured = false;
    authState.error = `Không kiểm tra được đồng bộ: ${error.message}`;
    renderSyncUi();
  }
}

async function syncRemoteState(mode = "push") {
  if (!hasAuthSession() || !authState.configured) return;
  authState.syncing = true;
  authState.error = "";
  renderSyncUi();
  try {
    if (mode === "pull") {
      const remote = await apiJson("/api/planner-state");
      if (remote.found && remote.plannerState) {
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, loadStateFromObject(remote.plannerState));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        if (remote.copilotState) {
          Object.assign(copilotState, loadCopilotStateFromObject(remote.copilotState));
          localStorage.setItem(COPILOT_STORAGE_KEY, JSON.stringify(copilotStateForRemote()));
        }
        renderAll();
      } else {
        await syncRemoteState("push");
        return;
      }
    } else {
      const saved = await apiJson("/api/planner-state", {
        method: "PUT",
        body: { plannerState: state, copilotState: copilotStateForRemote() }
      });
      authState.lastSyncAt = saved.updatedAt || new Date().toISOString();
      saveAuthState();
    }
  } catch (error) {
    authState.error = `Đồng bộ lỗi: ${error.message}`;
  } finally {
    authState.syncing = false;
    renderSyncUi();
  }
}

function loadStateFromObject(saved = {}) {
  const currentWeekStart = toInputDate(startOfWeek(new Date()));
  return {
    weekStart: saved.weekStart || currentWeekStart,
    items: Array.isArray(saved.items) ? saved.items : [],
    schedule: Array.isArray(saved.schedule) ? saved.schedule : [],
    warnings: Array.isArray(saved.warnings) ? saved.warnings : [],
    optimizations: Array.isArray(saved.optimizations) ? saved.optimizations : [],
    completedEvents: saved.completedEvents && typeof saved.completedEvents === "object" ? saved.completedEvents : {},
    settings: {
      calendarPixelsPerMinute: normalizeCalendarPixelsPerMinute(saved.settings?.calendarPixelsPerMinute)
    }
  };
}

function loadCopilotStateFromObject(saved = {}) {
  return {
    conversationId: saved.conversationId || uid("conversation"),
    messages: Array.isArray(saved.messages) ? saved.messages : [],
    optionBatches: Array.isArray(saved.optionBatches) ? saved.optionBatches : [],
    status: "idle",
    error: "",
    activeSource: null
  };
}

async function handleSyncLogin(mode) {
  const email = value("syncEmail").trim();
  const password = value("syncPassword");
  if (!email || !password) {
    authState.error = "Nhập email và mật khẩu trước.";
    renderSyncUi();
    return;
  }
  authState.syncing = true;
  authState.error = "";
  renderSyncUi();
  try {
    const data = await apiJson(mode === "signup" ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      body: { email, password }
    });
    applyAuthResult(data);
    if (data.accessToken) await syncRemoteState("pull");
    else {
      authState.error = data.message || "Đăng ký xong. Hãy xác nhận email rồi đăng nhập.";
      renderSyncUi();
    }
  } catch (error) {
    authState.error = `${mode === "signup" ? "Đăng ký" : "Đăng nhập"} lỗi: ${error.message}`;
    renderSyncUi();
  } finally {
    authState.syncing = false;
    renderSyncUi();
  }
}

function startOfWeek(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  return copy;
}

function addDays(date, amount) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + amount);
  return copy;
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function minutesFromTime(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function timeFromMinutes(minutes) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function normalizeTimeInput(value, fallback = "09:00") {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function minutesBetween(start, end) {
  return Math.max(15, minutesFromTime(end) - minutesFromTime(start));
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function value(id) {
  return document.getElementById(id)?.value || "";
}

function setValue(id, next) {
  const element = document.getElementById(id);
  if (element) element.value = next;
}

function weekDates() {
  const start = parseDate(state.weekStart) || startOfWeek(new Date());
  return DAY_NAMES.map((_, index) => addDays(start, index));
}

function dateInCurrentWeek(dateString) {
  if (!dateString) return false;
  const date = parseDate(dateString);
  if (!date) return false;
  const days = weekDates();
  return date >= days[0] && date <= days[6];
}

function itemRelevantToWeek(item) {
  if (!item.date) return true;
  const date = parseDate(item.date);
  if (!date) return true;
  const days = weekDates();
  if (item.type === "deadline") return date >= days[0];
  return date >= days[0] && date <= days[6];
}

function comparableText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function itemDuplicateKey(item) {
  return [
    comparableText(item.title),
    item.date || "",
    item.start || "",
    item.end || ""
  ].join("|");
}

function dedupeItems(items) {
  const seen = new Map();
  const result = [];
  items.forEach((raw) => {
    const item = normalizeItem(raw);
    const key = itemDuplicateKey(item);
    if (!item.title) return;
    if (seen.has(key)) {
      const existing = result[seen.get(key)];
      if (item.type === "fixed" && existing.type !== "fixed") {
        Object.assign(existing, { ...item, id: existing.id });
      }
      return;
    }
    seen.set(key, result.length);
    result.push(item);
  });
  return result;
}

function eventDuplicateKey(event) {
  return [
    comparableText(event.title),
    event.date || "",
    event.start || "",
    event.end || ""
  ].join("|");
}

function dedupeScheduleEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = eventDuplicateKey(event);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addParsedItems(items) {
  const normalized = items.map(normalizeItem).filter((item) => item.title);
  let added = 0;
  let updated = 0;
  normalized.forEach((item) => {
    const key = itemDuplicateKey(item);
    const existing = state.items.find((candidate) => itemDuplicateKey(candidate) === key);
    if (existing) {
      Object.assign(existing, { ...item, id: existing.id });
      updated += 1;
    } else {
      state.items.push(item);
      added += 1;
    }
  });
  state.items = dedupeItems(state.items);
  return { added, updated };
}

function normalizeItem(raw) {
  let type = raw.type || "task";
  if (type === "fixed" && !raw.date) type = "task";
  const start = raw.start || "09:00";
  const end = raw.end || timeFromMinutes(minutesFromTime(start) + Number(raw.duration || 90));
  return {
    id: raw.id || uid("item"),
    title: String(raw.title || "").trim(),
    type,
    date: raw.date || "",
    start,
    end,
    duration: Math.max(15, Number(raw.duration || minutesBetween(start, end) || 90)),
    priority: raw.priority || "medium",
    frequency: Math.max(1, Number(raw.frequency || 1)),
    notes: String(raw.notes || "").trim()
  };
}

function addItem(raw) {
  const item = normalizeItem(raw);
  if (!item.title) return;
  state.items.push(item);
  autoPlanAndRender();
}

function removeItem(id) {
  state.items = state.items.filter((item) => item.id !== id);
  state.schedule = state.schedule.filter((event) => event.sourceId !== id);
  autoPlanAndRender();
}

function buildEvent(item, date, start, duration, extra = {}) {
  return {
    id: extra.id || uid("event"),
    sourceId: item.id,
    title: extra.title || item.title,
    type: item.type,
    date: toInputDate(date),
    start,
    end: timeFromMinutes(minutesFromTime(start) + duration),
    duration,
    notes: extra.notes || item.notes || "",
    completed: Boolean(extra.completed || item.completed)
  };
}

function eventOverlaps(a, b) {
  if (a.date !== b.date) return false;
  return minutesFromTime(a.start) < minutesFromTime(b.end) && minutesFromTime(a.end) > minutesFromTime(b.start);
}

function hasConflict(events, candidate) {
  return events.some((event) => eventOverlaps(event, candidate));
}

function findSlot(events, dates, duration, windows, beforeDate = null) {
  for (const date of dates) {
    if (beforeDate && date > beforeDate) continue;
    for (const window of windows) {
      const windowStart = minutesFromTime(window.start);
      const windowEnd = minutesFromTime(window.end);
      for (let start = windowStart; start + duration <= windowEnd; start += 15) {
        const candidate = {
          date: toInputDate(date),
          start: timeFromMinutes(start),
          end: timeFromMinutes(start + duration)
        };
        if (!hasConflict(events, candidate)) return candidate.start;
      }
    }
  }
  return "";
}

function splitIntoChunks(totalMinutes, type) {
  if (type === "habit" || type === "rest") return [Math.min(totalMinutes, 90)];
  const chunks = [];
  let remaining = Math.max(15, totalMinutes);
  while (remaining > 0) {
    const next = remaining > 150 ? 120 : remaining;
    chunks.push(Math.max(30, next));
    remaining -= next;
  }
  return chunks;
}

function sortByDeadline(items) {
  return [...items].sort((a, b) => {
    const aDate = parseDate(a.date)?.getTime() || Number.MAX_SAFE_INTEGER;
    const bDate = parseDate(b.date)?.getTime() || Number.MAX_SAFE_INTEGER;
    return aDate - bDate || (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
  });
}

function isPinnedScheduleItem(item) {
  if (item.type === "fixed") return true;
  if (item.type === "deadline") return false;
  if (!item.date || !item.start || !item.end) return false;
  const notes = comparableText(item.notes);
  if (/group:|category:|smart add|lich lap theo nhieu ngay/.test(notes)) return true;
  return false;
}

function planWeek() {
  const dates = weekDates();
  const events = [];
  const warnings = [];
  const optimizations = [];
  state.items = dedupeItems(state.items);
  state.completedEvents = state.completedEvents || {};
  state.schedule.filter((event) => event.completed).forEach((event) => rememberEventCompleted(event, true));
  const currentWeekItems = state.items.filter(itemRelevantToWeek);
  if (!currentWeekItems.length) {
    state.schedule = [];
    state.warnings = [];
    saveState();
    renderAll();
    return;
  }

  const pinnedItems = currentWeekItems.filter(isPinnedScheduleItem);
  const flexibleItems = currentWeekItems.filter((item) => !isPinnedScheduleItem(item));

  pinnedItems.forEach((item) => {
    const date = parseDate(item.date) || dates[0];
    const event = buildEvent(item, date, item.start, minutesBetween(item.start, item.end));
    if (hasConflict(events, event)) {
      warnings.push(`Lịch cố định "${item.title}" bị trùng với một mục khác. Giữ lại nhưng cần bạn kiểm tra.`);
      optimizations.push({
        type: "conflict",
        title: item.title,
        before: `${toInputDate(date)} ${item.start}-${item.end}`,
        after: "Giữ lịch cố định, các mục linh hoạt sẽ được xếp quanh khung này."
      });
    }
    events.push(event);
  });

  sortByDeadline(flexibleItems.filter((item) => item.type === "deadline")).forEach((item) => {
    const dueDate = parseDate(item.date) || dates[6];
    const eligibleDates = dates.filter((date) => date <= dueDate);
    const chunks = splitIntoChunks(item.duration, item.type);
    chunks.forEach((chunk, index) => {
      const startInfo = firstSlotWithDate(events, eligibleDates, chunk, WORK_WINDOWS);
      if (!startInfo) {
        warnings.push(`Không đủ chỗ trước deadline cho "${item.title}" (${chunk} phút còn lại).`);
        optimizations.push({
          type: "unplaced",
          title: item.title,
          before: `Cần ${chunk} phút trước ${item.date || "cuối tuần"}`,
          after: "Chưa có slot phù hợp. Cần giảm tải hoặc đổi ưu tiên."
        });
        return;
      }
      events.push(buildEvent(item, startInfo.date, startInfo.start, chunk, {
        title: chunks.length > 1 ? `${item.title} (${index + 1}/${chunks.length})` : item.title
      }));
    });
  });

  flexibleItems.filter((item) => item.type === "task").sort((a, b) => (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0)).forEach((item) => {
    splitIntoChunks(item.duration, item.type).forEach((chunk, index) => {
      const startInfo = firstSlotWithDate(events, dates, chunk, WORK_WINDOWS);
      if (!startInfo) {
        warnings.push(`Tuần này đang quá tải, chưa xếp được "${item.title}".`);
        optimizations.push({
          type: "unplaced",
          title: item.title,
          before: `${chunk} phút linh hoạt`,
          after: "Chưa có slot. Hãy xóa bớt hoặc rút ngắn task ít ưu tiên hơn."
        });
        return;
      }
      events.push(buildEvent(item, startInfo.date, startInfo.start, chunk, {
        title: index ? `${item.title} (${index + 1})` : item.title
      }));
    });
  });

  flexibleItems.filter((item) => item.type === "habit" || item.type === "rest").forEach((item) => {
    const count = Math.min(7, Math.max(1, Number(item.frequency || 1)));
    const datedHabit = item.date ? parseDate(item.date) : null;
    const preferredDates = datedHabit && datedHabit >= dates[0] && datedHabit <= dates[6]
      ? [datedHabit, ...balancedDates(dates, count).filter((date) => toInputDate(date) !== item.date)]
      : balancedDates(dates, count);
    for (let index = 0; index < count; index += 1) {
      const orderedDates = preferredDates.slice(index).concat(preferredDates.slice(0, index));
      const searchDates = datedHabit && index === 0 ? [datedHabit] : orderedDates;
      const startInfo = firstSlotWithDate(events, searchDates, Math.min(item.duration, 90), LIGHT_WINDOWS)
        || (datedHabit && index === 0 ? firstSlotWithDate(events, [datedHabit], Math.min(item.duration, 90), WORK_WINDOWS) : null);
      if (!startInfo) {
        warnings.push(`Chưa tìm được khoảng nhẹ cho "${item.title}".`);
        optimizations.push({
          type: "unplaced",
          title: item.title,
          before: item.date || "Một khoảng nhẹ trong tuần",
          after: "Không còn khoảng nhẹ phù hợp. Có thể chuyển sang ngày khác hoặc giảm thời lượng."
        });
        continue;
      }
      if (item.date && toInputDate(startInfo.date) !== item.date) {
        optimizations.push({
          type: "moved",
          title: item.title,
          before: item.date,
          after: `${toInputDate(startInfo.date)} ${startInfo.start}`
        });
      }
      events.push(buildEvent(item, startInfo.date, startInfo.start, Math.min(item.duration, 90), {
        title: count > 1 ? `${item.title} (${index + 1}/${count})` : item.title
      }));
    }
  });

  dates.forEach((date) => {
    const dateString = toInputDate(date);
    const dayEvents = events.filter((event) => event.date === dateString);
    const heavyMinutes = dayEvents
      .filter((event) => event.type === "deadline" || event.type === "task")
      .reduce((sum, event) => sum + event.duration, 0);
    if (heavyMinutes > 390) warnings.push(`${formatDate(date)} có hơn 6.5 giờ việc nặng. Nên giảm hoặc chuyển bớt.`);
  });

  state.schedule = sortEvents(events).map((event) => ({
    ...event,
    completed: isEventCompleted(event)
  }));
  state.warnings = warnings;
  state.optimizations = optimizations;
  saveState();
  renderAll();
}

function autoPlanAndRender() {
  planWeek();
}

function eventSignature(event) {
  return [event.sourceId || "", event.title || "", event.type || "", event.date || "", event.start || ""].join("|");
}

function eventCompletionKeys(event) {
  const title = comparableText(String(event?.title || "").replace(/\s*\(\d+(?:\/\d+)?\)\s*$/g, ""));
  const date = event?.date || "";
  const start = event?.start || "";
  const end = event?.end || "";
  const sourceId = event?.sourceId || "";
  const type = event?.type || "";
  return [
    eventSignature(event),
    [sourceId, date, start, end].join("|"),
    [title, date, start, end].join("|"),
    [title, type, date, start].join("|")
  ].filter((key, index, keys) => key.replace(/\|/g, "") && keys.indexOf(key) === index);
}

function isEventCompleted(event) {
  const completed = state.completedEvents || {};
  return eventCompletionKeys(event).some((key) => completed[key]) || Boolean(event.completed);
}

function rememberEventCompleted(event, completed) {
  state.completedEvents = state.completedEvents || {};
  eventCompletionKeys(event).forEach((key) => {
    if (completed) state.completedEvents[key] = true;
    else delete state.completedEvents[key];
  });
}

function scheduleCoversCurrentItems() {
  const covered = new Set(state.schedule.map((event) => event.sourceId).filter(Boolean));
  return state.items.filter(itemRelevantToWeek).every((item) => {
    if (!covered.has(item.id)) return false;
    if (isPinnedScheduleItem(item)) {
      return state.schedule.some((event) =>
        event.sourceId === item.id
        && event.date === item.date
        && event.start === item.start
        && event.end === item.end
      );
    }
    return true;
  });
}

function firstSlotWithDate(events, dates, duration, windows) {
  for (const date of dates) {
    const start = findSlot(events, [date], duration, windows);
    if (start) return { date, start };
  }
  return null;
}

function balancedDates(dates, count) {
  const order = count <= 2 ? [1, 4, 6, 2, 0, 3, 5] : [0, 2, 4, 6, 1, 3, 5];
  return order.map((index) => dates[index]).filter(Boolean);
}

function sortEvents(events) {
  return [...events].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}

function formatDate(date) {
  return new Intl.DateTimeFormat("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" }).format(date);
}

function parseNaturalLocal(text) {
  const lines = expandCompactNoteText(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let section = "";
  let pendingNote = "";
  const items = [];

  lines.forEach((line) => {
    const heading = line.match(/^(?:\d+[.)]\s*)?([^:-][^:]{2,80}):\s*$/);
    if (heading && !/^[-*]/.test(line)) {
      section = cleanNotePrefix(heading[1]);
      return;
    }
    if (/^\*?\s*note\s*:/i.test(line)) {
      pendingNote = cleanNotePrefix(line.replace(/^\*?\s*note\s*:/i, ""));
      return;
    }

    const cleaned = cleanNotePrefix(line);
    if (!cleaned) return;
    const lower = cleaned.toLowerCase();
    const dates = extractDatesFromText(lower);
    const time = extractTimeRange(lower) || extractSingleTime(lower);
    const type = inferItemType(lower, { date: dates[0] || "", time });
    const duration = extractDuration(lower) || (time?.end ? minutesBetween(time.start, time.end) : type === "habit" || type === "rest" ? 60 : 90);
    const title = section ? `${section} - ${cleaned}` : cleaned;
    const targetDates = dates.length ? dates : [""];
    targetDates.forEach((date) => {
      items.push(normalizeItem({
        title: title.replace(/\s+/g, " ").slice(0, 160),
        type,
        date,
        start: time?.start || "09:00",
        end: time?.end || timeFromMinutes(minutesFromTime(time?.start || "09:00") + duration),
        duration,
        priority: type === "deadline" ? "high" : "medium",
        frequency: extractFrequency(lower) || 1,
        notes: [pendingNote, targetDates.length > 1 ? "Lịch lặp theo nhiều ngày trong tuần." : "", "Tạo từ text note."].filter(Boolean).join(" ")
      }));
    });
    pendingNote = "";
  });

  return items;
}

function expandCompactNoteText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+(\d+[.)]\s+[^:\n]{2,90}:)/g, "\n$1\n")
    .replace(/[ \t]+(\*?\s*Note\s*:)/gi, "\n$1")
    .replace(/[ \t]+(-\s+[^-\n])/g, "\n$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanNotePrefix(line) {
  return String(line || "")
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .trim();
}

function inferItemType(lower, context = {}) {
  if (/deadline|hạn|han|nộp|nop|due|dl\b|kiểm tra|kiem tra|online/.test(lower)) return "deadline";
  if (/bơi|boi|pilates|gym|tập|tap|chạy|yoga|đọc|doc|habit|thói quen/.test(lower)) return "habit";
  if (/relax|nghỉ|nghi|xả hơi|xa hoi|thư giãn|giải trí|giai tri/.test(lower)) return "rest";
  if (/meeting|lịch|lich|ca làm|ca lam|lớp|lop/.test(lower) && (context.date || context.time)) return "fixed";
  if (/học|hoc|ôn|on|bài|bai|môn|mon|qt |quản trị|quan tri|thương hiệu|thuong hieu/.test(lower)) return "task";
  return "task";
}

function extractDateFromText(text) {
  const weekMap = [
    [/thứ\s*2|thu\s*2|monday|t2/, 0],
    [/thứ\s*3|thu\s*3|tuesday|t3/, 1],
    [/thứ\s*4|thu\s*4|wednesday|t4/, 2],
    [/thứ\s*5|thu\s*5|thursday|t5/, 3],
    [/thứ\s*6|thu\s*6|friday|t6/, 4],
    [/thứ\s*7|thu\s*7|saturday|t7/, 5],
    [/chủ\s*nhật|chu\s*nhat|sunday|cn/, 6]
  ];
  const dates = weekDates();
  const found = weekMap.find(([pattern]) => pattern.test(text));
  if (found) return toInputDate(dates[found[1]]);
  const match = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!match) return "";
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3] || parseDate(state.weekStart).getFullYear());
  return toInputDate(new Date(year < 100 ? year + 2000 : year, month - 1, day));
}

function extractDatesFromText(text) {
  const normalized = comparableText(text);
  const dates = weekDates();
  const found = new Set();
  const addWeekday = (value) => {
    const number = Number(value);
    if (number >= 2 && number <= 7) found.add(toInputDate(dates[number - 2]));
  };
  const sequence = normalized.match(/\b(?:thu|t)\s*((?:[2-7]\s*(?:,|\/|&|va|\s)\s*)+[2-7])\b/);
  if (sequence) {
    sequence[1].split(/[^2-7]+/).filter(Boolean).forEach(addWeekday);
  }
  [...normalized.matchAll(/\b(?:thu|t)\s*([2-7])\b/g)].forEach((match) => addWeekday(match[1]));
  if (/\b(?:chu nhat|cn|sunday)\b/.test(normalized)) found.add(toInputDate(dates[6]));
  if (found.size) return [...found].sort();
  const single = extractDateFromText(text);
  return single ? [single] : [];
}

function extractTimeRange(text) {
  const match = text.match(/(\d{1,2})(?:h|:)?(\d{2})?\s*(?:-|đến|den|to)\s*(\d{1,2})(?:h|:)?(\d{2})?/);
  if (!match) return null;
  const start = `${String(Number(match[1])).padStart(2, "0")}:${String(Number(match[2] || 0)).padStart(2, "0")}`;
  const end = `${String(Number(match[3])).padStart(2, "0")}:${String(Number(match[4] || 0)).padStart(2, "0")}`;
  return { start, end };
}

function extractSingleTime(text) {
  const match = text.match(/\b(\d{1,2})(?:h|:)(\d{2})?\s*(tối|toi|pm|chiều|chieu|sáng|sang|am)?\b/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const marker = match[3] || "";
  if ((/tối|toi|pm|chiều|chieu/.test(marker) || /tối nay|toi nay/.test(text)) && hour < 12) hour += 12;
  const end = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const start = timeFromMinutes(Math.max(0, minutesFromTime(end) - 60));
  return { start, end };
}

function extractDuration(text) {
  const match = text.match(/(\d+(?:[,.]\d+)?)\s*(giờ|gio|h|tiếng|tieng|phút|phut|m)\b/);
  if (!match) return 0;
  const amount = Number(match[1].replace(",", "."));
  return /ph|m\b/.test(match[2]) ? Math.round(amount) : Math.round(amount * 60);
}

function extractFrequency(text) {
  const match = text.match(/(\d+)\s*(buổi|buoi|lần|lan|sessions?)/);
  return match ? Number(match[1]) : 0;
}

async function parseWithAi() {
  const text = value("naturalInput").trim();
  if (!text) return;
  setAiState("Đang phân loại...");
  const success = document.getElementById("smartSuccess");
  if (success) success.hidden = true;
  smartAddState.input = text;
  try {
    const response = await fetch("/api/personal-planner/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, weekStart: state.weekStart })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "AI parse failed");
    const rawItems = Array.isArray(data.items) ? data.items : [];
    const items = rawItems.map(normalizeItem).filter((item) => item.title);
    if (!items.length) throw new Error("AI chưa trả về mục hợp lệ");
    smartAddState.suggestions = buildSmartSuggestions(rawItems);
    syncSmartSelection(true);
    selectSmartSuggestion(0);
    setAiState(`AI tạo ${items.length} gợi ý. Chưa thêm vào lịch.`);
  } catch (error) {
    const items = parseNaturalLocal(text);
    smartAddState.suggestions = buildSmartSuggestions(items);
    if (smartAddState.suggestions.length) {
      syncSmartSelection(true);
      selectSmartSuggestion(0);
      setAiState(`Fallback tạo ${items.length} gợi ý. Chưa thêm vào lịch.`);
    } else {
      setAiState("Chưa hiểu yêu cầu. Hãy bổ sung ngày và giờ.");
      renderSmartAdd();
    }
  }
}

function setAiState(text) {
  const element = document.getElementById("aiState");
  if (element) element.textContent = text;
}

function renderSmartAdd() {
  renderSmartSuggestions();
  renderCategorySelector();
  renderMissingFields();
  renderConflictAlert();
  renderAlternativeSlot();
  const addButton = document.getElementById("addSmartEvent");
  if (addButton) {
    const selectedCount = selectedSmartDrafts().length;
    addButton.disabled = !selectedCount || smartAddState.missingFields.length > 0;
    addButton.textContent = selectedCount > 1 ? `Add ${selectedCount} Events` : "Add Event";
  }
}

function renderSmartSuggestions() {
  const box = document.getElementById("smartSuggestions");
  if (!box) return;
  if (!smartAddState.suggestions.length) {
    box.innerHTML = `<div class="smart-empty">Nhập yêu cầu rồi bấm gửi để AI tạo bản nháp sự kiện.</div>`;
    return;
  }
  box.innerHTML = smartAddState.suggestions.map((draft, index) => {
    const active = index === smartAddState.selectedIndex;
    const checked = smartAddState.selectedSuggestionIds.has(draft.id);
    const category = SMART_CATEGORIES.find((item) => item.id === draft.category) || SMART_CATEGORIES[SMART_CATEGORIES.length - 1];
    const occurrenceCount = draftOccurrences(draft).length;
    return `
      <article class="ai-suggestion-card ${active ? "selected" : ""} ${checked ? "checked" : ""}" data-smart-suggestion="${index}">
        <label class="suggestion-check" title="Chọn để thêm vào lịch" onclick="event.stopPropagation()">
          <input type="checkbox" data-smart-toggle="${index}" ${checked ? "checked" : ""}>
        </label>
        <span class="suggestion-icon">${category.icon}</span>
        <div>
          <strong>${escapeHtml(draft.title)}</strong>
          <p>${escapeHtml(formatDraftDateTime(draft))}</p>
          <small>${draft.kind === "event_group" ? `${occurrenceCount} buổi trong tuần này · ` : ""}Confidence ${Math.round((draft.confidence || 0.8) * 100)}%</small>
          ${draft.kind === "event_group" ? `<ul class="occurrence-list">${draftOccurrences(draft).map((occurrence) => `<li>${escapeHtml(formatOccurrence(occurrence))}</li>`).join("")}</ul>` : ""}
        </div>
        <button type="button" class="${active ? "primary-btn" : "ghost-btn"}" data-smart-suggestion="${index}">${active ? "Đang xem" : "Xem"}</button>
      </article>
    `;
  }).join("");
}

function renderCategorySelector() {
  const box = document.getElementById("categorySelector");
  if (!box) return;
  box.innerHTML = SMART_CATEGORIES.map((category) => `
    <button type="button" class="category-chip ${smartAddState.selectedCategory === category.id ? "active" : ""}" data-smart-category="${category.id}">
      <span>${category.icon}</span>
      <strong>${category.label}</strong>
    </button>
  `).join("");
}

function renderMissingFields() {
  const box = document.getElementById("missingFields");
  if (!box) return;
  if (!smartAddState.missingFields.length) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `
    <div class="missing-card">
      <strong>Cần thêm thông tin</strong>
      <p>AI còn thiếu: ${smartAddState.missingFields.map(escapeHtml).join(", ")}. Hãy bổ sung ngày/giờ trong ô nhập trước khi Add Event.</p>
    </div>
  `;
}

function renderConflictAlert() {
  const box = document.getElementById("conflictAlert");
  if (!box) return;
  if (!smartAddState.conflict) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const conflictRecord = smartAddState.conflict;
  const conflict = conflictRecord.event || conflictRecord;
  const occurrence = conflictRecord.occurrence || smartAddState.draft;
  const conflictCount = smartAddState.conflicts?.length || 1;
  const occurrenceCount = draftOccurrences(smartAddState.draft).length;
  box.hidden = false;
  box.innerHTML = `
    <span class="alert-icon">!</span>
    <div>
      <strong>Time Conflict Detected</strong>
      <p>${conflictCount > 1 || occurrenceCount > 1 ? `${conflictCount}/${occurrenceCount} buổi bị trùng. ` : ""}You have a ${escapeHtml(conflict.title)} on ${escapeHtml(formatDate(parseDate(occurrence.date)))} from ${escapeHtml(conflict.start)} – ${escapeHtml(conflict.end)}.</p>
    </div>
    <button id="viewConflict" class="ghost-btn danger" type="button">View Conflict</button>
  `;
}

function renderAlternativeSlot() {
  const box = document.getElementById("alternativeSlot");
  if (!box) return;
  if (!smartAddState.alternative) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const alt = smartAddState.alternative;
  box.hidden = false;
  box.innerHTML = `
    <span class="alt-icon">◷</span>
    <div>
      <strong>Suggestion: ${escapeHtml(formatDisplayTime(alt.start))} instead?</strong>
      <p>${escapeHtml(formatDate(parseDate(alt.date)))} · No conflicts found</p>
    </div>
    <button id="useAlternativeSlot" class="ghost-btn" type="button">Use ${escapeHtml(formatDisplayTime(alt.start))}</button>
  `;
}

function formatDraftDateTime(draft) {
  if (draft.kind === "event_group") {
    const occurrences = draftOccurrences(draft);
    const days = occurrences.map((occurrence) => formatDate(parseDate(occurrence.date))).join(", ");
    const first = occurrences[0] || draft;
    const time = first.start && first.end ? `${first.start} – ${first.end}` : "Missing time";
    return `${days} · ${time}`;
  }
  const date = draft.date ? formatDate(parseDate(draft.date)) : "Missing date";
  const time = draft.start && draft.end ? `${draft.start} – ${draft.end}` : "Missing time";
  return `${date} · ${time}`;
}

function formatOccurrence(occurrence) {
  return `${formatDate(parseDate(occurrence.date))} · ${occurrence.start}–${occurrence.end}`;
}

function formatDisplayTime(time) {
  const [hour, minute] = String(time || "00:00").split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute || 0).padStart(2, "0")} ${suffix}`;
}

function renderAll() {
  setValue("weekStart", state.weekStart);
  ensureCalendarChrome();
  renderWeekRange();
  renderClearDateOptions();
  renderCalendarResizeControl();
  renderSchedule();
  renderMetrics();
  renderHabitSummary();
  renderSmartAdd();
  renderCopilot();
}

function renderCopilot() {
  const messages = document.getElementById("copilotMessages");
  const options = document.getElementById("copilotOptions");
  if (!messages || !options) return;
  const timeline = [];
  const batchesById = new Map(copilotState.optionBatches.map((batch) => [batch.batchId, batch]));
  if (!copilotState.messages.length) {
    timeline.push(`<div class="copilot-message assistant">Bạn có thể hỏi: "Tuần này tôi còn trống lúc nào?" hoặc "Tôi muốn đi xem triển lãm ở Hà Nội tuần này".</div>`);
  }
  copilotState.messages.forEach((message) => {
    timeline.push(`<div class="copilot-message ${message.role}">${escapeHtml(message.content)}</div>`);
    const batch = message.batchId ? batchesById.get(message.batchId) : null;
    if (batch) timeline.push(renderCopilotBatch(batch));
  });
  if (copilotState.status === "loading") {
    timeline.push(`<div class="copilot-message assistant copilot-loading">Đang tìm...</div>`);
  }
  if (copilotState.error) {
    timeline.push(`<div class="copilot-message assistant copilot-error">${escapeHtml(copilotState.error)}</div>`);
  }
  messages.innerHTML = timeline.join("");
  options.innerHTML = "";
  messages.scrollTop = messages.scrollHeight;
}

function renderCopilotBatch(batch) {
  const providerText = Array.isArray(batch.providerReports) && batch.providerReports.length
    ? `<small class="provider-note">${escapeHtml(batch.providerReports.map((report) => report.message || report.provider).filter(Boolean).join(" · "))}</small>`
    : "";
  return `
    <div class="copilot-options" data-copilot-batch="${escapeAttr(batch.batchId)}">
      ${providerText}
      ${(batch.options || []).map((option) => renderCopilotOption(option, globalCopilotOptionIndex(option))).join("")}
    </div>
  `;
}

function renderCopilotOption(option, index) {
  const imageUrl = proxiedImageUrl(option.imageUrl);
  return `
    <article class="copilot-option">
      <div>
        <strong>Option ${index + 1} — ${escapeHtml(option.title)}</strong>
        <p>${escapeHtml(formatCopilotOptionTime(option))}</p>
        ${option.location ? `<p>${escapeHtml(option.location)}</p>` : ""}
        ${imageUrl ? `<img class="copilot-option-image" src="${escapeAttr(imageUrl)}" alt="" loading="lazy">` : ""}
        <small>${escapeHtml(option.reason || option.description || "")}</small>
        ${option.sourceUrl ? `<button class="source-link" type="button" data-source-option="${escapeAttr(option.optionId)}">Nguồn</button>` : ""}
      </div>
      <button class="primary-btn" type="button" data-add-copilot-option="${escapeAttr(option.optionId)}">${option.status === "confirmed" ? "Đã thêm" : "Thêm vào lịch"}</button>
    </article>
  `;
}

function allCopilotOptions() {
  return copilotState.optionBatches.flatMap((batch) => Array.isArray(batch.options) ? batch.options : []);
}

function globalCopilotOptionIndex(option) {
  return allCopilotOptions().findIndex((item) => item.optionId === option.optionId);
}

function findCopilotOption(optionId) {
  return allCopilotOptions().find((item) => item.optionId === optionId);
}

function updateCopilotOption(optionId, updates) {
  copilotState.optionBatches.forEach((batch) => {
    const option = (batch.options || []).find((item) => item.optionId === optionId);
    if (option) Object.assign(option, updates);
  });
}

function openSourceModal(optionId) {
  const option = findCopilotOption(optionId);
  const modal = document.getElementById("sourceModal");
  if (!option || !modal) return;
  copilotState.activeSource = option;
  document.getElementById("sourceProvider").textContent = option.provider ? `Nguồn · ${option.provider}` : "Nguồn";
  document.getElementById("sourceTitle").textContent = option.title || "Nguồn tham khảo";
  document.getElementById("sourceTime").textContent = option.proposedStart ? `Thời gian gợi ý: ${formatCopilotOptionTime(option)}` : "";
  document.getElementById("sourceLocation").textContent = option.location ? `Địa điểm: ${option.location}` : "";
  document.getElementById("sourceDescription").textContent = option.description || "";
  document.getElementById("sourceReason").textContent = option.reason || "";
  const image = document.getElementById("sourceImage");
  const imageUrl = proxiedImageUrl(option.imageUrl);
  image.hidden = !imageUrl;
  image.src = imageUrl || "";
  image.alt = imageUrl ? `Ảnh minh họa cho ${option.title || "nguồn tham khảo"}` : "";
  image.onerror = () => {
    image.hidden = true;
    image.removeAttribute("src");
  };
  const link = document.getElementById("sourceOpenExternal");
  link.href = option.sourceUrl || "#";
  link.dataset.sourceUrl = option.sourceUrl || "";
  link.hidden = !option.sourceUrl;
  modal.hidden = false;
}

function proxiedImageUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^data:/i.test(url) || url.startsWith("/")) return url;
  if (!/^https?:\/\//i.test(url)) return "";
  return `/api/image-proxy?url=${encodeURIComponent(url)}`;
}

function closeSourceModal() {
  const modal = document.getElementById("sourceModal");
  if (modal) modal.hidden = true;
  copilotState.activeSource = null;
}

function formatCopilotOptionTime(option) {
  if (option?.proposedStart && option?.proposedEnd) {
    const startDateTime = new Date(option.proposedStart);
    const endDateTime = new Date(option.proposedEnd);
    if (!Number.isNaN(startDateTime.getTime()) && !Number.isNaN(endDateTime.getTime()) && endDateTime <= startDateTime) {
      const fixedEnd = new Date(startDateTime.getTime() + 60 * 60 * 1000);
      option.proposedEnd = `${toInputDate(fixedEnd)}T${timeFromMinutes(fixedEnd.getHours() * 60 + fixedEnd.getMinutes())}:00+07:00`;
    }
  }
  const start = formatIsoForDisplay(option.proposedStart);
  const endDate = String(option.proposedEnd || "").slice(0, 10);
  const startDate = String(option.proposedStart || "").slice(0, 10);
  const end = endDate && endDate !== startDate ? formatIsoForDisplay(option.proposedEnd) : String(option.proposedEnd || "").slice(11, 16);
  return `${start} – ${end}`;
}

function formatIsoForDisplay(value) {
  const text = String(value || "");
  const date = text.slice(0, 10);
  const time = text.slice(11, 16);
  const parsed = parseDate(date);
  return `${parsed ? formatDate(parsed) : date} ${time}`;
}

function copilotOptionToItem(option) {
  const start = String(option.proposedStart || "");
  const end = String(option.proposedEnd || "");
  const date = start.slice(0, 10);
  const startTime = start.slice(11, 16);
  let endTime = end.slice(11, 16);
  if (!endTime || minutesFromTime(endTime) <= minutesFromTime(startTime || "09:00")) {
    endTime = timeFromMinutes(minutesFromTime(startTime || "09:00") + 90);
  }
  const normalizedType = comparableText(option.type);
  return normalizeItem({
    title: option.title,
    type: "fixed",
    date,
    start: startTime || "09:00",
    end: endTime,
    duration: minutesBetween(startTime || "09:00", endTime),
    priority: "medium",
    notes: [
      "Calendar Copilot pinned",
      normalizedType ? `category: ${normalizedType}` : "",
      option.description || "",
      option.location ? `Địa điểm: ${option.location}` : "",
      option.sourceUrl ? `Nguồn: ${option.sourceUrl}` : "",
      option.imageUrl ? `Ảnh: ${option.imageUrl}` : "",
      option.reason || ""
    ].filter(Boolean).join("\n")
  });
}

function addCopilotOption(optionId, replyText = "") {
  const option = findCopilotOption(optionId);
  if (!option) return false;
  addParsedItems([copilotOptionToItem(option)]);
  updateCopilotOption(optionId, { status: "confirmed" });
  copilotState.messages.push({ role: "assistant", content: replyText || `Đã thêm "${option.title}" vào lịch.` });
  saveCopilotState();
  autoPlanAndRender();
  return true;
}

function tryHandleCopilotConfirmation(message) {
  const commandText = comparableText(message);
  const match = commandText.match(/(?:option|lua chon)\s*(\d+)/i);
  const wantsAdd = /(?:them|cho vao|luu|chot|add)/i.test(commandText) && /(?:lich|calendar|option)/i.test(commandText);
  if (!match || !wantsAdd) return false;
  const option = allCopilotOptions()[Number(match[1]) - 1];
  return option ? addCopilotOption(option.optionId) : false;
}

async function sendCopilotMessage() {
  const input = document.getElementById("copilotInput");
  const message = input?.value.trim();
  if (!message) return;
  copilotState.messages.push({ role: "user", content: message });
  copilotState.error = "";
  input.value = "";
  copilotState.status = "loading";
  saveCopilotState();
  renderCopilot();
  try {
    const response = await fetch("/api/calendar-copilot/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "local-user",
        conversationId: copilotState.conversationId,
        message,
        history: copilotState.messages.slice(-12),
        weekStart: state.weekStart,
        schedule: state.schedule,
        pendingOptions: allCopilotOptions(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Ho_Chi_Minh"
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Copilot failed");
    if (data.confirmOptionId) addCopilotOption(data.confirmOptionId, data.reply || "");
    else {
      const batchId = data.batchId || uid("batch");
      const options = Array.isArray(data.pendingOptions) ? data.pendingOptions : [];
      copilotState.messages.push({ role: "assistant", content: data.reply || "Mình đã tạo vài option tạm.", batchId: options.length ? batchId : "" });
      if (options.length) {
        copilotState.optionBatches.push({
          batchId,
          query: message,
          createdAt: new Date().toISOString(),
          options,
          providerReports: Array.isArray(data.providerReports) ? data.providerReports : []
        });
      }
    }
  } catch (error) {
    copilotState.error = `Chưa gợi ý được: ${error.message}`;
  } finally {
    copilotState.status = "idle";
    saveCopilotState();
  }
  renderCopilot();
}

function ensureCalendarChrome() {
  const panelHead = document.querySelector("#calendar .panel-head .button-row");
  if (!panelHead || document.getElementById("weekRangeDisplay")) return;
  panelHead.insertAdjacentHTML("afterbegin", `
    <button id="prevWeek" class="ghost-btn week-nav-btn" type="button">‹</button>
    <span id="weekRangeDisplay" class="week-range-display"></span>
    <button id="nextWeek" class="ghost-btn week-nav-btn" type="button">›</button>
  `);
  document.getElementById("prevWeek").addEventListener("click", () => shiftWeek(-7));
  document.getElementById("nextWeek").addEventListener("click", () => shiftWeek(7));
}

function renderWeekRange() {
  const element = document.getElementById("weekRangeDisplay");
  if (!element) return;
  const dates = weekDates();
  const formatter = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit" });
  element.textContent = `${formatter.format(dates[0])} - ${formatter.format(dates[6])}`;
}

function renderClearDateOptions() {
  const select = document.getElementById("clearDate");
  if (!select) return;
  const previous = select.value;
  const dates = weekDates();
  const today = toInputDate(new Date());
  const values = dates.map(toInputDate);
  const selected = values.includes(previous)
    ? previous
    : values.includes(today)
      ? today
      : values[0];
  select.innerHTML = dates.map((date, index) => {
    const value = toInputDate(date);
    return `<option value="${value}" ${value === selected ? "selected" : ""}>${DAY_NAMES[index]} · ${formatDate(date)}</option>`;
  }).join("");
}

function shiftWeek(days) {
  const start = parseDate(state.weekStart) || startOfWeek(new Date());
  state.weekStart = toInputDate(addDays(start, days));
  autoPlanAndRender();
}

function getCategory(item) {
  const title = String(item?.title || "").toLowerCase();
  const notes = comparableText(item?.notes || "");
  const categoryMatch = notes.match(/category:\s*([a-z0-9_-]+)/i);
  const category = categoryMatch ? categoryMatch[1] : "";
  if (/health|exercise|gym|pilates|yoga|run/.test(category)) return "health";
  if (/study|focus|learning|workshop/.test(category)) return "study";
  if (/rest|leisure|personal|social|cafe|exhibition/.test(category)) return "leisure";
  if (/work/.test(category)) return "work";
  if (item?.type === "habit" || /pilates|bơi|boi|gym|yoga|workout|chạy|chay|tập|tap|exercise/.test(title)) return "health";
  if (item?.type === "rest" || /relax|nghỉ|nghi|movie|game|leisure|gia đình|gia dinh|cafe|brunch|triển lãm|trien lam|đọc sách|doc sach/.test(title)) return "leisure";
  if (item?.type === "deadline" || /học|hoc|study|bt |bài tập|bai tap|quiz|essay|môn|mon|kiểm tra|kiem tra|thương hiệu|quan hệ|quản trị/.test(title)) return "study";
  return "work";
}

function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META.work;
}

function smartCategoryFromItem(item) {
  const title = comparableText(item.title);
  if (item.type === "habit" || /gym|pilates|yoga|boi|bơi|tap|tập|workout|run|chay|chạy/.test(title)) return "health";
  if (/hoc|học|study|mon|môn|quiz|english|tieng anh|tiếng anh|doc sach|đọc sách/.test(title)) return "learning";
  if (/meeting|client|work|du an|dự án|viec|việc/.test(title)) return "work";
  if (/ban be|bạn bè|family|gia dinh|social|hen|hẹn/.test(title)) return "social";
  if (/relax|cafe|movie|game|nghi|nghỉ/.test(title)) return "personal";
  return "other";
}

function itemTypeFromSmartCategory(category, draft) {
  if (draft.date && draft.start && draft.end) return "fixed";
  if (category === "health") return "habit";
  if (category === "learning") return "task";
  if (category === "personal" || category === "social") return "rest";
  return "task";
}

function smartItemTypeForOccurrence(category, draft, occurrence) {
  if (occurrence?.date && occurrence?.start && occurrence?.end) return "fixed";
  return itemTypeFromSmartCategory(category, draft);
}

function parsedEventFromItem(item, index = 0) {
  const normalized = normalizeItem(item);
  const category = smartCategoryFromItem(normalized);
  const missingFields = Array.isArray(item.missingFields) ? [...item.missingFields] : [];
  if (!normalized.title) missingFields.push("title");
  if (!normalized.date) missingFields.push("date");
  if (!normalized.start || !normalized.end) missingFields.push("time");
  return {
    id: uid("draft"),
    sourceIndex: index,
    kind: "single_event",
    title: normalized.title,
    category,
    date: normalized.date,
    start: normalized.start,
    end: normalized.end,
    duration: normalized.duration,
    confidence: Number(item.confidence || 0.86),
    missingFields: [...new Set(missingFields)],
    notes: normalized.notes || ""
  };
}

function buildSmartSuggestions(items) {
  const drafts = (Array.isArray(items) ? items : [])
    .map(parsedEventFromItem)
    .filter((item) => item.title);
  const groups = new Map();

  drafts.forEach((draft) => {
    const key = [
      comparableText(draft.title),
      draft.category,
      draft.start || "",
      draft.end || "",
      draft.duration || "",
      comparableText(draft.notes || "")
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(draft);
  });

  return [...groups.values()].flatMap((group) => {
    if (group.length <= 1) return group;
    const first = group[0];
    return [{
      ...first,
      id: uid("group"),
      kind: "event_group",
      date: "",
      occurrences: group
        .map((draft, index) => ({
          id: uid("occurrence"),
          sourceIndex: index,
          date: draft.date,
          start: draft.start,
          end: draft.end,
          duration: draft.duration,
          selected: true
        }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
      missingFields: [...new Set(group.flatMap((draft) => draft.missingFields))],
      confidence: group.reduce((sum, draft) => sum + (draft.confidence || 0.8), 0) / group.length
    }];
  });
}

function draftOccurrences(draft) {
  if (!draft) return [];
  if (Array.isArray(draft.occurrences) && draft.occurrences.length) {
    return draft.occurrences.filter((occurrence) => occurrence.selected !== false);
  }
  return [{
    date: draft.date,
    start: draft.start,
    end: draft.end,
    duration: draft.duration,
    selected: true
  }];
}

function draftToCandidate(draft) {
  return {
    id: draft.id || "draft",
    title: draft.title,
    type: itemTypeFromSmartCategory(draft.category, draft),
    date: draft.date,
    start: draft.start,
    end: draft.end,
    duration: draft.duration,
    notes: draft.notes || ""
  };
}

function findConflictForDraft(draft) {
  const occurrences = draftOccurrences(draft);
  for (const occurrence of occurrences) {
    if (!occurrence.date || !occurrence.start || !occurrence.end) continue;
    const candidate = {
      ...draftToCandidate(draft),
      date: occurrence.date,
      start: occurrence.start,
      end: occurrence.end,
      duration: occurrence.duration || draft.duration
    };
    const event = state.schedule.find((calendarEvent) => eventOverlaps(calendarEvent, candidate));
    if (event) return { event, occurrence };
  }
  return null;
}

function findConflictsForDraft(draft) {
  return draftOccurrences(draft).flatMap((occurrence) => {
    if (!occurrence.date || !occurrence.start || !occurrence.end) return [];
    const candidate = {
      ...draftToCandidate(draft),
      date: occurrence.date,
      start: occurrence.start,
      end: occurrence.end,
      duration: occurrence.duration || draft.duration
    };
    const event = state.schedule.find((calendarEvent) => eventOverlaps(calendarEvent, candidate));
    return event ? [{ event, occurrence }] : [];
  });
}

function roundUpToNearestThirty(minutes) {
  return Math.ceil(minutes / 30) * 30;
}

function selectedSmartDrafts() {
  return smartAddState.suggestions.filter((draft) => smartAddState.selectedSuggestionIds.has(draft.id));
}

function syncSmartSelection(defaultAll = false) {
  const ids = new Set(smartAddState.suggestions.map((draft) => draft.id));
  smartAddState.selectedSuggestionIds = new Set([...smartAddState.selectedSuggestionIds].filter((id) => ids.has(id)));
  if (defaultAll || !smartAddState.selectedSuggestionIds.size) {
    smartAddState.selectedSuggestionIds = new Set(smartAddState.suggestions.map((draft) => draft.id));
  }
}

function toggleSmartSuggestion(index, checked) {
  const draft = smartAddState.suggestions[index];
  if (!draft) return;
  if (checked) smartAddState.selectedSuggestionIds.add(draft.id);
  else smartAddState.selectedSuggestionIds.delete(draft.id);
  selectSmartSuggestion(index, { preserveSelection: true });
}

function findAlternativeSlot(draft, conflictRecord) {
  const occurrence = conflictRecord?.occurrence || draft;
  const conflict = conflictRecord?.event || conflictRecord;
  if (!occurrence?.date) return null;
  const duration = Math.max(30, occurrence.duration || draft.duration || minutesBetween(occurrence.start, occurrence.end) || 60);
  const busy = state.schedule
    .filter((event) => event.date === occurrence.date)
    .sort((a, b) => a.start.localeCompare(b.start));
  let start = roundUpToNearestThirty((conflict ? minutesFromTime(conflict.end) : minutesFromTime(occurrence.start)) + 15);
  const latest = CALENDAR_END_MINUTES - duration;
  while (start <= latest) {
    const candidate = {
      date: occurrence.date,
      start: timeFromMinutes(start),
      end: timeFromMinutes(start + duration)
    };
    if (!busy.some((event) => eventOverlaps(event, candidate))) {
      return { occurrenceId: occurrence.id, date: occurrence.date, start: candidate.start, end: candidate.end, duration };
    }
    const nextConflict = busy.find((event) => eventOverlaps(event, candidate));
    start = roundUpToNearestThirty(minutesFromTime(nextConflict.end) + 15);
  }
  return null;
}

function refreshSmartChecks() {
  const draft = smartAddState.draft;
  const selectedDrafts = selectedSmartDrafts();
  smartAddState.missingFields = selectedDrafts.length ? [...new Set(selectedDrafts.flatMap((item) => item.missingFields || []))] : [];
  smartAddState.conflicts = selectedDrafts.length && !smartAddState.missingFields.length
    ? selectedDrafts.flatMap((item) => findConflictsForDraft(item).map((conflict) => ({ ...conflict, draft: item })))
    : [];
  smartAddState.conflict = smartAddState.conflicts[0] || null;
  smartAddState.alternative = smartAddState.conflict ? findAlternativeSlot(smartAddState.conflict.draft || draft, smartAddState.conflict) : null;
}

function selectSmartSuggestion(index, options = {}) {
  const draft = smartAddState.suggestions[index];
  if (!draft) return;
  smartAddState.selectedIndex = index;
  smartAddState.draft = { ...draft };
  smartAddState.selectedCategory = draft.category;
  const success = document.getElementById("smartSuccess");
  if (success) success.hidden = true;
  refreshSmartChecks();
  renderSmartAdd();
}

function applyAlternativeSlot() {
  if (!smartAddState.alternative) return;
  const targetDraft = smartAddState.conflict?.draft || smartAddState.draft;
  if (!targetDraft) return;
  if (targetDraft.kind === "event_group" && Array.isArray(targetDraft.occurrences)) {
    const target = targetDraft.occurrences.find((occurrence) => occurrence.id === smartAddState.alternative.occurrenceId)
      || targetDraft.occurrences.find((occurrence) => occurrence.date === smartAddState.alternative.date);
    if (target) Object.assign(target, smartAddState.alternative);
  } else {
    Object.assign(targetDraft, smartAddState.alternative);
  }
  targetDraft.missingFields = [];
  refreshSmartChecks();
  renderSmartAdd();
}

function createItemsFromDraft(draft) {
  return draftOccurrences(draft).map((occurrence) => normalizeItem({
    title: draft.title,
    type: smartItemTypeForOccurrence(draft.category || smartAddState.selectedCategory, draft, occurrence),
    date: occurrence.date,
    start: occurrence.start,
    end: occurrence.end,
    duration: occurrence.duration || draft.duration || minutesBetween(occurrence.start, occurrence.end),
    priority: "medium",
    frequency: 1,
    notes: [
      draft.kind === "event_group" ? `Group: ${draftOccurrences(draft).length} buổi` : "",
      draft.notes || `Category: ${smartAddState.selectedCategory}`
    ].filter(Boolean).join(" · ")
  }));
}

function addSmartEvent(options = {}) {
  const drafts = selectedSmartDrafts();
  if (!drafts.length) return;
  refreshSmartChecks();
  if (smartAddState.missingFields.length) {
    renderSmartAdd();
    return;
  }
  if (smartAddState.conflict && !options.addAnyway) {
    openConfirmConflictModal();
    return;
  }
  const items = drafts.flatMap(createItemsFromDraft);
  const result = addParsedItems(items);
  setValue("naturalInput", "");
  smartAddState.input = "";
  smartAddState.suggestions = [];
  smartAddState.selectedSuggestionIds = new Set();
  smartAddState.draft = null;
  smartAddState.conflict = null;
  smartAddState.conflicts = [];
  smartAddState.alternative = null;
  smartAddState.missingFields = [];
  document.getElementById("smartSuccess").hidden = false;
  document.getElementById("smartSuccess").textContent = result.updated
    ? `Đã cập nhật ${result.updated} event trong calendar.`
    : `Đã thêm ${result.added} event vào calendar.`;
  autoPlanAndRender();
}

function openConfirmConflictModal() {
  const modal = document.getElementById("confirmConflictModal");
  if (!modal) return;
  const conflictRecord = smartAddState.conflict;
  const conflict = conflictRecord?.event || conflictRecord;
  const occurrence = conflictRecord?.occurrence || smartAddState.draft;
  const conflictCount = smartAddState.conflicts?.length || (conflict ? 1 : 0);
  document.getElementById("confirmConflictText").textContent = conflict
    ? `${conflictCount > 1 ? `${conflictCount} buổi đang bị trùng. ` : ""}Event đang trùng với "${conflict.title}" ngày ${formatDate(parseDate(occurrence.date))} từ ${conflict.start} – ${conflict.end}.`
    : "Event này đang bị trùng lịch.";
  modal.hidden = false;
}

function closeConfirmConflictModal() {
  const modal = document.getElementById("confirmConflictModal");
  if (modal) modal.hidden = true;
}

function renderPlannerPanels() {
  renderWeeklyFocus();
  renderCategoryProgress();
  renderAiInsights();
  renderReschedulePanel();
}

function renderWeeklyFocus() {
  const box = document.getElementById("weeklyFocusList");
  if (!box) return;
  const goals = state.items
    .filter((item) => item.type === "deadline" || item.priority === "high")
    .slice(0, 5);
  box.innerHTML = goals.length ? goals.map((item) => {
    const category = categoryMeta(getCategory(item));
    return `<div class="focus-item"><span>${category.icon}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.date || "Linh hoạt")}</small></div></div>`;
  }).join("") : `<div class="empty">Chưa có mục tiêu chính trong tuần.</div>`;
}

function renderCategoryProgress() {
  const box = document.getElementById("categoryProgress");
  if (!box) return;
  const totals = { work: 0, study: 0, leisure: 0, health: 0 };
  state.schedule.forEach((event) => {
    totals[getCategory(event)] += Number(event.duration || 0);
  });
  const total = Object.values(totals).reduce((sum, minutes) => sum + minutes, 0) || 1;
  box.innerHTML = Object.entries(CATEGORY_META).map(([key, meta]) => {
    const minutes = totals[key];
    const percent = Math.round((minutes / total) * 100);
    return `
      <div class="progress-row ${meta.className}">
        <div><span>${meta.icon}</span><strong>${meta.label}</strong><em>${percent}%</em></div>
        <div class="progress-track"><i style="width:${percent}%"></i></div>
        <small>${Math.round(minutes / 60 * 10) / 10}h</small>
      </div>
    `;
  }).join("");
}

function renderAiInsights() {
  const box = document.getElementById("aiInsights");
  if (!box) return;
  const studyMinutes = state.schedule.filter((event) => getCategory(event) === "study").reduce((sum, event) => sum + event.duration, 0);
  const healthCount = state.schedule.filter((event) => getCategory(event) === "health").length;
  const restCount = state.schedule.filter((event) => getCategory(event) === "leisure").length;
  const next = nextUpcomingEvent();
  const insights = [];
  if (next) {
    const meta = categoryMeta(getCategory(next));
    insights.push({
      tone: "next",
      icon: meta.icon,
      title: "Next up",
      body: `${next.title} · ${formatDate(parseDate(next.date))} ${next.start}-${next.end}`
    });
  }
  if (state.warnings.length) insights.push({ tone: "danger", icon: "!", title: "Conflict check", body: "Có xung đột hoặc ngày quá tải. Xem phần tối ưu để biết đề xuất." });
  if (studyMinutes >= 360) insights.push({ tone: "study", icon: "B", title: "Focus balance", body: "Tuần này có nhiều khối học/deadline. Nên giữ các khoảng nghỉ ngắn sau block dài." });
  if (healthCount < 3) insights.push({ tone: "health", icon: "+", title: "Health goal", body: "Mục tiêu tập luyện là 3-4 buổi/tuần. Tuần này đang dưới mức đó." });
  if (restCount < 3) insights.push({ tone: "leisure", icon: "~", title: "Recovery", body: "Nên giữ vài khoảng leisure/rest để cân bằng năng lượng." });
  if (!insights.length) insights.push({ tone: "ok", icon: "✓", title: "Balanced week", body: "Lịch đang cân bằng giữa deadline, học tập, nghỉ ngơi và tập luyện." });
  box.innerHTML = insights.slice(0, 4).map((item) => `
    <div class="insight-card insight-${item.tone}">
      <span class="insight-icon">${escapeHtml(item.icon)}</span>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${escapeHtml(item.body)}</p>
      </div>
    </div>
  `).join("");
}

function nextUpcomingEvent() {
  const now = new Date();
  return [...state.schedule]
    .filter((event) => event.date && event.start)
    .sort((a, b) => new Date(`${a.date}T${a.start}`) - new Date(`${b.date}T${b.start}`))
    .find((event) => new Date(`${event.date}T${event.start}`) >= now)
    || [...state.schedule].sort((a, b) => `${a.date}T${a.start}`.localeCompare(`${b.date}T${b.start}`))[0];
}

function renderReschedulePanel() {
  const box = document.getElementById("reschedulePanel");
  if (!box) return;
  const changes = state.optimizations || [];
  if (!changes.length) {
    box.innerHTML = "";
    return;
  }
  const rows = changes.slice(0, 4);
  box.innerHTML = `
    <div class="reschedule-head"><strong>AI Rescheduling</strong><span>${changes.length || state.warnings.length} thay đổi/cảnh báo</span></div>
    <div class="reschedule-grid">
      <div><h4>Trước</h4>${rows.map((row) => `<p>${escapeHtml(row.title)}<br><small>${escapeHtml(row.before)}</small></p>`).join("")}</div>
      <div><h4>Sau tối ưu</h4>${rows.map((row) => `<p>${escapeHtml(row.title)}<br><small>${escapeHtml(row.after)}</small></p>`).join("")}</div>
    </div>
  `;
}

function renderSchedule() {
  const grid = document.getElementById("scheduleGrid");
  const warnings = document.getElementById("warnings");
  if (!grid || !warnings) return;
  const dedupedSchedule = dedupeScheduleEvents(state.schedule.filter((event) => !isAutoRestEvent(event)));
  if (dedupedSchedule.length !== state.schedule.length) {
    state.schedule = dedupedSchedule;
    saveState();
  }
  const dates = weekDates();
  const weekEvents = state.schedule.filter((event) => dateInCurrentWeek(event.date));
  const displayRange = calendarDisplayRange(weekEvents);
  const invalidWarnings = invalidCalendarEventWarnings(weekEvents);
  warnings.innerHTML = [
    ...state.warnings,
    ...invalidWarnings
  ].filter(Boolean).map((warning) => `<div class="warning">${escapeHtml(warning)}</div>`).join("");
  const pixelsPerMinute = calendarPixelsPerMinute();
  const timeAxis = calendarTimeAxis(displayRange, pixelsPerMinute);
  const bodyHeight = (displayRange.end - displayRange.start) * pixelsPerMinute;
  const hourHeight = 120 * pixelsPerMinute;
  grid.innerHTML = `
    <div class="time-axis" aria-hidden="true">
      <div class="day-head spacer"></div>
      <div class="time-body" style="height:${bodyHeight}px;--hour-height:${hourHeight}px">
        ${timeAxis.map((tick) => `<span style="top:${tick.top}px">${tick.label}</span>`).join("")}
      </div>
    </div>
    ${dates.map((date, index) => {
    const dateString = toInputDate(date);
    const events = layoutDayEvents(state.schedule.filter((event) => event.date === dateString));
    return `
      <div class="day-column">
        <div class="day-head">
          <strong>${DAY_NAMES[index]}</strong>
          <span>${formatDate(date)}</span>
        </div>
        <div class="day-body" style="height:${bodyHeight}px;--hour-height:${hourHeight}px">
          ${renderCalendarGridLines(timeAxis)}
          ${events.length ? events.map(({ event, layout }) => renderEvent(event, layout, displayRange, bodyHeight, pixelsPerMinute)).join("") : ""}
        </div>
      </div>
    `;
  }).join("")}
  `;
}

function calendarPixelsPerMinute() {
  state.settings = state.settings || {};
  state.settings.calendarPixelsPerMinute = normalizeCalendarPixelsPerMinute(state.settings.calendarPixelsPerMinute);
  return state.settings.calendarPixelsPerMinute;
}

function renderCalendarResizeControl() {
  const control = document.getElementById("calendarHeight");
  const label = document.getElementById("calendarHeightValue");
  if (!control) return;
  const value = calendarPixelsPerMinute();
  control.value = String(Math.round(value * 100));
  if (label) label.textContent = `${Math.round(value * 100)}%`;
}

function calendarDisplayRange(events) {
  let start = CALENDAR_START_MINUTES;
  let end = CALENDAR_END_MINUTES;
  events.forEach((event) => {
    const eventStart = minutesFromTime(event.start);
    const eventEnd = minutesFromTime(event.end);
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) return;
    start = Math.min(start, Math.floor(eventStart / 60) * 60);
    end = Math.max(end, Math.ceil(eventEnd / 60) * 60);
  });
  return {
    start: Math.max(0, Math.min(CALENDAR_START_MINUTES, start)),
    end: Math.min(CALENDAR_MAX_END_MINUTES, Math.max(CALENDAR_END_MINUTES, end))
  };
}

function calendarTimeAxis(range, pixelsPerMinute = CALENDAR_PIXELS_PER_MINUTE) {
  const ticks = [];
  for (let minute = range.start; minute <= range.end; minute += 120) {
    ticks.push({
      label: formatAxisTime(minute),
      top: (minute - range.start) * pixelsPerMinute
    });
  }
  if (ticks[ticks.length - 1]?.top < (range.end - range.start) * pixelsPerMinute) {
    ticks.push({
      label: formatAxisTime(range.end),
      top: (range.end - range.start) * pixelsPerMinute
    });
  }
  return ticks;
}

function renderCalendarGridLines(timeAxis) {
  return `
    <div class="calendar-grid-lines" aria-hidden="true">
      ${timeAxis.map((tick) => `<span style="top:${tick.top}px"></span>`).join("")}
    </div>
  `;
}

function formatAxisTime(minutes) {
  if (minutes >= 24 * 60) return "12 AM";
  const hour = Math.floor(minutes / 60);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour} ${suffix}`;
}

function invalidCalendarEventWarnings(events) {
  const invalid = events.filter((event) => {
    if (isSleepLikeEvent(event)) return false;
    const start = minutesFromTime(event.start);
    const end = minutesFromTime(event.end);
    return !Number.isFinite(start) || !Number.isFinite(end) || end <= start;
  });
  return invalid.slice(0, 3).map((event) => `Bỏ qua lịch "${event.title || "không tên"}" vì giờ kết thúc không hợp lệ.`);
}

function isSleepLikeEvent(event) {
  const text = comparableText([event?.title, event?.notes, event?.type].filter(Boolean).join(" "));
  return /di ngu|ngu|sleep|bedtime|wind down/.test(text);
}

function layoutDayEvents(events) {
  const sorted = sortEvents(events).filter((event) => {
    const start = minutesFromTime(event.start);
    const end = minutesFromTime(event.end);
    return Number.isFinite(start) && Number.isFinite(end) && end > start;
  });
  const groups = [];

  sorted.forEach((event) => {
    const start = minutesFromTime(event.start);
    const end = minutesFromTime(event.end);
    let group = groups.find((candidate) => candidate.end > start);
    if (!group) {
      group = { end, items: [] };
      groups.push(group);
    }
    group.end = Math.max(group.end, end);
    group.items.push(event);
  });

  return groups.flatMap((group) => {
    const lanes = [];
    const items = group.items.map((event) => {
      const start = minutesFromTime(event.start);
      const end = minutesFromTime(event.end);
      let lane = lanes.findIndex((laneEnd) => laneEnd <= start);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(end);
      } else {
        lanes[lane] = end;
      }
      return { event, lane };
    });
    const laneCount = Math.min(2, Math.max(1, lanes.length));
    return items.map((item) => ({
      event: item.event,
      layout: { lane: item.lane % laneCount, laneCount }
    }));
  });
}

function renderEvent(event, layout = { lane: 0, laneCount: 1 }, displayRange = { start: CALENDAR_START_MINUTES, end: CALENDAR_END_MINUTES }, bodyHeight = 0, pixelsPerMinute = CALENDAR_PIXELS_PER_MINUTE) {
  const category = categoryMeta(getCategory(event));
  const rawStart = minutesFromTime(event.start);
  const rawEnd = minutesFromTime(event.end);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) return "";
  const start = Math.max(displayRange.start, rawStart);
  const end = Math.min(displayRange.end, rawEnd);
  if (end <= start) return "";
  const top = Math.max(0, (start - displayRange.start) * pixelsPerMinute);
  const availableHeight = Math.max(24, (bodyHeight || ((displayRange.end - displayRange.start) * pixelsPerMinute)) - top - 4);
  const naturalHeight = Math.max(46, (end - start) * pixelsPerMinute - 4);
  const height = Math.min(naturalHeight, availableHeight);
  const laneGap = 4;
  const laneWidth = 100 / layout.laneCount;
  const width = `calc(${laneWidth}% - ${layout.laneCount > 1 ? laneGap : 0}px)`;
  const left = `${layout.lane * laneWidth}%`;
  return `
    <article class="event-card ${event.type} category-${category.className} ${event.completed ? "completed" : ""}"
      data-event-id="${event.id}"
      style="top:${top}px;height:${height}px;left:${left};width:${width};">
      <label class="done-check" title="Đánh dấu xong" onclick="event.stopPropagation()">
        <input data-event-completed="${event.id}" type="checkbox" ${event.completed ? "checked" : ""}>
      </label>
      <strong>${escapeHtml(event.title)}</strong>
      <span>${escapeHtml(event.start)}-${escapeHtml(event.end)}</span>
    </article>
  `;
}

function renderMetrics() {
  const visibleEvents = state.schedule.filter((event) => dateInCurrentWeek(event.date));
  const fixed = visibleEvents.filter((event) => event.type === "fixed").length;
  const deadline = visibleEvents.filter((event) => event.type === "deadline").length;
  const habit = visibleEvents.filter((event) => {
    const category = getCategory(event);
    return event.type === "habit" || event.type === "rest" || category === "health" || category === "leisure";
  }).length;
  const totalMinutes = visibleEvents.reduce((sum, event) => sum + Number(event.duration || 0), 0);
  const loadScore = Math.min(100, Math.round((totalMinutes / (7 * 9 * 60)) * 100));
  document.getElementById("fixedCount").textContent = fixed;
  document.getElementById("deadlineCount").textContent = deadline;
  document.getElementById("habitCount").textContent = habit;
  document.getElementById("loadScore").textContent = `${loadScore}%`;
}

function renderHabitSummary() {
  const box = document.getElementById("habitSummary");
  if (!box) return;
  const visibleEvents = state.schedule.filter((event) => dateInCurrentWeek(event.date));
  const habitEvents = visibleEvents.filter((event) => getCategory(event) === "health");
  const restEvents = visibleEvents.filter((event) => getCategory(event) === "leisure");
  const focusEvents = visibleEvents.filter((event) => ["study", "work"].includes(getCategory(event)));
  const habitMinutes = habitEvents.reduce((sum, event) => sum + Number(event.duration || 0), 0);
  const restMinutes = restEvents.reduce((sum, event) => sum + Number(event.duration || 0), 0);
  const heavyDays = weekDates().filter((date) => {
    const dateString = toInputDate(date);
    const minutes = visibleEvents
      .filter((event) => event.date === dateString && ["study", "work"].includes(getCategory(event)))
      .reduce((sum, event) => sum + Number(event.duration || 0), 0);
    return minutes > 300;
  });
  const balanceHint = habitEvents.length || restEvents.length
    ? `Tuần này có ${Math.round((habitMinutes + restMinutes) / 60 * 10) / 10}h cho sức khỏe/phục hồi.`
    : focusEvents.length
      ? "Tuần này chưa có block sức khỏe/phục hồi rõ ràng."
      : "Chưa có dữ liệu lịch trong tuần này.";
  box.innerHTML = `
    <div class="summary-card"><strong>Tập luyện / sức khỏe</strong><p>${habitEvents.length} block, ${Math.round(habitMinutes / 60 * 10) / 10}h trong tuần.</p></div>
    <div class="summary-card"><strong>Nghỉ và phục hồi</strong><p>${restEvents.length} block, ${Math.round(restMinutes / 60 * 10) / 10}h relax/nghỉ nhẹ.</p></div>
    <div class="summary-card"><strong>Cân bằng tuần</strong><p>${heavyDays.length ? `Ngày nặng: ${heavyDays.map(formatDate).join(", ")}.` : balanceHint}</p></div>
  `;
}

function priorityLabel(priority) {
  return priority === "high" ? "Cao" : priority === "low" ? "Thấp" : "Vừa";
}

function updateScheduleEvent(target) {
  const card = target.closest("[data-event-id]");
  if (!card) return;
  const event = state.schedule.find((item) => item.id === card.dataset.eventId);
  if (!event) return;
  const field = target.dataset.eventField;
  event[field] = target.value;
  if (field === "start" || field === "end") event.duration = minutesBetween(event.start, event.end);
  saveState();
  renderMetrics();
  renderHabitSummary();
}

function toggleEventCompleted(id, completed) {
  const event = state.schedule.find((item) => item.id === id);
  if (!event) return;
  event.completed = completed;
  rememberEventCompleted(event, completed);
  saveState();
  renderMetrics();
  renderHabitSummary();
}

function deleteEvent(id) {
  const event = state.schedule.find((item) => item.id === id);
  if (event) rememberEventCompleted(event, false);
  state.schedule = state.schedule.filter((event) => event.id !== id);
  saveState();
  renderAll();
}

function openEventModal(id) {
  const modal = document.getElementById("eventModal");
  const event = state.schedule.find((item) => item.id === id);
  if (!modal || !event) return;
  modal.dataset.eventId = id;
  const category = categoryMeta(getCategory(event));
  document.getElementById("modalCategory").textContent = `${category.label} · ${event.start}-${event.end}`;
  document.getElementById("modalTitle").textContent = event.title;
  setValue("modalEventTitle", event.title);
  setValue("modalEventDate", event.date);
  setValue("modalEventStart", event.start);
  setValue("modalEventEnd", event.end);
  setValue("modalEventNotes", event.notes || "");
  document.getElementById("modalEventCompleted").checked = Boolean(event.completed);
  modal.hidden = false;
}

function closeEventModal() {
  const modal = document.getElementById("eventModal");
  if (!modal) return;
  modal.hidden = true;
  modal.dataset.eventId = "";
}

function saveEventModal() {
  const modal = document.getElementById("eventModal");
  if (!modal?.dataset.eventId) return;
  const event = state.schedule.find((item) => item.id === modal.dataset.eventId);
  if (!event) return;
  const wasCompleted = Boolean(event.completed);
  const previousCompletionKeys = eventCompletionKeys(event);
  event.title = value("modalEventTitle").trim() || event.title;
  event.date = value("modalEventDate") || event.date;
  event.start = normalizeTimeInput(value("modalEventStart"), event.start);
  event.end = normalizeTimeInput(value("modalEventEnd"), event.end);
  if (minutesFromTime(event.end) <= minutesFromTime(event.start)) {
    event.end = timeFromMinutes(minutesFromTime(event.start) + Math.max(30, event.duration || 60));
  }
  event.duration = minutesBetween(event.start, event.end);
  event.notes = value("modalEventNotes");
  event.completed = document.getElementById("modalEventCompleted").checked;
  if (wasCompleted) previousCompletionKeys.forEach((key) => delete state.completedEvents[key]);
  rememberEventCompleted(event, event.completed);
  saveState();
  closeEventModal();
  renderAll();
}

function deleteEventFromModal() {
  const modal = document.getElementById("eventModal");
  if (!modal?.dataset.eventId) return;
  const id = modal.dataset.eventId;
  closeEventModal();
  deleteEvent(id);
}

function downloadIcs() {
  if (!state.schedule.length) return;
  const ics = buildIcs(state.schedule);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `personal-plan-${state.weekStart}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildIcs(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Personal Planner V1//VI",
    "CALSCALE:GREGORIAN"
  ];
  events.forEach((event) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@personal-planner-v1`,
      `DTSTAMP:${icsDateTime(new Date())}`,
      `DTSTART:${icsLocalDateTime(event.date, event.start)}`,
      `DTEND:${icsLocalDateTime(event.date, event.end)}`,
      `SUMMARY:${icsEscape(event.title)}`,
      `DESCRIPTION:${icsEscape(`${TYPE_LABELS[event.type] || event.type}${event.completed ? "\\nStatus: done" : ""}${event.notes ? `\\n${event.notes}` : ""}`)}`,
      `CATEGORIES:${icsEscape(event.completed ? "Done" : TYPE_LABELS[event.type] || event.type)}`,
      "STATUS:CONFIRMED",
      "END:VEVENT"
    );
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function icsLocalDateTime(date, time) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function icsDateTime(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function icsEscape(value) {
  return String(value || "").replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
}

function loadSample() {
  const dates = weekDates();
  state.items = [
    normalizeItem({ title: "Lớp học A", type: "fixed", date: toInputDate(dates[0]), start: "08:00", end: "10:00", duration: 120, priority: "high" }),
    normalizeItem({ title: "Seminar nhóm", type: "fixed", date: toInputDate(dates[2]), start: "14:00", end: "16:00", duration: 120, priority: "medium" }),
    normalizeItem({ title: "Essay môn A", type: "deadline", date: toInputDate(dates[4]), duration: 300, priority: "high", notes: "Cần chia thành nhiều block trước hạn." }),
    normalizeItem({ title: "Bài tập thống kê", type: "deadline", date: toInputDate(dates[3]), duration: 180, priority: "high" }),
    normalizeItem({ title: "Ôn quiz", type: "task", duration: 150, priority: "medium" }),
    normalizeItem({ title: "Bơi", type: "habit", duration: 60, frequency: 2, priority: "medium" }),
    normalizeItem({ title: "Pilates", type: "habit", duration: 60, frequency: 1, priority: "medium" }),
    normalizeItem({ title: "Relax / cafe không deadline", type: "rest", duration: 75, frequency: 1, priority: "low" })
  ];
  state.schedule = [];
  state.warnings = [];
  autoPlanAndRender();
}

function clearPlannerScope(scope) {
  const dates = weekDates().map(toInputDate);
  const targetDate = value("clearDate") || state.weekStart;
  const dateSet = scope === "day" ? new Set([targetDate]) : new Set(dates);
  const label = scope === "day" ? `ngày ${targetDate}` : `tuần ${dates[0]} - ${dates[6]}`;
  if (!confirm(`Xóa dữ liệu trong ${label}? Các tuần/ngày khác vẫn được giữ.`)) return;

  const sourceIds = new Set(
    state.schedule
      .filter((event) => dateSet.has(event.date))
      .map((event) => event.sourceId)
      .filter(Boolean)
  );

  state.items = state.items.filter((item) => {
    const itemDate = item.date || "";
    if (sourceIds.has(item.id)) return false;
    if (itemDate && dateSet.has(itemDate)) return false;
    if (scope === "week" && !itemDate && itemRelevantToWeek(item)) return false;
    return true;
  });
  state.schedule = state.schedule.filter((event) => !dateSet.has(event.date));
  state.warnings = [];
  state.optimizations = [];
  saveState();
  renderAll();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

document.getElementById("weekStart").addEventListener("change", (event) => {
  state.weekStart = event.target.value || state.weekStart;
  autoPlanAndRender();
});
document.getElementById("scheduleGrid").addEventListener("change", (event) => {
  if (event.target.matches("[data-event-completed]")) {
    toggleEventCompleted(event.target.dataset.eventCompleted, event.target.checked);
    renderSchedule();
  }
});
document.getElementById("scheduleGrid").addEventListener("click", (event) => {
  if (event.target.closest("[data-event-completed]")) return;
  const card = event.target.closest("[data-event-id]");
  if (card) openEventModal(card.dataset.eventId);
});
document.getElementById("calendarHeight")?.addEventListener("input", (event) => {
  state.settings = state.settings || {};
  state.settings.calendarPixelsPerMinute = normalizeCalendarPixelsPerMinute(Number(event.target.value) / 100);
  saveState();
  renderCalendarResizeControl();
  renderSchedule();
});
document.getElementById("planWeek").addEventListener("click", planWeek);
document.getElementById("downloadIcs").addEventListener("click", downloadIcs);
document.getElementById("parseWithAi").addEventListener("click", parseWithAi);
document.getElementById("naturalInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  parseWithAi();
});
document.getElementById("clearSmartInput").addEventListener("click", () => {
  setValue("naturalInput", "");
  smartAddState.suggestions = [];
  smartAddState.selectedSuggestionIds = new Set();
  smartAddState.draft = null;
  smartAddState.conflict = null;
  smartAddState.conflicts = [];
  smartAddState.alternative = null;
  smartAddState.missingFields = [];
  const success = document.getElementById("smartSuccess");
  if (success) success.hidden = true;
  setAiState("Sẵn sàng");
  renderSmartAdd();
});
document.getElementById("smartSuggestions").addEventListener("click", (event) => {
  const target = event.target.closest("[data-smart-suggestion]");
  if (target) selectSmartSuggestion(Number(target.dataset.smartSuggestion));
});
document.getElementById("smartSuggestions").addEventListener("change", (event) => {
  const toggle = event.target.closest("[data-smart-toggle]");
  if (toggle) toggleSmartSuggestion(Number(toggle.dataset.smartToggle), toggle.checked);
});
document.getElementById("categorySelector").addEventListener("click", (event) => {
  const target = event.target.closest("[data-smart-category]");
  if (!target || !smartAddState.draft) return;
  smartAddState.selectedCategory = target.dataset.smartCategory;
  smartAddState.draft.category = smartAddState.selectedCategory;
  const sourceDraft = smartAddState.suggestions[smartAddState.selectedIndex];
  if (sourceDraft) sourceDraft.category = smartAddState.selectedCategory;
  refreshSmartChecks();
  renderSmartAdd();
});
document.getElementById("alternativeSlot").addEventListener("click", (event) => {
  if (event.target.closest("#useAlternativeSlot")) applyAlternativeSlot();
});
document.getElementById("conflictAlert").addEventListener("click", (event) => {
  if (!event.target.closest("#viewConflict") || !smartAddState.conflict) return;
  location.hash = "calendar";
  openEventModal((smartAddState.conflict.event || smartAddState.conflict).id);
});
document.getElementById("addSmartEvent").addEventListener("click", () => addSmartEvent());
document.getElementById("parseLocally")?.addEventListener("click", () => {
  const items = parseNaturalLocal(value("naturalInput"));
  const result = addParsedItems(items);
  setAiState(result.updated ? `Đã thêm ${result.added}, cập nhật ${result.updated} mục trùng` : `Đã thêm ${result.added} mục`);
  autoPlanAndRender();
});
document.getElementById("loadSample").addEventListener("click", loadSample);
document.getElementById("clearDay").addEventListener("click", () => clearPlannerScope("day"));
document.getElementById("clearWeek").addEventListener("click", () => clearPlannerScope("week"));
document.getElementById("saveModalEvent").addEventListener("click", saveEventModal);
document.getElementById("deleteModalEvent").addEventListener("click", deleteEventFromModal);
document.getElementById("eventModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-event-modal]")) closeEventModal();
});
document.getElementById("confirmConflictModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-conflict-modal]")) closeConfirmConflictModal();
});
document.getElementById("cancelConflictAdd").addEventListener("click", closeConfirmConflictModal);
document.getElementById("addAnyway").addEventListener("click", () => {
  closeConfirmConflictModal();
  addSmartEvent({ addAnyway: true });
});
document.getElementById("useSuggestedFromModal").addEventListener("click", () => {
  closeConfirmConflictModal();
  applyAlternativeSlot();
});
document.getElementById("sendCopilot").addEventListener("click", sendCopilotMessage);
document.getElementById("copilotInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  sendCopilotMessage();
});
document.getElementById("copilotOptions").addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-copilot-option]");
  if (button) addCopilotOption(button.dataset.addCopilotOption);
});
document.getElementById("copilotMessages").addEventListener("click", (event) => {
  const sourceButton = event.target.closest("[data-source-option]");
  if (sourceButton) openSourceModal(sourceButton.dataset.sourceOption);
  const addButton = event.target.closest("[data-add-copilot-option]");
  if (addButton) addCopilotOption(addButton.dataset.addCopilotOption);
});
document.getElementById("copilotMessages").addEventListener("error", (event) => {
  if (event.target.matches(".copilot-option-image")) event.target.hidden = true;
}, true);
document.getElementById("sourceModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-source-modal]")) closeSourceModal();
});
document.getElementById("syncLogin")?.addEventListener("click", () => handleSyncLogin("login"));
document.getElementById("syncSignup")?.addEventListener("click", () => handleSyncLogin("signup"));
document.getElementById("syncNow")?.addEventListener("click", () => syncRemoteState("push"));
document.getElementById("syncLogout")?.addEventListener("click", () => clearAuthSession("Đã đăng xuất. Dữ liệu vẫn còn trên thiết bị này."));
document.getElementById("syncPassword")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  handleSyncLogin("login");
});

if (state.items.length && (!state.schedule.length || !scheduleCoversCurrentItems())) {
  planWeek();
} else {
  renderAll();
}
initSync();
