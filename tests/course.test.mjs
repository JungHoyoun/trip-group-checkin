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
  assert.ok(normalized.course.every(p => p.requiredCheckpoint === null));
  assert.equal(normalized.course[0].scheduledTime, "10:00");
  assert.equal(logic.getEditablePlacesFromCourse(normalized.course).length, 3);
});


test("time and place accepts flexible spacing and separators", () => {
  for (const input of ["10:30 광장", "10:30       광장", "10:30 / 광장", "10:30 - 광장", "10:30—광장", "10:30 | 광장", "10:30광장", " 10 : 30 / 광장 ", "10：30　광장"]) {
    assert.deepEqual(logic.parseCoursePlaceInput(input), { name: "광장", scheduledTime: "10:30" }, input);
  }
  assert.deepEqual(logic.parseCoursePlaceInput("9:5 광장"), { name: "광장", scheduledTime: "09:05" });
  assert.deepEqual(logic.parseCoursePlaceInput("0:00 광장"), { name: "광장", scheduledTime: "00:00" });
  assert.deepEqual(logic.parseCoursePlaceInput("23:59 광장"), { name: "광장", scheduledTime: "23:59" });
});

test("invalid times, missing places and ranges are rejected", () => {
  for (const input of ["24:00 광장", "10:60 광장", "-1:00 광장", "+1:00 광장", "100:30 광장", "10:300 광장", "10: 광장", "10:30", "10:30 / ", "10:30 -", "10:30 / / - ", "10:30：00 광장", "10:30:00 광장", "10:30-11:30 광장"]) {
    assert.throws(() => logic.parseCoursePlaceInput(input), Error, input);
  }
  assert.throws(() => logic.createCourse([{ placeId: "a", name: "출발지" }, { placeId: "b", name: "25:00 광장" }]), /2번째 입력/);
});

test("plain names and punctuation within names are preserved", () => {
  for (const name of ["광장", "24시간 카페", "3번 출구", "카페 10:30", "A / B 광장", "A-1 광장"]) {
    assert.deepEqual(logic.parseCoursePlaceInput(name), { name, scheduledTime: null });
  }
  assert.deepEqual(logic.parseCoursePlaceInput("10:30 A / B-1 광장"), { name: "A / B-1 광장", scheduledTime: "10:30" });
});

test("scheduled times survive saving, reload, editing and check-in", () => {
  const inputs = [{ placeId: "start", name: "23:30 출발지" }, { placeId: "middle", name: "0:10 / 광장" }, { placeId: "end", name: "0:10 - 카페" }];
  const group = logic.createInitialGroup({ classNo: 1, groupNo: 1, leaderName: "테스트", places: inputs });
  const reloaded = logic.reconcileGroupProgress(JSON.parse(JSON.stringify(group)));
  assert.deepEqual(reloaded.course.map(p => p.scheduledTime), ["23:30", "00:10", "00:10"]);
  const editorInputs = logic.getEditablePlacesFromCourse(reloaded.course);
  assert.deepEqual(logic.createCourse(editorInputs), reloaded.course);
  const moving = act(reloaded, "depart");
  const edited = logic.updateGroupCourse(moving, { places: [editorInputs[0], { ...editorInputs[1], name: "0:20 광장" }, editorInputs[2]] });
  assert.equal(edited.status, "moving");
  assert.equal(edited.currentIndex, 1);
  assert.equal(edited.course[1].scheduledTime, "00:20");
  assert.equal(edited.history[0].placeName, "광장");
  const cleared = logic.updateGroupCourse(edited, { places: [{ ...editorInputs[0], name: "출발지" }, { ...editorInputs[1], name: "광장" }, editorInputs[2]] });
  assert.equal(cleared.course[1].scheduledTime, null);
});
