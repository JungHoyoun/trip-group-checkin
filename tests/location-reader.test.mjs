import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const subscriptions = [];
globalThis.__locationSubscriptions = subscriptions;
const firestore = moduleUrl(`
  export const doc = (_, ...path) => path.join('/');
  export function onSnapshot(path, options, next, error) {
    const subscription = { path, options, next, error, stopped: false };
    globalThis.__locationSubscriptions.push(subscription);
    return () => { subscription.stopped = true; };
  }
  export const collection = () => {}, deleteDoc = () => {}, getDocFromServer = () => {},
    runTransaction = () => {}, setDoc = () => {}, serverTimestamp = () => {}, writeBatch = () => {};
`);
const source = (await readFile(new URL("../src/lib/locationStore.ts", import.meta.url), "utf8"))
  .replace('"firebase/auth"', JSON.stringify(import.meta.resolve("firebase/auth")))
  .replace('"firebase/firestore"', JSON.stringify(firestore))
  .replace('"./groupStore"', JSON.stringify(moduleUrl('export const getDb = () => ({});')))
  .replace('"./teacherCode"', JSON.stringify(moduleUrl('export const teacherPasswordFromCode = () => "unused";')));
const { watchLocation } = await import(moduleUrl(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText));
const snapshot = (value, fromCache) => ({ exists: () => value !== null, data: () => value, metadata: { fromCache } });

test("an empty cache waits for the server instead of erasing a group's location", () => {
  const received = [];
  const stop = watchLocation("trip-a", "1-1", value => received.push(value), assert.fail);
  const subscription = subscriptions.at(-1);
  assert.equal(subscription.options.includeMetadataChanges, true);
  subscription.next(snapshot(null, true));
  assert.deepEqual(received, []);
  const point = { classNo: 1, groupNo: 1, latitude: 37, longitude: 127 };
  subscription.next(snapshot(point, false));
  subscription.next(snapshot(null, true));
  assert.deepEqual(received, [point]);
  subscription.next(snapshot(null, false));
  assert.deepEqual(received, [point, null]);
  stop();
  assert.equal(subscription.stopped, true);
});

test("cached locations and identical group numbers stay attached to their event", () => {
  const a = [], b = [];
  const stopA = watchLocation("trip-a", "1-1", value => a.push(value), assert.fail);
  const subscriptionA = subscriptions.at(-1);
  const stopB = watchLocation("trip-b", "1-1", value => b.push(value), assert.fail);
  const subscriptionB = subscriptions.at(-1);
  assert.equal(subscriptionA.path, "events/trip-a/locations/1-1");
  assert.equal(subscriptionB.path, "events/trip-b/locations/1-1");
  subscriptionA.next(snapshot({ latitude: 37 }, true));
  subscriptionB.next(snapshot({ latitude: 35 }, false));
  assert.deepEqual(a, [{ latitude: 37 }]);
  assert.deepEqual(b, [{ latitude: 35 }]);
  stopA(); stopB();
});
