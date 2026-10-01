import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(new URL("../src/lib/locationLogic.ts", import.meta.url), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { LOCATION_INTERVAL_MS, validCoordinates, isStale, locationLabel } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
test("location uses a three-minute interval and marks missed updates", () => {
  assert.equal(LOCATION_INTERVAL_MS, 180000);
  const location = { measuredAt: 1000000, accuracy: 25.4 };
  assert.equal(isStale(location, 1359999), false);
  assert.equal(isStale(location, 1360000), true);
  assert.equal(locationLabel(location, 1180000), "3분 전 · 오차 ±25m");
});
test("GPS rejects invalid coordinates and accuracy", () => {
  assert.equal(validCoordinates(35.1, 126.8, 20), true);
  for (const value of [[91, 126, 10], [35, -181, 10], [35, 126, -1], [NaN, 126, 10], [35, Infinity, 10]]) assert.equal(validCoordinates(...value), false);
});
