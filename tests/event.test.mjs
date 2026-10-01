import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const source = await readFile(new URL("../src/lib/eventLogic.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022 } });
const logic = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("event configuration accepts different group counts per class", () => {
  assert.deepEqual(logic.validateEventInput({ name: " 체험학습 ", classGroupCounts: [2, 4, 1] }), { name: "체험학습", classGroupCounts: [2, 4, 1] });
  assert.equal(logic.validGroup({ classGroupCounts: [2, 4, 1] }, 2, 4), true);
  for (const [classNo, groupNo] of [[0, 1], [4, 1], [1, 3], [2, 0], [1.5, 1]]) assert.equal(logic.validGroup({ classGroupCounts: [2, 4, 1] }, classNo, groupNo), false);
});

test("configuration rejects invalid and out-of-range counts", () => {
  for (const counts of [[], [0], [31], [1.5], [NaN], Array(31).fill(1)]) assert.throws(() => logic.validateEventInput({ name: "행사", classGroupCounts: counts }));
  assert.throws(() => logic.validateEventInput({ name: " ", classGroupCounts: [1] }));
  assert.throws(() => logic.validateEventInput({ name: "x".repeat(81), classGroupCounts: [1] }));
  assert.doesNotThrow(() => logic.validateEventInput({ name: "행사", classGroupCounts: Array(30).fill(30) }));
});

test("student sessions, groups and offline queues are scoped to the event and v5", () => {
  for (const suffix of ["student-session", "last-student", "groups", "pending-1-1"]) {
    assert.notEqual(logic.eventStorageKey("event-a", suffix), logic.eventStorageKey("event-b", suffix));
    assert.match(logic.eventStorageKey("event-a", suffix), /^trip-checkin-v5-/);
  }
});

test("route IDs cannot address nested documents", () => {
  for (const id of ["example-fieldtrip", "1dad141c-79e7-4259-b0f0-e5ff54c74432"]) assert.equal(logic.validEventId(id), true);
  for (const id of ["", "event/groups/1-1", "../event", "x".repeat(129)]) assert.equal(logic.validEventId(id), false);
});
