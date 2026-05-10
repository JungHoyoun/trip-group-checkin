import {
  ArrowLeft,
  Check,
  ClipboardList,
  Download,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { CourseInputPlace, GroupAction, GroupRecord } from "./types";
import { APP_NAME, CLASS_NUMBERS, GROUP_NUMBERS, STATUS_LABELS } from "./lib/constants";
import {
  applyGroupAction,
  createClientActionId,
  createEmptyCourseInputPlace,
  createInitialGroup,
  formatTime,
  getCurrentPlaceName,
  getDelayState,
  getEditablePlacesFromCourse,
  getGroupId,
  getNextAction,
  getNextPlaceName,
} from "./lib/groupLogic";
import { getGroupStore } from "./lib/groupStore";

interface StudentSession {
  classNo: number;
  groupNo: number;
  leaderName: string;
}

const STORAGE_VERSION = "v4";
const SESSION_KEY = `trip-checkin-${STORAGE_VERSION}-student-session`;
const LAST_STUDENT_KEY = `trip-checkin-${STORAGE_VERSION}-last-student`;
const ADMIN_KEY = `trip-checkin-${STORAGE_VERSION}-admin-ok`;

function pendingKey(groupId: string) {
  return `trip-checkin-${STORAGE_VERSION}-pending-${groupId}`;
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
      classNo: 1,
      groupNo: 1,
      leaderName: "",
    };
  }

  try {
    return JSON.parse(raw) as StudentSession;
  } catch {
    return {
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

function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");

  return (
    <div className="app-shell">
      {isAdmin ? <AdminPage /> : <StudentPage />}
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

function StudentPage() {
  const store = useMemo(() => getGroupStore(), []);
  const [session, setSession] = useState<StudentSession | null>(() => readStudentSession());
  const [group, setGroup] = useState<GroupRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [editingCourse, setEditingCourse] = useState(false);
  const [pendingCount, setPendingCount] = useState(() => (session ? readPendingActions(getGroupId(session.classNo, session.groupNo)).length : 0));
  const [notice, setNotice] = useState("");

  const groupId = session ? getGroupId(session.classNo, session.groupNo) : null;

  const loadGroup = useCallback(async () => {
    if (!groupId) {
      return;
    }

    setLoading(true);
    try {
      const nextGroup = await store.getGroup(groupId);
      setGroup(nextGroup);
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

    for (const action of pending) {
      latest = await store.applyAction(action);
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

    loadGroup();
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

      if (navigator.onLine) {
        const nextGroup = await store.getGroup(groupId);
        setGroup(nextGroup);
      }
    };

    const interval = window.setInterval(refresh, 5000);
    window.addEventListener("online", flushPending);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", flushPending);
    };
  }, [flushPending, groupId, store]);

  const handleSession = (nextSession: StudentSession) => {
    saveStudentSession(nextSession);
    setSession(nextSession);
    setGroup(null);
    setEditingCourse(false);
    setNotice("");
  };

  const handleSaveCourse = async (courseInput: { beforeGatheringPlaces: CourseInputPlace[]; afterGatheringPlaces: CourseInputPlace[] }) => {
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
        setGroup(savedGroup);
      }
      setNotice("");
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

      {!session && <StudentStartForm onSubmit={handleSession} />}

      {session && loading && (
        <div className="loading-box">
          <Loader2 className="spin" size={20} />
          불러오는 중
        </div>
      )}

      {session && !loading && (!group || editingCourse) && (
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

function StudentStartForm({ onSubmit }: { onSubmit: (session: StudentSession) => void }) {
  const lastStudent = useMemo(() => readLastStudent(), []);
  const [classNo, setClassNo] = useState(lastStudent.classNo);
  const [groupNo, setGroupNo] = useState(lastStudent.groupNo);
  const [leaderName, setLeaderName] = useState(lastStudent.leaderName);

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (!leaderName.trim()) {
      return;
    }

    onSubmit({
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
          <select value={classNo} onChange={(event) => setClassNo(Number(event.target.value))}>
            {CLASS_NUMBERS.map((number) => (
              <option key={number} value={number}>
                {number}반
              </option>
            ))}
          </select>
        </label>
        <label>
          모둠
          <select value={groupNo} onChange={(event) => setGroupNo(Number(event.target.value))}>
            {GROUP_NUMBERS.map((number) => (
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
  onSave: (courseInput: { beforeGatheringPlaces: CourseInputPlace[]; afterGatheringPlaces: CourseInputPlace[] }) => Promise<void>;
  onCancel?: () => void;
}) {
  const existingPlaces = useMemo(
    () => (existingGroup ? getEditablePlacesFromCourse(existingGroup.course) : null),
    [existingGroup],
  );
  const [beforeGatheringPlaces, setBeforeGatheringPlaces] = useState<CourseInputPlace[]>(
    () => existingPlaces?.beforeGatheringPlaces ?? [createEmptyCourseInputPlace()],
  );
  const [afterGatheringPlaces, setAfterGatheringPlaces] = useState<CourseInputPlace[]>(
    () => existingPlaces?.afterGatheringPlaces ?? [createEmptyCourseInputPlace()],
  );
  const [saving, setSaving] = useState(false);
  const [courseNotice, setCourseNotice] = useState("");
  const activePlaceId = existingGroup && existingGroup.status !== "ready"
    ? existingGroup.course[existingGroup.currentIndex]?.placeId
    : null;

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
    const editablePlaces = [...beforeGatheringPlaces, ...afterGatheringPlaces];

    if (activePlaceId && !editablePlaces.some((place) => place.placeId === activePlaceId && place.name.trim())) {
      setCourseNotice("현재 진행 중인 장소는 비우거나 삭제할 수 없습니다.");
      return;
    }

    setSaving(true);
    setCourseNotice("");
    await onSave({
      beforeGatheringPlaces,
      afterGatheringPlaces,
    });
    setSaving(false);
  };

  const renderEditablePlaces = (
    places: CourseInputPlace[],
    setter: Dispatch<SetStateAction<CourseInputPlace[]>>,
    placeholder: string,
  ) =>
    places.map((place, index) => (
      <li key={place.placeId}>
        <input
          value={place.name}
          onChange={(event) => updatePlace(setter, index, event.target.value)}
          placeholder={placeholder}
        />
        <button
          className="icon-button danger"
          type="button"
          onClick={() => removePlace(setter, index)}
          aria-label="장소 삭제"
          disabled={place.placeId === activePlaceId}
          title={place.placeId === activePlaceId ? "현재 진행 중인 장소는 삭제할 수 없습니다." : undefined}
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
      </div>

      {onCancel && (
        <button className="secondary-button back-button" type="button" onClick={onCancel}>
          <ArrowLeft size={18} />
          이전 화면
        </button>
      )}

      {courseNotice && <div className="notice">{courseNotice}</div>}

      <ol className="course-list editor">
        <li className="fixed-place">
          <span className="time-chip">10:00</span>
          아시아 문화전당
        </li>
        {renderEditablePlaces(beforeGatheringPlaces, setBeforeGatheringPlaces, "오전 중간 장소")}
        <li className="control-row">
          <button className="secondary-button add-place-button" type="button" onClick={() => addPlace(setBeforeGatheringPlaces)}>
            <Plus size={18} />
            10:00~14:00 장소 추가
          </button>
        </li>
        <li className="fixed-place">
          <span className="time-chip">14:00</span>
          아시아 문화전당
        </li>
        {renderEditablePlaces(afterGatheringPlaces, setAfterGatheringPlaces, "오후 중간 장소")}
        <li className="control-row">
          <button className="secondary-button add-place-button" type="button" onClick={() => addPlace(setAfterGatheringPlaces)}>
            <Plus size={18} />
            14:00~18:30 장소 추가
          </button>
        </li>
        <li className="fixed-place">
          <span className="time-chip">18:30</span>
          공연장
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

function AdminPage() {
  const store = useMemo(() => getGroupStore(), []);
  const [authed, setAuthed] = useState(() => localStorage.getItem(ADMIN_KEY) === "true");
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [selectedClass, setSelectedClass] = useState(1);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!authed) {
      return;
    }

    setLoading(true);
    try {
      const nextGroups = await store.listGroups();
      setGroups(nextGroups);
    } finally {
      setLoading(false);
    }
  }, [authed, store]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    if (!authed) {
      return;
    }

    const interval = window.setInterval(loadGroups, 5000);
    return () => window.clearInterval(interval);
  }, [authed, loadGroups]);

  const selectedGroup = selectedGroupId ? groups.find((group) => group.id === selectedGroupId) ?? null : null;

  const login = (value: string) => {
    if (value.trim() === "admin") {
      localStorage.setItem(ADMIN_KEY, "true");
      setAuthed(true);
    }
  };

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
    anchor.download = "수학여행_모둠_체크인_기록.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!authed) {
    return <AdminLogin onLogin={login} />;
  }

  return (
    <main className="page admin-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">교사</p>
          <h1>{APP_NAME}</h1>
        </div>
        <button className="icon-button" type="button" onClick={loadGroups} aria-label="새로고침">
          {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
        </button>
      </header>

      <ModeBanner mode={store.mode} />

      <div className="admin-actions">
        <div className="tabs" role="tablist" aria-label="학급">
          {CLASS_NUMBERS.map((classNo) => (
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
        <button className="secondary-button" type="button" onClick={downloadCsv}>
          <Download size={18} />
          CSV
        </button>
      </div>

      <section className="group-grid">
        {GROUP_NUMBERS.map((groupNo) => {
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
          <HistoryList group={selectedGroup} />
        </section>
      )}
    </main>
  );
}

function AdminLogin({ onLogin }: { onLogin: (value: string) => void }) {
  const [value, setValue] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onLogin(value);
  };

  return (
    <main className="page">
      <header className="topbar">
        <div>
          <p className="eyebrow">교사</p>
          <h1>{APP_NAME}</h1>
        </div>
      </header>
      <form className="panel" onSubmit={submit}>
        <label>
          관리자 입력
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="admin" />
        </label>
        <button className="primary-button" type="submit">
          <LogIn size={20} />
          들어가기
        </button>
      </form>
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
  const delay = getDelayState(group);
  const status = group ? STATUS_LABELS[group.status] : "미입력";

  return (
    <button
      className={classNames(
        "group-card",
        !group && "empty",
        group?.status === "moving" && "moving",
        group?.status === "watching" && "watching",
        delay.isDelayed && "delayed",
        selected && "selected",
      )}
      type="button"
      onClick={onClick}
    >
      <div className="card-head">
        <strong>{classNo}반 {groupNo}모둠</strong>
        <span>{delay.isDelayed ? "지연" : status}</span>
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
      {delay.isDelayed && <small>{delay.labels.join(", ")}</small>}
    </button>
  );
}

export default App;
