import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, relative, isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

export function decodeValue(value) {
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ("mapValue" in value) return decodeFields(value.mapValue.fields ?? {});
  throw new Error("지원하지 않는 Firestore 필드 형식입니다.");
}
export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
}
export function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(value) } };
}
export function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}
function groupsFromDocuments(documents, anonymize) {
  return documents.map(document => {
    const group = decodeFields(document.fields);
    if (!Number.isInteger(group.classNo) || !Number.isInteger(group.groupNo) || group.classNo < 1 || group.classNo > 30 || group.groupNo < 1 || group.groupNo > 30 || group.id !== `${group.classNo}-${group.groupNo}` || !Array.isArray(group.course) || !Array.isArray(group.history)) throw new Error("백업 모둠 정보가 올바르지 않습니다.");
    return { ...group, ...(anonymize ? { leaderName: `예시 모둠장 ${group.classNo}-${group.groupNo}` } : {}) };
  });
}
export function prepareExample(backup) {
  if (backup.format !== "firestore-rest-documents-v1" || backup.sourceProject !== "fieldtrip-1e75c" || backup.sourceCollection !== "groups" || backup.documentCount !== 20 || backup.documents?.length !== 20) throw new Error("예시 백업의 출처와 20개 모둠을 확인해 주세요.");
  const groups = groupsFromDocuments(backup.documents, true);
  const ids = new Set(groups.map(group => group.id));
  if (ids.size !== 20 || groups.some(group => group.classNo > 5 || group.groupNo > 4)) throw new Error("예시의 5개 반, 4개 모둠 구성이 일치하지 않습니다.");
  return { event: { id: "example-fieldtrip", name: "예시 체험학습", classGroupCounts: [4, 4, 4, 4, 4], createdAt: backup.backedUpAtUtc, isExample: true }, groups };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => args[args.indexOf(name) + 1];
  const project = args.includes("--project") ? option("--project") : "fieldtrip-1e75c";
  if (project !== "fieldtrip-1e75c" && !project.startsWith("demo-")) throw new Error("대상 프로젝트를 확인해 주세요.");
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const base = `${emulator ? `http://${emulator}` : "https://firestore.googleapis.com"}/v1/projects/${project}/databases/(default)/documents`;
  const auth = emulator ? "owner" : process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  const headers = { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) };
  const request = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers });
    if (!response.ok) throw new Error(`Firestore 요청 실패: HTTP ${response.status}`);
    return response.json();
  };
  if (args.includes("--prepare")) {
    if (!args.includes("--backup")) throw new Error("--backup으로 원본 JSON 경로를 지정해 주세요.");
    const out = resolve(args.includes("--output-dir") ? option("--output-dir") : join(process.env.USERPROFILE, "Backups", "trip-group-checkin"));
    const repo = fileURLToPath(new URL("../", import.meta.url));
    const rel = relative(repo, out);
    if (!rel.startsWith("..") && !isAbsolute(rel)) throw new Error("백업과 복원 계획은 저장소 밖에 저장해 주세요.");
    if (out.toLowerCase().startsWith("g:")) throw new Error("원본 데이터는 Drive에 저장하지 않습니다.");
    await mkdir(out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const documents = [];
    let pageToken = "";
    do {
      const page = await request(`${base}/groups?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      documents.push(...(page.documents ?? [])); pageToken = page.nextPageToken ?? "";
    } while (pageToken);
    const legacyBackup = { format: "firestore-rest-documents-v1", sourceProject: project, sourceDatabase: "(default)", sourceCollection: "groups", backedUpAtUtc: new Date().toISOString(), documentCount: documents.length, documents };
    const legacyPath = join(out, `legacy-groups-${stamp}.json`);
    await writeFile(legacyPath, JSON.stringify(legacyBackup, null, 2), { flag: "wx" });
    const verified = JSON.parse(await readFile(legacyPath, "utf8"));
    if (JSON.stringify(verified.documents) !== JSON.stringify(documents)) throw new Error("백업 검증 실패");
    const example = prepareExample(JSON.parse(await readFile(resolve(option("--backup")), "utf8")));
    const events = [example];
    if (documents.length) {
      const groups = groupsFromDocuments(documents, false);
      const classGroupCounts = Array(Math.max(5, ...groups.map(group => group.classNo))).fill(4);
      for (const group of groups) classGroupCounts[group.classNo - 1] = Math.max(classGroupCounts[group.classNo - 1], group.groupNo);
      events.push({ event: { id: "legacy-fieldtrip", name: "기존 체험학습", classGroupCounts, createdAt: new Date().toISOString(), isExample: false }, groups });
    }
    const manifestPath = join(out, `event-migration-${stamp}.json`);
    await writeFile(manifestPath, JSON.stringify({ project, legacyBackup: legacyPath, events }, null, 2), { flag: "wx" });
    console.log(JSON.stringify({ manifestPath, legacyBackup: legacyPath, legacyGroups: documents.length, exampleGroups: example.groups.length }));
    return;
  }
  if (args.includes("--apply")) {
    if (!auth) throw new Error("운영 복원은 GOOGLE_OAUTH_ACCESS_TOKEN 환경변수의 관리 권한 인증이 필요합니다.");
    const manifest = JSON.parse(await readFile(resolve(option("--manifest")), "utf8"));
    if (manifest.project !== project) throw new Error("복원 계획의 대상 프로젝트가 일치하지 않습니다.");
    for (const item of manifest.events) {
      const eventName = `projects/${project}/databases/(default)/documents/events/${item.event.id}`;
      const existing = await fetch(`${base}/events/${item.event.id}`, { headers });
      if (existing.ok) throw new Error("동일한 행사 ID가 이미 존재합니다. 덮어쓰지 않습니다.");
      if (existing.status !== 404) throw new Error(`행사 조회 실패: HTTP ${existing.status}`);
      const updates = [{ name: eventName, fields: encodeFields(item.event) }, ...item.groups.map(group => ({ name: `${eventName}/groups/${group.id}`, fields: encodeFields(group) }))];
      for (let offset = 0; offset < updates.length; offset += 500) {
        await request(`${base}:commit`, { method: "POST", body: JSON.stringify({ writes: updates.slice(offset, offset + 500).map(update => ({ update, currentDocument: { exists: false } })) }) });
      }
      for (const update of updates) {
        const saved = await request(`${emulator ? `http://${emulator}` : "https://firestore.googleapis.com"}/v1/${update.name}`);
        if (!isDeepStrictEqual(decodeFields(saved.fields), decodeFields(update.fields))) throw new Error("복원 문서 검증 실패");
      }
    }
    console.log(JSON.stringify({ appliedEvents: manifest.events.length, verified: true }));
    return;
  }
  throw new Error("--prepare 또는 --apply를 지정해 주세요.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
