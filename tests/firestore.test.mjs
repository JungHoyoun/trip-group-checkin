import test from "node:test";
import assert from "node:assert/strict";
import { encodeFields } from "../scripts/migrate-events.mjs";
const host = process.env.FIRESTORE_EMULATOR_HOST;
const base = `http://${host}/v1/projects/demo-trip-checkin/databases/(default)/documents`;
const token = uid => `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: uid, user_id: uid, aud: "demo-trip-checkin", iss: "https://securetoken.google.com/demo-trip-checkin", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, firebase: { sign_in_provider: "password" } })).toString("base64url")}.`;
const request = async (path, method = "GET", value, admin = false, credential = token("test-teacher")) => fetch(`${base}/${path}`, {
  method, headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer owner" } : credential ? { Authorization: `Bearer ${credential}` } : {}) },
  ...(value ? { body: JSON.stringify({ fields: encodeFields(value) }) } : {}),
});
const event = id => ({ id, name: id, classGroupCounts: [2, 4], createdAt: "2026-10-01T00:00:00Z", isExample: false });
const group = { id: "1-1", classNo: 1, groupNo: 1, leaderName: "테스트", course: [], history: [], status: "ready", currentIndex: 0 };

test("Firestore rules enforce event boundaries and readonly examples", { skip: !host }, async () => {
  assert.equal((await request("locationConfig/access", "PATCH", { teacherUids: ["test-teacher"] }, true)).status, 200);
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
  assert.equal((await request(`events/${a}`, "PATCH", { ...event(a), name: "changed" })).status, 200);
  for (const name of ["", "x".repeat(81)]) assert.equal((await request(`events/${a}`, "PATCH", { ...event(a), name })).status, 403);
  assert.equal((await request(`events/${a}`, "PATCH", { ...event(a), createdAt: "changed" })).status, 403);
  assert.equal((await request(`events/${a}/groups/1-1`, "DELETE")).status, 200);
  assert.equal((await request(`events/${b}/groups/1-1`)).status, 200);
  assert.equal((await request(`groups/${prefix}`, "PATCH", group, true)).status, 200);
  assert.equal((await request(`groups/${prefix}`, "PATCH", group)).status, 403);
  assert.equal((await request(`groups/${prefix}`, "DELETE")).status, 403);
  const edited = { ...event(a), classGroupCounts: [3, 1, 2], defaultGroupCount: 2 };
  assert.equal((await request(`events/${a}`, "PATCH", edited)).status, 200);
  assert.equal((await request(`events/${a}/groups/3-1`, "PATCH", { ...group, id: "3-1", classNo: 3 })).status, 200);
  assert.equal((await request(`events/${a}/groups/2-2`, "PATCH", { ...group, id: "2-2", classNo: 2, groupNo: 2 })).status, 403);
  for (const patch of [{ ...edited, defaultGroupCount: 0 }, { ...edited, classGroupCounts: [31] }]) {
    assert.equal((await request(`events/${a}`, "PATCH", patch)).status, 403);
  }
  assert.equal((await request(`events/${demo}`, "PATCH", { ...event(demo), isExample: true, classGroupCounts: [1] })).status, 403);
  const deletedAt = "2026-10-02T00:00:00Z";
  assert.equal((await request(`events/${demo}`, "PATCH", { ...event(demo), isExample: true, deletedAt })).status, 403);
  assert.equal((await request(`events/${b}`, "PATCH", { ...event(b), deletedAt })).status, 200);
  assert.equal((await request(`events/${b}/groups/1-1`)).status, 403);
  assert.equal((await request(`events/${b}/groups/1-1`, "PATCH", group)).status, 403);
  assert.equal((await request(`events/${b}`, "PATCH", event(b))).status, 403);
  assert.equal((await request(`events/${b}`, "PATCH", { ...event(b), deletedAt, classGroupCounts: [1] })).status, 403);
  assert.equal((await request(`events/${a}`)).status, 200);
  assert.equal((await request("events/legacy-fieldtrip", "PATCH", event("legacy-fieldtrip"), true)).status, 200);
  assert.equal((await request("events/legacy-fieldtrip/groups/1-1", "PATCH", group)).status, 200);
  assert.equal((await request("events/legacy-fieldtrip", "PATCH", { ...event("legacy-fieldtrip"), deletedAt })).status, 200);
  assert.equal((await request("events/legacy-fieldtrip/groups/1-1")).status, 403);
  assert.equal((await request("events/legacy-fieldtrip/groups/1-1", "PATCH", group)).status, 403);
  assert.equal((await request("events/legacy-fieldtrip/groups/1-1", "GET", undefined, true)).status, 200);

});

test("location privacy, invite isolation and three-minute write limit", { skip: !host }, async () => {
  await request("locationConfig/access", "PATCH", { teacherUids: ["test-teacher"] }, true);
  const id = `location-${Date.now()}`, inviteId = "a".repeat(32), student = token("student-a"), other = token("student-b");
  assert.equal((await request(`events/${id}`, "PATCH", event(id), false, null)).status, 403);
  assert.equal((await request(`events/${id}`, "PATCH", event(id))).status, 200);
  const invite = { classNo: 1, groupNo: 1, active: true };
  assert.equal((await request(`events/${id}/locationInvites/${inviteId}`, "PATCH", invite, false, student)).status, 403);
  assert.equal((await request(`events/${id}/locationInvites/${inviteId}`, "PATCH", invite)).status, 200);
  assert.equal((await request(`events/${id}/locationInvites/${inviteId}`, "GET", undefined, false, null)).status, 403);
  assert.equal((await request(`events/${id}/locationInvites/${inviteId}`, "GET", undefined, false, student)).status, 200);
  assert.equal((await request(`events/${id}/locationInvites`, "GET", undefined, false, student)).status, 403);
  const point = { ...invite, latitude: 35.15, longitude: 126.85, accuracy: 20, measuredAt: Date.now(), publisherUid: "student-a", inviteId };
  delete point.active;
  const publish = async (record, groupId = "1-1", credential = student) => fetch(`${base}:commit`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential}` },
    body: JSON.stringify({ writes: [{ update: { name: `projects/demo-trip-checkin/databases/(default)/documents/events/${id}/locations/${groupId}`, fields: encodeFields(record) }, updateTransforms: [{ fieldPath: "receivedAt", setToServerValue: "REQUEST_TIME" }] }] }),
  });
  assert.equal((await publish(point)).status, 200);
  assert.equal((await publish(point)).status, 403);
  assert.equal((await publish({ ...point, publisherUid: "student-b" }, "1-1", other)).status, 403);
  assert.equal((await publish({ ...point, groupNo: 2 }, "1-2")).status, 403);
  assert.equal((await request(`events/${id}/locations/1-1`, "GET", undefined, false, null)).status, 403);
  assert.equal((await request(`events/${id}/locations/1-1`, "GET", undefined, false, student)).status, 403);
  assert.equal((await request(`events/${id}/locations/1-1`)).status, 200);
  assert.equal((await request(`events/${id}/locations/1-1`, "DELETE", undefined, false, other)).status, 403);
  assert.equal((await request(`events/${id}/locations/1-1`, "DELETE", undefined, false, student)).status, 200);
  assert.equal((await publish({ ...point, latitude: 91 })).status, 403);
  assert.equal((await publish({ ...point, measuredAt: Date.now() - 600000 })).status, 403);
  await request(`events/${id}/locationInvites/${inviteId}`, "PATCH", { ...invite, active: false });
  assert.equal((await publish(point)).status, 403);
});
