import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const compile = source => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } }).outputText).toString("base64")}`;
const logicUrl = compile(await readFile(new URL("../src/lib/groupLogic.ts", import.meta.url), "utf8"));
const eventUrl = compile(await readFile(new URL("../src/lib/eventLogic.ts", import.meta.url), "utf8"));
const storeSource = (await readFile(new URL("../src/lib/groupStore.ts", import.meta.url), "utf8"))
  .replace(/import\.meta\.env/g, "({})")
  .replace('"./groupLogic"', JSON.stringify(logicUrl)).replace('"./eventLogic"', JSON.stringify(eventUrl))
  .replace('"firebase/app"', JSON.stringify(import.meta.resolve("firebase/app")))
  .replace('"firebase/firestore"', JSON.stringify(import.meta.resolve("firebase/firestore")));
const { getEventStore, getGroupStore } = await import(compile(storeSource));
const logic = await import(logicUrl);
const data = new Map();
globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
const initial = () => logic.createInitialGroup({ classNo: 1, groupNo: 1, leaderName: "테스트", places: [{ placeId: "a", name: "10:30 출발지" }, { placeId: "b", name: "11:00 광장" }] });

test("identical group IDs, updates and resets remain isolated by event", async () => {
  const events = getEventStore();
  const a = await events.createEvent({ name: "A", classGroupCounts: [2, 4] });
  const b = await events.createEvent({ name: "B", classGroupCounts: [1] });
  const storeA = getGroupStore(a), storeB = getGroupStore(b);
  await storeA.saveGroup(initial()); await storeB.saveGroup(initial());
  await storeA.updateCourse("1-1", { places: [{ placeId: "a", name: "A 출발지" }, { placeId: "b", name: "A 광장" }] });
  assert.equal((await storeB.getGroup("1-1")).course[0].name, "출발지");
  await storeA.clearAllGroups();
  assert.equal((await storeA.listGroups()).length, 0);
  assert.equal((await storeB.listGroups()).length, 1);
  assert.equal((await events.listEvents()).length, 2);
  assert.equal((await events.getEvent(a.id)).name, "A");
  assert.equal(await events.getEvent("missing"), null);
});

test("store rejects invalid group IDs and cross-event queued actions", async () => {
  const event = await getEventStore().createEvent({ name: "C", classGroupCounts: [1] });
  const store = getGroupStore(event);
  for (const id of ["1-2", "2-1", "01-1", "1-1/other"]) assert.throws(() => store.getGroup(id));
  await store.saveGroup(initial());
  assert.throws(() => store.applyAction({ eventId: "other", id: "1-1", classNo: 1, groupNo: 1, type: "depart", clientAt: new Date().toISOString(), clientActionId: "wrong" }));
});

test("example store blocks every mutation", () => {
  const store = getGroupStore({ id: "example", name: "예시", classGroupCounts: [4, 4, 4, 4, 4], createdAt: "2026-01-01", isExample: true });
  assert.throws(() => store.saveGroup(initial()), /보기 전용/);
  assert.throws(() => store.clearAllGroups(), /보기 전용/);
  assert.throws(() => store.updateCourse("1-1", { places: [] }), /보기 전용/);
  assert.throws(() => store.applyAction({ eventId: "example", id: "1-1" }), /보기 전용/);
});

test("replaying an offline action cannot duplicate its history", () => {
  const action = { eventId: "event", id: "1-1", classNo: 1, groupNo: 1, type: "depart", clientAt: new Date().toISOString(), clientActionId: "once" };
  const group = logic.applyGroupAction(initial(), action);
  assert.deepEqual(logic.applyGroupAction(group, action), group);
});

test("replaying offline undo cannot remove an extra history entry", () => {
  const depart = { eventId: "event", id: "1-1", classNo: 1, groupNo: 1, type: "depart", clientAt: "2026-10-01T10:00:00Z", clientActionId: "depart" };
  let group = logic.applyGroupAction(initial(), depart);
  group = logic.applyGroupAction(group, { ...depart, type: "arrive", clientAt: "2026-10-01T11:00:00Z", clientActionId: "arrive" });
  const undo = { ...depart, type: "undo", clientAt: "2026-10-01T12:00:00Z", clientActionId: "undo" };
  const undone = logic.applyGroupAction(group, undo);
  assert.equal(undone.history.length, 1);
  assert.deepEqual(logic.applyGroupAction(undone, undo), undone);
});

test("deleting a created event removes access while preserving other events and records", async () => {
  const events = getEventStore();
  const a = await events.createEvent({ name: "삭제 대상", classGroupCounts: [1] });
  const b = await events.createEvent({ name: "유지 대상", classGroupCounts: [1] });
  const stale = getGroupStore(a);
  await stale.saveGroup(initial());
  await events.deleteEvent(a.id);
  assert.equal(await events.getEvent(a.id), null);
  assert.ok(!(await events.listEvents()).some(event => event.id === a.id));
  assert.equal((await events.getEvent(b.id)).name, "유지 대상");
  assert.throws(() => stale.saveGroup(initial()), /삭제된/);
  assert.ok(data.get(`trip-checkin-v5-${a.id}-groups`));
  for (const id of ["example-fieldtrip", "legacy-fieldtrip"]) {
    const saved = JSON.parse(data.get("trip-checkin-v5-events"));
    saved[id] = { ...a, id, isExample: id === "example-fieldtrip", deletedAt: undefined };
    data.set("trip-checkin-v5-events", JSON.stringify(saved));
    if (id === "example-fieldtrip") await assert.rejects(events.deleteEvent(id), /예시/);
    else {
      const legacyStore = getGroupStore(saved[id]);
      await legacyStore.saveGroup(initial());
      await events.deleteEvent(id);
      assert.equal(await events.getEvent(id), null);
      assert.ok(data.get(`trip-checkin-v5-${id}-groups`));
      assert.throws(() => legacyStore.getGroup("1-1"), /삭제된/);
    }
  }
});


test("editing configuration preserves records, defaults and event identity", async () => {
  const events = getEventStore();
  const event = await events.createEvent({ name: "설정 수정", classGroupCounts: [2, 3], defaultGroupCount: 3 });
  const stale = getGroupStore(event);
  await stale.saveGroup(initial());
  const updated = await events.updateEvent(event.id, { name: event.name, classGroupCounts: [1, 4, 2], defaultGroupCount: 2 });
  assert.equal(updated.id, event.id);
  assert.equal(updated.createdAt, event.createdAt);
  assert.equal((await events.getEvent(event.id)).defaultGroupCount, 2);
  assert.equal((await getGroupStore(updated).getGroup("1-1")).leaderName, "테스트");
  assert.throws(() => stale.getGroup("1-2"), /행사에 없는/);
  const secondClass = { ...initial(), id: "2-4", classNo: 2, groupNo: 4 };
  await getGroupStore(updated).saveGroup(secondClass);
  for (const counts of [[1], [1, 3]]) {
    await assert.rejects(events.updateEvent(event.id, { name: event.name, classGroupCounts: counts }), /2반 4모둠/);
  }
  assert.deepEqual((await events.getEvent(event.id)).classGroupCounts, [1, 4, 2]);
  await assert.rejects(events.updateEvent(event.id, { name: event.name, classGroupCounts: [0] }));
  await assert.rejects(events.updateEvent(event.id, { name: event.name, classGroupCounts: [1], defaultGroupCount: 31 }));
  await assert.rejects(events.updateEvent("example-fieldtrip", { name: "예시", classGroupCounts: [1] }), /보기 전용/);
  await events.deleteEvent(event.id);
  await assert.rejects(events.updateEvent(event.id, { name: event.name, classGroupCounts: [1] }), /삭제된/);
});
