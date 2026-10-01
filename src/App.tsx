import {
  ArrowLeft,
  Check,
  ClipboardList,
  Download,
  Loader2,
  LogIn,
  Plus,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CourseInputPlace, GroupAction, GroupRecord, LearningEvent, EventInput } from "./types";
import { APP_NAME, STATUS_LABELS } from "./lib/constants";
import {
  applyGroupAction,
  createClientActionId,
  createEmptyCourseInputPlace,
  createInitialGroup,
  createCourse,
  formatTime,
  getCurrentPlaceName,
  getEditablePlacesFromCourse,
  getGroupId,
  getNextAction,
  getNextPlaceName,
} from "./lib/groupLogic";
import { getEventStore, getGroupStore, watchEvent, watchGroup, watchGroups } from "./lib/groupStore";
import { eventStorageKey, numbers, validGroup, validateEventInput } from "./lib/eventLogic";
import { LocationSharing } from "./components/LocationSharing";
import { TeacherLocationMap } from "./components/TeacherLocationMap";
import { TeacherGate } from "./components/TeacherGate";

interface StudentSession {
  eventId: string;
  classNo: number;
  groupNo: number;
  leaderName: string;
}

const EVENT_ID = new URLSearchParams(window.location.search).get("event");
const SESSION_KEY = eventStorageKey(EVENT_ID ?? "none", "student-session");
const LAST_STUDENT_KEY = eventStorageKey(EVENT_ID ?? "none", "last-student");

function pendingKey(groupId: string) {
  return eventStorageKey(EVENT_ID ?? "none", `pending-${groupId}`);
}

function readStudentSession(): StudentSession | null {
  const raw = localStorage.getItem(SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as StudentSession;
  } catch {
    return null;
  }
}

function saveStudentSession(session: StudentSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(LAST_STUDENT_KEY, JSON.stringify(session));
}

function readLastStudent(): StudentSession {
  const raw = localStorage.getItem(LAST_STUDENT_KEY);

  if (!raw) {
    return {
      eventId: EVENT_ID ?? "",
      classNo: 1,
      groupNo: 1,
      leaderName: "",
    };
  }

  try {
    return JSON.parse(raw) as StudentSession;
  } catch {
    return {
      eventId: EVENT_ID ?? "",
      classNo: 1,
      groupNo: 1,
      leaderName: "",
    };
  }
}

function readPendingActions(groupId: string): GroupAction[] {
  const raw = localStorage.getItem(pendingKey(groupId));

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as GroupAction[];
  } catch {
    return [];
  }
}

function writePendingActions(groupId: string, actions: GroupAction[]) {
  localStorage.setItem(pendingKey(groupId), JSON.stringify(actions));
}

function clearPendingActions(groupId: string) {
  localStorage.removeItem(pendingKey(groupId));
}

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getPlaceLabel(place: { name: string; scheduledTime?: string | null }) {
  return place.scheduledTime ? `${place.scheduledTime} ${place.name}` : place.name;
}

function CoursePreview({ group, compact = false }: { group: GroupRecord; compact?: boolean }) {
  return (
    <ol className={classNames("admin-course-list", compact && "compact")}>
      {group.course.map((place, index) => (
        <li
          key={place.placeId}
          className={classNames(index < group.currentIndex && "past", index === group.currentIndex && "active")}
        >
          {getPlaceLabel(place)}
        </li>
      ))}
    </ol>
  );
}

function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");

  return (
    <div className="app-shell">
      {isAdmin ? <TeacherGate><AdminHome /></TeacherGate> : <StudentEntry />}
    </div>
  );
}

function ModeBanner({ mode }: { mode: "firebase" | "local" }) {
  if (mode === "firebase") {
    return null;
  }

  return (
    <div className="mode-banner">
      Firebase 설정 전이라 이 브라우저에만 저장 중입니다.
    </div>
  );
}

function StudentEntry() {
  const store = useMemo(() => getEventStore(), []);
  const [event, setEvent] = useState<LearningEvent | null>(null);
  const [loading, setLoading] = useState(Boolean(EVENT_ID));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!EVENT_ID) return;
    let cancelled = false;
    setLoading(true); setError("");
    store.getEvent(EVENT_ID).then(value => { if (!cancelled) setEvent(value); })
      .catch(() => { if (!cancelled) setError("행사를 불러오지 못했습니다. 연결을 확인해 주세요."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const unsubscribe = watchEvent(EVENT_ID, value => { if (!cancelled) setEvent(old => JSON.stringify(old) === JSON.stringify(value) ? old : value); }, () => { if (!cancelled) setError("행사를 불러오지 못했습니다. 연결을 확인해 주세요."); });
    const interval = unsubscribe ? null : window.setInterval(() => {
      store.getEvent(EVENT_ID).then(value => { if (!cancelled) setEvent(old => JSON.stringify(old) === JSON.stringify(value) ? old : value); }).catch(() => {});
    }, 5000);
    return () => { cancelled = true; unsubscribe?.(); if (interval) window.clearInterval(interval); };
  }, [store, attempt]);
  if (event && !event.isExample && !loading && !error) return <StudentPage event={event} />;
  return <main className="page"><h1>{APP_NAME}</h1><div className="panel empty-state">
    {loading ? "불러오는 중" : error || (!EVENT_ID ? "교사가 공유한 링크로 접속해 주세요." : !event ? "찾을 수 없는 체험학습입니다. 교사에게 링크를 확인해 주세요." : "예시 체험학습은 보기 전용입니다.")}
    {error && <button className="secondary-button" onClick={() => setAttempt(value => value + 1)}>다시 시도</button>}
    {event?.isExample && <p><a href={`/admin?event=${encodeURIComponent(event.id)}`}>예시 대시보드 보기</a></p>}
  </div></main>;
}

function AdminHome() {
  const store = useMemo(() => getEventStore(), []);
  const [events, setEvents] = useState<LearningEvent[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [eventNotice, setEventNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setEvents(await store.listEvents()); }
    catch { setError("체험학습을 불러오지 못했습니다. 연결을 확인해 주세요."); }
    finally { setLoading(false); }
  }, [store]);
  useEffect(() => { void load(); }, [load]);
  const deleteEvent = async (item: LearningEvent) => {
    if (deleting || !window.confirm(`“${item.name}”을 삭제할까요? 학생용 링크는 사용할 수 없게 됩니다.`)) return;
    setDeleting(item.id); setError("");
    try { await store.deleteEvent(item.id); setEvents(old => old.filter(event => event.id !== item.id)); }
    catch { setError("삭제하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setDeleting(null); }
  };
  const event = events.find(item => item.id === EVENT_ID);
  if (EVENT_ID && event && !loading && !error) return <EventDashboard event={event} onRename={async name => {
    const updated = await store.renameEvent(event.id, name);
    setEvents(old => old.map(item => item.id === updated.id ? updated : item));
  }} />;
  return <main className="page admin-page">
    <header className="topbar"><div><p className="eyebrow">교사</p><h1>{APP_NAME}</h1></div></header>
    <ModeBanner mode={store.mode} />
    {error && <div className="notice" role="alert">{error}<button className="secondary-button" onClick={() => void load()}>다시 시도</button></div>}
    {loading ? <div className="loading-box">불러오는 중</div> : EVENT_ID ? <div className="panel empty-state">찾을 수 없는 체험학습입니다. <a href="/admin">행사 목록</a></div> : <>
      <div className="event-toolbar"><button className="secondary-button" disabled={editingId !== null || deleting !== null} onClick={() => { setEventNotice(""); setCreating(value => !value); }}><Plus size={18} />{creating ? "생성 취소" : "새 체험학습"}</button></div>
      {creating && <CreateEventForm onCreate={input => store.createEvent(input).then(created => { window.location.assign(`/admin?event=${encodeURIComponent(created.id)}`); })} />}
      {eventNotice && <div className="notice" role="status">{eventNotice}</div>}
      <div className="event-list">{events.map(item => <div key={item.id} className="event-item"><div className="panel event-card">
        <button className="event-open" disabled={deleting !== null || editingId !== null} onClick={() => window.location.assign(`/admin?event=${encodeURIComponent(item.id)}`)}>
          <div>{item.isExample && <span className="readonly-badge">보기 전용 예시</span>}<h2>{item.name}</h2><p className="muted">{item.classGroupCounts.length}개 반 · {item.classGroupCounts.reduce((sum, count) => sum + count, 0)}개 모둠</p></div><span aria-hidden="true">→</span>
        </button>
        {!item.isExample && <div className="event-card-actions">
          <button className="icon-button" type="button" disabled={deleting !== null || editingId !== null} onClick={() => { setCreating(false); setEventNotice(""); setEditingId(item.id); }} aria-label={`${item.name} 편집`} title="체험학습 편집" aria-expanded={editingId === item.id} aria-controls={`event-settings-${item.id}`}><Pencil size={18} /></button>
          <button className="icon-button danger" type="button" disabled={deleting !== null || editingId !== null} onClick={() => void deleteEvent(item)} aria-label={`${item.name} 삭제`} title="체험학습 삭제">{deleting === item.id ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}</button>
        </div>}
      </div>
      {editingId === item.id && <div id={`event-settings-${item.id}`}><CreateEventForm initialEvent={item} onCancel={() => setEditingId(null)} onCreate={async input => {
        const updated = await store.updateEvent(item.id, input);
        setEvents(old => old.map(current => current.id === updated.id ? updated : current));
        setEditingId(null); setEventNotice(`${item.name}의 반·모둠 설정을 저장했습니다.`);
      }} /></div>}
      </div>)}</div>
      {!events.length && !error && <p className="empty-state">아직 체험학습이 없습니다. 새 체험학습을 만들어 시작하세요.</p>}
    </>}
  </main>;
}

function CreateEventForm({ onCreate, initialEvent, onCancel }: { onCreate: (input: EventInput) => Promise<void>; initialEvent?: LearningEvent; onCancel?: () => void }) {
  const [name, setName] = useState(initialEvent?.name ?? "");
  const [classCount, setClassCount] = useState(String(initialEvent?.classGroupCounts.length ?? 5));
  const [baseCount, setBaseCount] = useState(String(initialEvent?.defaultGroupCount ?? initialEvent?.classGroupCounts[0] ?? 4));
  const [counts, setCounts] = useState<string[]>(initialEvent?.classGroupCounts.map(String) ?? Array(5).fill("4"));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!initialEvent || !onCancel || saving) return;
    const cancelOutside = (pointerEvent: PointerEvent) => {
      if (pointerEvent.target instanceof Node && !formRef.current?.contains(pointerEvent.target)) onCancel();
    };
    document.addEventListener("pointerdown", cancelOutside);
    return () => document.removeEventListener("pointerdown", cancelOutside);
  }, [initialEvent, onCancel, saving]);
  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault(); setError("");
    try {
      if (!Number.isInteger(Number(classCount)) || Number(classCount) !== counts.length || !Number.isInteger(Number(baseCount)) || Number(baseCount) < 1 || Number(baseCount) > 30) throw new Error("반 수와 모둠 수는 1~30의 정수로 입력해 주세요.");
      const input = validateEventInput({ name, classGroupCounts: counts.map(Number), defaultGroupCount: Number(baseCount) });
      setSaving(true); await onCreate(input);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "생성하지 못했습니다. 다시 시도해 주세요."); }
    finally { setSaving(false); }
  };
  return <form className="panel event-form" ref={formRef} onSubmit={submit} onKeyDown={keyEvent => {
    if (keyEvent.key === "Escape" && onCancel && !saving) { keyEvent.preventDefault(); onCancel(); }
  }}>
    {!initialEvent && <label>행사 이름<input value={name} onChange={e => setName(e.target.value)} placeholder="예: 가을 체험학습" maxLength={80} required disabled={saving} /></label>}
    {initialEvent && <h3>반·모둠 설정</h3>}
    <div className="field-row">
      <label>반 수<input type="number" min={1} max={30} step={1} value={classCount} required disabled={saving} onChange={e => {
        const value = e.target.value; setClassCount(value); const count = Number(value);
        if (Number.isInteger(count) && count >= 1 && count <= 30) setCounts(old => Array.from({ length: count }, (_, index) => old[index] ?? baseCount));
      }} /></label>
      <label>기본 모둠 수<input type="number" min={1} max={30} step={1} value={baseCount} required disabled={saving} onChange={e => {
        setBaseCount(e.target.value); const value = e.target.value; setCounts(old => old.map(() => value));
      }} /></label>
    </div>
    <fieldset className="class-counts" disabled={saving}><legend>반별 모둠 수</legend>{counts.map((count, index) => <label key={index}>{index + 1}반<input type="number" min={1} max={30} step={1} value={count} required onChange={e => setCounts(old => old.map((value, i) => i === index ? e.target.value : value))} /></label>)}</fieldset>
    {error && <div className="notice" role="alert">{error}</div>}
    <div className="event-toolbar"><button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중" : initialEvent ? "설정 저장" : "체험학습 만들기"}</button>
    </div>
  </form>;
}

function StudentPage({ event }: { event: LearningEvent }) {
  const store = useMemo(() => getGroupStore(event), [event]);
  const [session, setSession] = useState<StudentSession | null>(() => {
    const saved = readStudentSession();
    return saved && saved.eventId === event.id && validGroup(event, saved.classNo, saved.groupNo) ? saved : null;
  });
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [editingCourse, setEditingCourse] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => (session ? readPendingActions(getGroupId(session.classNo, session.groupNo)).length : 0));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (session && !validGroup(event, session.classNo, session.groupNo)) {
      localStorage.removeItem(eventStorageKey(event.id, "student-session"));
      setSession(null); setGroup(null); setNotice("반·모둠 설정이 변경되었습니다. 다시 선택해 주세요.");
    }
  }, [event, session]);
  const groupId = session ? getGroupId(session.classNo, session.groupNo) : null;

  const loadGroup = useCallback(async () => {
    if (!groupId) {
      return;
    }

    setLoading(true);
    setLoadFailed(false);
    try {
      const nextGroup = await store.getGroup(groupId);
      setGroup(nextGroup);
    } catch (error) {
      setLoadFailed(true);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [groupId, store]);

  const flushPending = useCallback(async () => {
    if (!groupId || !navigator.onLine) {
      return;
    }

    const pending = readPendingActions(groupId);

    if (pending.length === 0) {
      setPendingCount(0);
      return;
    }

    let latest: GroupRecord | null = null;

    for (let index = 0; index < pending.length; index++) {
      latest = await store.applyAction(pending[index]);
      if (!latest) {
        clearPendingActions(groupId);
        setNotice("모둠 기록이 초기화되어 대기 중인 체크인을 종료했습니다. 코스를 다시 입력해 주세요.");
        setGroup(null); setPendingCount(0); return;
      }
      writePendingActions(groupId, pending.slice(index + 1));
    }

    clearPendingActions(groupId);
    setPendingCount(0);
    setNotice("임시 저장된 기록을 전송했습니다.");

    if (latest) {
      setGroup(latest);
    } else {
      await loadGroup();
    }
  }, [groupId, loadGroup, store]);

  useEffect(() => {
    if (!groupId) {
      return;
    }

    loadGroup().catch(() => setNotice("불러오지 못했습니다. 연결을 확인해 주세요."));
  }, [groupId, loadGroup]);

  useEffect(() => {
    if (!groupId) {
      return;
    }

    const refresh = async () => {
      const pending = readPendingActions(groupId);
      setPendingCount(pending.length);

      if (pending.length > 0) {
        await flushPending();
        return;
      }

      if (navigator.onLine && store.mode === "local") {
        const nextGroup = await store.getGroup(groupId);
        setGroup(nextGroup);
      }
    };

    const safeRefresh = () => { refresh().catch(() => setNotice("연결을 확인해 주세요. 저장된 입력은 유지됩니다.")); };
    const interval = window.setInterval(safeRefresh, 5000);
    window.addEventListener("online", safeRefresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", safeRefresh);
    };
  }, [flushPending, groupId, store]);

  useEffect(() => {
    if (!groupId) return;
    return watchGroup(event.id, groupId, next => { if (!readPendingActions(groupId).length) setGroup(next); }, () => setNotice("기록을 불러오지 못했습니다. 연결을 확인해 주세요.")) ?? undefined;
  }, [event.id, groupId]);

  const handleSession = (nextSession: StudentSession) => {
    saveStudentSession(nextSession);
    setSession(nextSession);
    setGroup(null);
    setEditingCourse(false);
    setNotice("");
  };

  const handleSaveCourse = async (courseInput: { places: CourseInputPlace[] }) => {
    if (!session) {
      return;
    }

    const nextGroup = group
      ? await store.updateCourse(group.id, courseInput)
      : await (async () => {
          const createdGroup = createInitialGroup({
          ...session,
          ...courseInput,
          });
          await store.saveGroup(createdGroup);
          return createdGroup;
        })();

    if (!nextGroup) {
      setNotice("코스를 저장하지 못했습니다.");
      return;
    }

    setGroup(nextGroup);
    setEditingCourse(false);
    setNotice("코스를 저장했습니다.");
  };

  const queueAction = (action: GroupAction) => {
    if (!groupId) {
      return;
    }

    const pending = [...readPendingActions(groupId), action];
    writePendingActions(groupId, pending);
    setPendingCount(pending.length);
    setNotice("임시 저장됨, 연결되면 자동 전송");
  };

  const handleAction = async (type: "depart" | "arrive" | "undo") => {
    if (!group || !session) {
      return;
    }

    const action: GroupAction = {
      id: group.id,
      eventId: event.id,
      classNo: session.classNo,
      groupNo: session.groupNo,
      type,
      clientActionId: createClientActionId(),
      clientAt: new Date().toISOString(),
    };

    const optimistic = applyGroupAction(group, action);
    setGroup(optimistic);

    if (!navigator.onLine) {
      queueAction(action);
      return;
    }

    try {
      const savedGroup = await store.applyAction(action);
      if (savedGroup) {
        setGroup(savedGroup); setNotice("");
      } else {
        setGroup(null); setNotice("모둠 기록이 초기화되었습니다. 코스를 다시 입력해 주세요.");
      }
    } catch {
      queueAction(action);
    }
  };

  const resetSession = () => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setGroup(null);
    setEditingCourse(false);
    setNotice("");
  };

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">학생</p>
          <h1>{APP_NAME}</h1>
        </div>
        {session && (
          <button className="icon-button" type="button" onClick={resetSession} aria-label="모둠 변경">
            <ArrowLeft size={18} />
          </button>
        )}
      </header>

      <ModeBanner mode={store.mode} />
      <h2 className="event-title">{event.name}</h2>

      {notice && (!group || editingCourse || loadFailed) && <div className="notice" role="alert">{notice}</div>}
      {loadFailed && <button className="secondary-button" onClick={() => { loadGroup().catch(() => setNotice("불러오지 못했습니다. 연결을 확인해 주세요.")); }}>다시 시도</button>}
      {!session && <StudentStartForm event={event} onSubmit={handleSession} />}
      {session && <LocationSharing event={event} classNo={session.classNo} groupNo={session.groupNo} />}

      {session && loading && (
        <div className="loading-box">
          <Loader2 className="spin" size={20} />
          불러오는 중
        </div>
      )}

      {session && !loading && !loadFailed && (!group || editingCourse) && (
        <CourseEditor
          session={session}
          existingGroup={group}
          onSave={handleSaveCourse}
          onCancel={group ? () => setEditingCourse(false) : undefined}
        />
      )}

      {session && !loading && group && !editingCourse && group.history.length === 0 && (
        <CheckInPanel
          group={group}
          notice={notice}
          pendingCount={pendingCount}
          onAction={handleAction}
          onEditCourse={() => setEditingCourse(true)}
        />
      )}

      {session && !loading && group && !editingCourse && group.history.length > 0 && (
        <CheckInPanel
          group={group}
          notice={notice}
          pendingCount={pendingCount}
          onAction={handleAction}
          onEditCourse={() => setEditingCourse(true)}
        />
      )}
    </main>
  );
}

function StudentStartForm({ event, onSubmit }: { event: LearningEvent; onSubmit: (session: StudentSession) => void }) {
  const lastStudent = useMemo(() => readLastStudent(), []);
  const [classNo, setClassNo] = useState(validGroup(event, lastStudent.classNo, lastStudent.groupNo) ? lastStudent.classNo : 1);
  const [groupNo, setGroupNo] = useState(validGroup(event, lastStudent.classNo, lastStudent.groupNo) ? lastStudent.groupNo : 1);
  const [leaderName, setLeaderName] = useState(lastStudent.leaderName);
  useEffect(() => {
    if (!validGroup(event, classNo, groupNo)) { setClassNo(1); setGroupNo(1); }
  }, [event, classNo, groupNo]);

  const submit = (formEvent: FormEvent) => {
    formEvent.preventDefault();

    if (!leaderName.trim() || !validGroup(event, classNo, groupNo)) {
      return;
    }

    onSubmit({
      eventId: event.id,
      classNo,
      groupNo,
      leaderName: leaderName.trim(),
    });
  };

  return (
    <form className="panel" onSubmit={submit}>
      <div className="field-row">
        <label>
          학급
          <select value={classNo} onChange={(event) => { setClassNo(Number(event.target.value)); setGroupNo(1); }}>
            {numbers(event.classGroupCounts.length).map((number) => (
              <option key={number} value={number}>
                {number}반
              </option>
            ))}
          </select>
        </label>
        <label>
          모둠
          <select value={groupNo} onChange={(event) => setGroupNo(Number(event.target.value))}>
            {numbers(event.classGroupCounts[classNo - 1]).map((number) => (
              <option key={number} value={number}>
                {number}모둠
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        모둠장 이름
        <input
          value={leaderName}
          onChange={(event) => setLeaderName(event.target.value)}
          placeholder="예: 김은성"
          autoComplete="name"
        />
      </label>

      <button className="primary-button" type="submit">
        <LogIn size={20} />
        들어가기
      </button>
    </form>
  );
}

function CourseEditor({
  session,
  existingGroup,
  onSave,
  onCancel,
}: {
  session: StudentSession;
  existingGroup?: GroupRecord | null;
  onSave: (courseInput: { places: CourseInputPlace[] }) => Promise<void>;
  onCancel?: () => void;
}) {
  const existingPlaces = useMemo(
    () => (existingGroup ? getEditablePlacesFromCourse(existingGroup.course) : null),
    [existingGroup],
  );
  const [places, setPlaces] = useState<CourseInputPlace[]>(
    () => existingPlaces ?? [createEmptyCourseInputPlace(), createEmptyCourseInputPlace()],
  );
  const [saving, setSaving] = useState(false);
  const [courseNotice, setCourseNotice] = useState("");
  const activePlace = existingGroup && existingGroup.status !== "ready"
    ? existingGroup.course[existingGroup.currentIndex]
    : null;
  const activeEditablePlaceId = activePlace?.placeId ?? null;

  const updatePlace = (
    setter: Dispatch<SetStateAction<CourseInputPlace[]>>,
    index: number,
    value: string,
  ) => {
    setter((current) => current.map((place, placeIndex) => (placeIndex === index ? { ...place, name: value } : place)));
  };

  const addPlace = (setter: Dispatch<SetStateAction<CourseInputPlace[]>>) =>
    setter((current) => [...current, createEmptyCourseInputPlace()]);
  const removePlace = (setter: Dispatch<SetStateAction<CourseInputPlace[]>>, index: number) =>
    setter((current) => current.filter((_, placeIndex) => placeIndex !== index));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const editablePlaces = places;
    let parsedCourse;
    try {
      parsedCourse = createCourse(places);
    } catch (error) {
      setCourseNotice(error instanceof Error ? error.message : "시간과 장소 입력을 확인해 주세요.");
      return;
    }
    if (parsedCourse.length < 2) {
      setCourseNotice("출발 장소와 도착 장소를 포함해 두 곳 이상 입력해 주세요.");
      return;
    }

    if (activeEditablePlaceId && !editablePlaces.some((place) => place.placeId === activeEditablePlaceId && place.name.trim())) {
      setCourseNotice("현재 진행 중인 장소는 비우거나 삭제할 수 없습니다.");
      return;
    }

    setSaving(true);
    setCourseNotice("");
    try {
      await onSave({ places });
    } catch {
      setCourseNotice("저장하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const renderEditablePlaces = (
    places: CourseInputPlace[],
    setter: Dispatch<SetStateAction<CourseInputPlace[]>>,
  ) =>
    places.map((place, index) => (
      <li key={place.placeId}>
        <input
          value={place.name}
          onChange={(event) => updatePlace(setter, index, event.target.value)}
          placeholder={index === 0 ? "예: 10:30 광장" : index === 1 ? "예: 11:00 박물관" : "예: 12:00 카페"}
          aria-label={`${index + 1}번째 시간과 장소`}
        />
        <button
          className="icon-button danger"
          type="button"
          onClick={() => removePlace(setter, index)}
          aria-label="장소 삭제"
          disabled={place.placeId === activeEditablePlaceId}
          title={place.placeId === activeEditablePlaceId ? "현재 진행 중인 장소는 삭제할 수 없습니다." : undefined}
        >
          <Trash2 size={18} />
        </button>
      </li>
    ));

  return (
    <form className="panel course-panel" onSubmit={submit}>
      <div>
        <p className="eyebrow">{session.classNo}반 {session.groupNo}모둠</p>
        <h2>코스 입력</h2>
        <p className="course-hint">첫 장소는 출발지 · 시간은 생략 가능</p>
      </div>

      {onCancel && (
        <button className="secondary-button back-button" type="button" onClick={onCancel}>
          <ArrowLeft size={18} />
          이전 화면
        </button>
      )}

      {courseNotice && <div className="notice" role="alert">{courseNotice}</div>}

      <ol className="course-list editor">
        {renderEditablePlaces(places, setPlaces)}
        <li className="control-row">
          <button className="secondary-button add-place-button" type="button" onClick={() => addPlace(setPlaces)}>
            <Plus size={18} />
            장소 추가
          </button>
        </li>
      </ol>

      <button className="primary-button" type="submit" disabled={saving}>
        {saving ? <Loader2 className="spin" size={20} /> : <Save size={20} />}
        코스 저장
      </button>
    </form>
  );
}

function CheckInPanel({
  group,
  notice,
  pendingCount,
  onAction,
  onEditCourse,
}: {
  group: GroupRecord;
  notice: string;
  pendingCount: number;
  onAction: (type: "depart" | "arrive" | "undo") => void;
  onEditCourse?: () => void;
}) {
  const nextAction = getNextAction(group);
  const currentPlace = getCurrentPlaceName(group);
  const nextPlace = getNextPlaceName(group);

  return (
    <section className="stack">
      <div className="status-panel">
        <p className="eyebrow">{group.classNo}반 {group.groupNo}모둠 · {group.leaderName}</p>
        <h2>{STATUS_LABELS[group.status]}</h2>
        <p className="place-name">{currentPlace}</p>
        <p className="muted">다음 장소: {nextPlace ?? "없음"}</p>
      </div>

      <button
        className="action-button"
        type="button"
        disabled={nextAction.disabled || !nextAction.type}
        onClick={() => nextAction.type && onAction(nextAction.type)}
      >
        {nextAction.type === "arrive" ? <Check size={26} /> : <RefreshCw size={26} />}
        <span>{nextAction.placeName ? `${nextAction.placeName} ${nextAction.label}` : nextAction.label}</span>
      </button>

      <div className="button-row">
        <button className="secondary-button" type="button" onClick={() => onAction("undo")} disabled={group.history.length === 0}>
          <Undo2 size={18} />
          되돌리기
        </button>
        {onEditCourse && (
          <button className="secondary-button" type="button" onClick={onEditCourse}>
            <ClipboardList size={18} />
            코스 수정
          </button>
        )}
      </div>

      {(notice || pendingCount > 0) && (
        <div className="notice">
          {notice || "임시 저장됨, 연결되면 자동 전송"}
          {pendingCount > 0 && <strong>{pendingCount}개 대기</strong>}
        </div>
      )}

      <div className="panel">
        <h3>코스</h3>
        <ol className="course-list">
          {group.course.map((place, index) => (
            <li
              key={`${place.order}-${place.name}`}
              className={classNames(index < group.currentIndex && "past", index === group.currentIndex && "active")}
            >
              {getPlaceLabel(place)}
            </li>
          ))}
        </ol>
      </div>

      <HistoryList group={group} />
    </section>
  );
}

function HistoryList({ group }: { group: GroupRecord }) {
  return (
    <div className="panel">
      <h3>기록</h3>
      {group.history.length === 0 ? (
        <p className="muted">아직 기록이 없습니다.</p>
      ) : (
        <ul className="history-list">
          {group.history.map((entry) => (
            <li key={entry.clientActionId}>
              <time>{formatTime(entry.at)}</time>
              <span>{entry.placeName}</span>
              <strong>{entry.type === "depart" ? "출발" : "도착"}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EventActionsMenu({ onDownload, onReset, loading }: { onDownload: () => void; onReset?: () => Promise<void>; loading: boolean }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = (restoreFocus = false) => {
    if (!menuRef.current) return;
    menuRef.current.open = false;
    if (restoreFocus) menuRef.current.querySelector("summary")?.focus();
  };
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return <details className="event-actions-menu" ref={menuRef} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); closeMenu(true); }
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) closeMenu();
  }}>
    <summary className="icon-button" aria-label="행사 추가 작업" title="추가 작업"><span aria-hidden="true">⋯</span></summary>
    <div className="event-actions-popover">
      <button type="button" onClick={() => { closeMenu(true); onDownload(); }}><Download size={18} />CSV 다운로드</button>
      {onReset && <button type="button" className="reset-menu-item" disabled={loading} onClick={() => { closeMenu(true); void onReset(); }}><Trash2 size={18} />초기화</button>}
    </div>
  </details>;
}

function EventDashboard({ event, onRename }: { event: LearningEvent; onRename: (name: string) => Promise<void> }) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(event.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState("");
  const nameEditorRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!editingName || nameSaving) return;
    const cancelOutside = (pointerEvent: PointerEvent) => {
      if (pointerEvent.target instanceof Node && !nameEditorRef.current?.contains(pointerEvent.target)) {
        setEditingName(false); setNameError("");
      }
    };
    document.addEventListener("pointerdown", cancelOutside);
    return () => document.removeEventListener("pointerdown", cancelOutside);
  }, [editingName, nameSaving]);
  const beginRename = () => {
    if (event.isExample) return;
    setNameDraft(event.name); setNameError(""); setEditingName(true);
  };
  const saveName = async (formEvent: FormEvent) => {
    formEvent.preventDefault();
    if (nameSaving) return;
    const name = nameDraft.trim();
    if (!name || name.length > 80) { setNameError("행사 이름을 1~80자로 입력해 주세요."); return; }
    if (name === event.name) { setEditingName(false); return; }
    setNameSaving(true); setNameError("");
    try { await onRename(name); setEditingName(false); }
    catch { setNameError("이름을 저장하지 못했습니다. 연결과 교사 로그인을 확인한 뒤 다시 시도해 주세요."); }
    finally { setNameSaving(false); }
  };
  const store = useMemo(() => getGroupStore(event), [event]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState(1);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adminNotice, setAdminNotice] = useState("");

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const nextGroups = await store.listGroups();
      setGroups(nextGroups);
    } catch {
      setAdminNotice("기록을 불러오지 못했습니다. 연결을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    const unsubscribe = watchGroups(event, setGroups, () => setAdminNotice("기록을 불러오지 못했습니다. 연결을 확인해 주세요."));
    if (unsubscribe) return unsubscribe;
    const interval = window.setInterval(loadGroups, 5000);
    return () => window.clearInterval(interval);
  }, [event, loadGroups]);

  const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) ?? null : null;

  const downloadCsv = () => {
    const rows = [
      ["학급", "모둠", "모둠장", "시간", "기록", "장소", "순서"],
      ...groups.flatMap((group) =>
        group.history.map((entry) => [
          `${group.classNo}`,
          `${group.groupNo}`,
          group.leaderName,
          formatTime(entry.at),
          entry.type === "depart" ? "출발" : "도착",
          entry.placeName,
          `${entry.placeIndex + 1}`,
        ]),
      ),
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${event.name.replace(/[\\/:*?"<>|]/g, "_")}_기록.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const resetDatabase = async () => {
    const confirmed = window.confirm(`${event.name}의 모둠 코스와 출발/도착 기록을 초기화할까요? 다른 행사는 유지됩니다.`);

    if (!confirmed) {
      return;
    }

    setLoading(true);
    try {
      await store.clearAllGroups();
      setGroups([]);
      setSelectedGroupId(null);
      setAdminNotice("데이터베이스를 초기화했습니다.");
    } catch {
      setAdminNotice("초기화에 실패했습니다. Firebase 연결을 확인해 주세요.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page admin-page">
      <header className="topbar dashboard-topbar">
        <div>
          <p className="eyebrow">교사</p>
          <h1><a className="app-title-link" href="/admin" title="행사 목록으로 돌아가기">{APP_NAME}</a></h1>
        </div>

      </header>

      <ModeBanner mode={store.mode} />
      <div className="event-heading">
        <div className="event-title-row">
          {editingName ? <form className="event-name-editor" ref={nameEditorRef} onSubmit={saveName} onKeyDown={keyEvent => {
            if (keyEvent.key === "Escape" && !nameSaving) { keyEvent.preventDefault(); setEditingName(false); setNameError(""); }
          }}>
            <input aria-label="행사 이름" aria-invalid={!!nameError} aria-describedby={nameError ? "event-name-error" : undefined} value={nameDraft} onChange={e => setNameDraft(e.target.value)} maxLength={80} required autoFocus disabled={nameSaving} />
            <button className="icon-button event-refresh" type="submit" aria-label="행사 이름 저장" title="저장" disabled={nameSaving}>{nameSaving ? <Loader2 className="spin" size={18} /> : <Check size={18} />}</button>
          </form> : <h2 className={classNames("event-title", !event.isExample && "editable-event-title")} onDoubleClick={beginRename} tabIndex={event.isExample ? undefined : 0} title={event.isExample ? undefined : "두 번 클릭하여 이름 수정"} onKeyDown={keyEvent => {
            if (!event.isExample && (keyEvent.key === "Enter" || keyEvent.key === "F2")) { keyEvent.preventDefault(); beginRename(); }
          }}>{event.name}</h2>}
          <button className="icon-button event-refresh" type="button" onClick={loadGroups} aria-label="새로고침" title="새로고침" disabled={loading}>
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </div>
        <div className="event-record-actions" role="group" aria-label="행사 도구">

        {!event.isExample && <button className="secondary-button" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(`${window.location.origin}/?event=${encodeURIComponent(event.id)}`); setAdminNotice("학생용 링크를 복사했습니다."); }
          catch { setAdminNotice(`학생용 링크: ${window.location.origin}/?event=${encodeURIComponent(event.id)}`); }
        }}>학생용 링크 복사</button>}
        <EventActionsMenu onDownload={downloadCsv} onReset={event.isExample ? undefined : resetDatabase} loading={loading} />
        </div>
      </div>
      {nameError && <div className="notice" role="alert" id="event-name-error">{nameError}</div>}
      {event.isExample && <span className="readonly-badge">보기 전용 예시</span>}
      {adminNotice && <div className="notice" role="status">{adminNotice}</div>}
      <TeacherLocationMap event={event} />

      <div className="admin-actions">
        <div className="tabs" role="tablist" aria-label="학급">
          {numbers(event.classGroupCounts.length).map((classNo) => (
            <button
              key={classNo}
              className={classNames(selectedClass === classNo && "active")}
              type="button"
              onClick={() => {
                setSelectedClass(classNo);
                setSelectedGroupId(null);
              }}
            >
              {classNo}반
            </button>
          ))}
        </div>

      </div>

      <section className="group-grid">
        {numbers(event.classGroupCounts[selectedClass - 1]).map((groupNo) => {
          const id = getGroupId(selectedClass, groupNo);
          const group = groups.find((item) => item.id === id) ?? null;
          return (
            <GroupCard
              key={id}
              classNo={selectedClass}
              groupNo={groupNo}
              group={group}
              selected={selectedGroupId === id}
              onClick={() => setSelectedGroupId(id)}
            />
          );
        })}
      </section>

      {selectedGroup && (
        <section className="detail-panel">
          <div>
            <p className="eyebrow">{selectedGroup.classNo}반 {selectedGroup.groupNo}모둠</p>
            <h2>{selectedGroup.leaderName}</h2>
          </div>
          <div className="detail-grid">
            <span>현재</span>
            <strong>{STATUS_LABELS[selectedGroup.status]} · {getCurrentPlaceName(selectedGroup)}</strong>
            <span>다음</span>
            <strong>{getNextPlaceName(selectedGroup) ?? "없음"}</strong>
            <span>마지막 도착</span>
            <strong>{formatTime(selectedGroup.lastArrivalAt)}</strong>
          </div>
          <div className="panel nested-panel">
            <h3>전체 코스</h3>
            <CoursePreview group={selectedGroup} />
          </div>
          <HistoryList group={selectedGroup} />
        </section>
      )}
    </main>
  );
}

function GroupCard({
  classNo,
  groupNo,
  group,
  selected,
  onClick,
}: {
  classNo: number;
  groupNo: number;
  group: GroupRecord | null;
  selected: boolean;
  onClick: () => void;
}) {
  const status = group ? STATUS_LABELS[group.status] : "미입력";

  return (
    <button
      className={classNames(
        "group-card",
        !group && "empty",
        group?.status === "moving" && "moving",
        group?.status === "watching" && "watching",
        selected && "selected",
      )}
      type="button"
      onClick={onClick}
    >
      <div className="card-head">
        <strong>{classNo}반 {groupNo}모둠</strong>
        <span>{status}</span>
      </div>
      <p>{group?.leaderName ?? "모둠장 미입력"}</p>
      <dl>
        <div>
          <dt>현재</dt>
          <dd>{group ? getCurrentPlaceName(group) : "-"}</dd>
        </div>
        <div>
          <dt>다음</dt>
          <dd>{group ? getNextPlaceName(group) ?? "없음" : "-"}</dd>
        </div>
        <div>
          <dt>마지막 도착</dt>
          <dd>{group ? formatTime(group.lastArrivalAt) : "-"}</dd>
        </div>
      </dl>
      {group && <CoursePreview group={group} compact />}
    </button>
  );
}

export default App;
