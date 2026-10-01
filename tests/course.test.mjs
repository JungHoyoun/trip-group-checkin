import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/groupLogic.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } });
const logic = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const places = [
  { placeId: "start", name: "출발지" },
  { placeId: "middle", name: "공연장" },
  { placeId: "end", name: "아시아 문화전당" },
];
const initial = () => logic.createInitialGroup({ classNo: 1, groupNo: 1, leaderName: "테스트", places });
let sequence = 0;
const act = (group, type) => logic.applyGroupAction(group, {
  id: group.id, classNo: 1, groupNo: 1, type,
  clientActionId: `action-${++sequence}`, clientAt: new Date(2000000000000 + sequence * 1000).toISOString(),
});

test("only user-entered places are included, including formerly reserved names", () => {
  const course = logic.createCourse([...places, { placeId: "blank", name: "  " }]);
  assert.deepEqual(course.map(p => p.name), places.map(p => p.name));
  assert.ok(course.every(p => p.scheduledTime === null && p.requiredCheckpoint === null));
  assert.deepEqual(logic.getEditablePlacesFromCourse(course), places);
});

test("custom course supports departure, arrival, undo and completion", () => {
  let group = initial();
  assert.equal(logic.getNextAction(group).placeName, "공연장");
  group = act(group, "depart");
  assert.equal(group.currentIndex, 1);
  assert.equal(group.status, "moving");
  group = act(group, "arrive");
  assert.equal(group.status, "watching");
  group = act(group, "undo");
  assert.equal(group.status, "moving");
  group = act(group, "arrive");
  group = act(group, "depart");
  group = act(group, "arrive");
  assert.equal(group.currentIndex, 2);
  assert.equal(logic.getNextAction(group).label, "모든 코스 완료");
  assert.equal(logic.getNextAction(group).disabled, true);
});

test("inserting a place keeps current progress attached to its place ID", () => {
  const group = act(initial(), "depart");
  const edited = logic.updateGroupCourse(group, { places: [places[0], { placeId: "new", name: "새 장소" }, ...places.slice(1)] });
  assert.equal(edited.currentIndex, 2);
  assert.equal(edited.course[edited.currentIndex].placeId, "middle");
  assert.equal(edited.status, "moving");
});

test("legacy fixed places become editable without losing check-in history", () => {
  const group = act(initial(), "depart");
  group.course[0].scheduledTime = "10:00";
  group.course[0].requiredCheckpoint = "asia_culture_center";
  const normalized = logic.reconcileGroupProgress(group);
  assert.equal(normalized.history.length, 1);
  assert.ok(normalized.course.every(p => p.scheduledTime === null && p.requiredCheckpoint === null));
  assert.equal(logic.getEditablePlacesFromCourse(normalized.course).length, 3);
});
