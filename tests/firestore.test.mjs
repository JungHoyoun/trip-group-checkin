import test from "node:test";
import assert from "node:assert/strict";
import { encodeFields } from "../scripts/migrate-events.mjs";
const host = process.env.FIRESTORE_EMULATOR_HOST;
const base = `http://${host}/v1/projects/demo-trip-checkin/databases/(default)/documents`;
const request = async (path, method = "GET", value, admin = false) => fetch(`${base}/${path}`, {
  method, headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : {}) },
  ...(value ? { body: JSON.stringify({ fields: encodeFields(value) }) } : {}),
});
const event = id => ({ id, name: id, classGroupCounts: [2, 4], createdAt: "2026-10-01T00:00:00Z", isExample: false });
const group = { id: "1-1", classNo: 1, groupNo: 1, leaderName: "테스트", course: [], history: [], status: "ready", currentIndex: 0 };

test("Firestore rules enforce event boundaries and readonly examples", { skip: !host }, async () => {
  const prefix = `rules-${Date.now()}`;
  const a = `${prefix}-a`, b = `${prefix}-b`, demo = `${prefix}-example`;
  assert.equal((await request(`events/${a}`, "PATCH", event(a))).status, 200);
  assert.equal((await request(`events/${b}`, "PATCH", event(b))).status, 200);
  for (const counts of [[0], [31], [1.5], Array(31).fill(1)]) {
    const id = `${prefix}-bad-${Math.random()}`;
    assert.equal((await request(`events/${id}`, "PATCH", { ...event(id), classGroupCounts: counts })).status, 403);
  }
  assert.equal((await request(`events/${demo}`, "PATCH", { ...event(demo), isExample: true })).status, 403);
  assert.equal((await request(`events/${demo}`, "PATCH", { ...event(demo), isExample: true }, true)).status, 200);
  assert.equal((await request(`events/${demo}/groups/1-1`, "PATCH", group, true)).status, 200);
  assert.equal((await request(`events/${demo}/groups/1-1`)).status, 200);
  assert.equal((await request(`events/${demo}/groups/1-1`, "PATCH", { ...group, leaderName: "change" })).status, 403);
  assert.equal((await request(`events/${demo}/groups/1-2`, "PATCH", { ...group, id: "1-2", groupNo: 2 })).status, 403);
  assert.equal((await request(`events/${demo}/groups/1-1`, "DELETE")).status, 403);
  assert.equal((await request(`events/${demo}`, "PATCH", { ...event(demo), isExample: false })).status, 403);
  for (const id of [a, b]) assert.equal((await request(`events/${id}/groups/1-1`, "PATCH", group)).status, 200);
  assert.equal((await request(`events/${a}/groups/1-3`, "PATCH", { ...group, id: "1-3", groupNo: 3 })).status, 403);
  assert.equal((await request(`events/${a}/groups/3-1`, "PATCH", { ...group, id: "3-1", classNo: 3 })).status, 403);
  assert.equal((await request(`events/${a}/groups/1-2`, "PATCH", group)).status, 403);
  assert.equal((await request(`events/missing-${prefix}/groups/1-1`, "PATCH", group)).status, 403);
  assert.equal((await request(`events/${a}`, "PATCH", { ...event(a), name: "changed" })).status, 403);
  assert.equal((await request(`events/${a}/groups/1-1`, "DELETE")).status, 200);
  assert.equal((await request(`events/${b}/groups/1-1`)).status, 200);
  assert.equal((await request(`groups/${prefix}`, "PATCH", group, true)).status, 200);
  assert.equal((await request(`groups/${prefix}`, "PATCH", group)).status, 403);
  assert.equal((await request(`groups/${prefix}`, "DELETE")).status, 403);
});
