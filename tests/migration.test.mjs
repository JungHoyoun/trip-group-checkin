import test from "node:test";
import assert from "node:assert/strict";
import { encodeFields, decodeFields, prepareExample } from "../scripts/migrate-events.mjs";
const sourceGroups = Array.from({ length: 20 }, (_, index) => ({
  id: `${Math.floor(index / 4) + 1}-${index % 4 + 1}`, classNo: Math.floor(index / 4) + 1, groupNo: index % 4 + 1,
  leaderName: `original-${index}`, status: "watching", currentIndex: 1,
  course: [{ placeId: "a", name: "출발지", order: 1, scheduledTime: "10:00", requiredCheckpoint: null }, { placeId: "b", name: "광장", order: 2, scheduledTime: "14:00", requiredCheckpoint: "asia_culture_center" }],
  history: [{ placeId: "b", placeName: "광장", type: "arrive", at: "2026-05-01T05:00:00Z", placeIndex: 1, clientActionId: "action" }],
  updatedAt: "2026-05-01T05:00:00Z", lastActionAt: "2026-05-01T05:00:00Z", lastArrivalAt: "2026-05-01T05:00:00Z",
}));
const backup = { format: "firestore-rest-documents-v1", sourceProject: "fieldtrip-1e75c", sourceCollection: "groups", backedUpAtUtc: "2026-10-01T13:58:04Z", documentCount: 20, documents: sourceGroups.map(group => ({ fields: encodeFields(group) })) };
test("example restores all 20 groups, replacing only leader names", () => {
  const before = JSON.stringify(backup);
  const restored = prepareExample(backup);
  assert.equal(restored.event.isExample, true);
  assert.deepEqual(restored.event.classGroupCounts, [4, 4, 4, 4, 4]);
  assert.equal(restored.groups.length, 20);
  for (let index = 0; index < 20; index++) {
    assert.equal(restored.groups[index].leaderName, `예시 모둠장 ${sourceGroups[index].id}`);
    assert.deepEqual({ ...restored.groups[index], leaderName: sourceGroups[index].leaderName }, sourceGroups[index]);
    assert.deepEqual(decodeFields(encodeFields(restored.groups[index])), restored.groups[index]);
  }
  assert.equal(JSON.stringify(backup), before);
});
test("incomplete or wrong-source backups are rejected", () => {
  assert.throws(() => prepareExample({ ...backup, documentCount: 19 }));
  assert.throws(() => prepareExample({ ...backup, sourceProject: "wrong" }));
  assert.throws(() => prepareExample({ ...backup, documents: Array(20).fill(backup.documents[0]) }));
});
