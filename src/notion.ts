/**
 * Notion 어댑터 — 데이터베이스 두 개(학생·수업)를 읽고 쓴다.
 *
 * 속성 이름은 Notion에 보이는 한국어 그대로다 (아래 P 상수).
 * Notion에서 속성 이름을 바꾸면 여기도 같이 고쳐야 한다.
 */

import {
  KINDS,
  TEACHERS,
  hoursToMin,
  minToHours,
  parseDate,
  parseTimeLabel,
  toTimeLabel,
  type Kind,
  type Lesson,
  type LessonInput,
  type Student,
  type StudentInput,
  type Teacher,
} from "./model";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

/** 학생 데이터베이스의 속성 이름. */
const S = {
  name: "이름",
  contact: "연락처",
  total: "총 시간",
  memo: "메모",
} as const;

/** 수업 데이터베이스의 속성 이름. */
const L = {
  title: "수업",
  teacher: "선생님",
  student: "학생",      // 학생 DB를 가리키는 관계형 속성
  studentName: "학생명", // 관계가 끊겨도 시간표가 빈칸이 되지 않게 남기는 사본
  kind: "수업종류",
  date: "날짜",
  start: "시작",
  end: "종료",
  memo: "메모",
} as const;

export interface NotionEnv {
  NOTION_TOKEN?: string;
  NOTION_STUDENT_DB?: string;
  NOTION_LESSON_DB?: string;
}

export class NotionError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function config(env: NotionEnv): { token: string; studentDb: string; lessonDb: string } {
  if (!env.NOTION_TOKEN || !env.NOTION_STUDENT_DB || !env.NOTION_LESSON_DB) {
    throw new NotionError(
      "서버에 NOTION_TOKEN / NOTION_STUDENT_DB / NOTION_LESSON_DB 가 설정되어 있지 않습니다.",
      500,
    );
  }
  return {
    token: env.NOTION_TOKEN,
    studentDb: env.NOTION_STUDENT_DB,
    lessonDb: env.NOTION_LESSON_DB,
  };
}

async function call(
  env: NotionEnv,
  path: string,
  init: { method: string; body?: unknown },
): Promise<any> {
  const { token } = config(env);
  const res = await fetch(NOTION_API + path, {
    method: init.method,
    headers: {
      authorization: "Bearer " + token,
      "notion-version": NOTION_VERSION,
      "content-type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // 통합(integration)이 데이터베이스에 연결되지 않은 것이 가장 흔한 실패라 따로 안내한다
    if (res.status === 404) {
      throw new NotionError(
        "Notion 데이터베이스를 찾을 수 없습니다. 통합이 학생·수업 데이터베이스 양쪽에 연결되어 있는지 확인해 주세요.",
      );
    }
    throw new NotionError("Notion 요청 실패 (" + res.status + ") " + detail.slice(0, 200));
  }
  return res.json();
}

/** 데이터베이스 한 벌을 커서 끝까지 읽는다 (Notion은 한 번에 최대 100건). */
async function queryAll(env: NotionEnv, databaseId: string): Promise<any[]> {
  const rows: any[] = [];
  let cursor: string | undefined;
  do {
    const page: any = await call(env, "/databases/" + databaseId + "/query", {
      method: "POST",
      body: { page_size: 100, start_cursor: cursor },
    });
    rows.push(...(page.results ?? []));
    cursor = page.has_more ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

// ── 속성 읽기/쓰기 ───────────────────────────────

const readText = (prop: any): string | null => {
  const parts = prop?.rich_text ?? prop?.title;
  if (!Array.isArray(parts) || !parts.length) return null;
  const text = parts.map((p: any) => p?.plain_text ?? "").join("").trim();
  return text || null;
};

const writeText = (value: string | null) =>
  value ? { rich_text: [{ text: { content: value } }] } : { rich_text: [] };

const readNumber = (prop: any): number | null =>
  typeof prop?.number === "number" ? prop.number : null;

const readSelect = (prop: any): string | null => prop?.select?.name ?? null;

const readRelationId = (prop: any): string | null => {
  const rel = prop?.relation;
  return Array.isArray(rel) && rel.length ? String(rel[0]?.id ?? "") || null : null;
};

// ── 학생 ────────────────────────────────────────

/** 필수 값(이름)이 비었으면 null — 조용히 건너뛴다. */
function toStudent(page: any): Student | null {
  const props = page?.properties ?? {};
  const name = readText(props[S.name]);
  if (!name) return null;

  return {
    id: page.id,
    name,
    contact: readText(props[S.contact]),
    // 총 시간은 Notion에 '시간' 단위 숫자로 들어 있다 (1.5 = 1시간 30분)
    total_min: hoursToMin(readNumber(props[S.total]) ?? 0),
    memo: readText(props[S.memo]),
  };
}

function studentProperties(student: StudentInput) {
  return {
    [S.name]: { title: [{ text: { content: student.name } }] },
    [S.contact]: writeText(student.contact),
    [S.total]: { number: minToHours(student.total_min) },
    [S.memo]: writeText(student.memo),
  };
}

export async function listStudents(env: NotionEnv): Promise<Student[]> {
  const { studentDb } = config(env);
  const students: Student[] = [];
  for (const row of await queryAll(env, studentDb)) {
    const student = toStudent(row);
    if (student) students.push(student);
  }
  students.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return students;
}

export async function createStudent(env: NotionEnv, student: StudentInput): Promise<string> {
  const { studentDb } = config(env);
  const page: any = await call(env, "/pages", {
    method: "POST",
    body: { parent: { database_id: studentDb }, properties: studentProperties(student) },
  });
  return page.id;
}

export async function updateStudent(
  env: NotionEnv,
  id: string,
  student: StudentInput,
): Promise<void> {
  await call(env, "/pages/" + id, {
    method: "PATCH",
    body: { properties: studentProperties(student) },
  });
}

/** Notion에는 삭제가 없다 — 보관(archive)이 곧 삭제다. */
export async function archiveStudent(env: NotionEnv, id: string): Promise<void> {
  await call(env, "/pages/" + id, { method: "PATCH", body: { archived: true } });
}

// ── 수업 ────────────────────────────────────────

const isTeacher = (v: string | null): v is Teacher => TEACHERS.includes(v as Teacher);
const isKind = (v: string | null): v is Kind => KINDS.includes(v as Kind);

/**
 * 수업 한 건. 필수 값(선생님·학생·종류·날짜·시각)이 비었거나 깨졌으면 null.
 *
 * 학생 이름은 관계형 속성이 가리키는 학생에서 가져오고, 그게 안 되면 `학생명` 사본을 쓴다.
 */
function toLesson(page: any, studentsById: Map<string, Student>): Lesson | null {
  const props = page?.properties ?? {};

  const teacher = readSelect(props[L.teacher]);
  if (!isTeacher(teacher)) return null;

  const kind = readSelect(props[L.kind]);
  if (!isKind(kind)) return null;

  const studentId = readRelationId(props[L.student]);
  if (!studentId) return null;

  const startMin = parseTimeLabel(readText(props[L.start]) ?? "");
  const endMin = parseTimeLabel(readText(props[L.end]) ?? "");
  if (startMin === null || endMin === null || endMin <= startMin) return null;

  const rawDate = props[L.date]?.date?.start;
  const date = rawDate ? String(rawDate).slice(0, 10) : null;
  if (!date || !parseDate(date)) return null;

  const name = studentsById.get(studentId)?.name ?? readText(props[L.studentName]);
  if (!name) return null;

  return {
    id: page.id,
    teacher,
    student_id: studentId,
    student_name: name,
    kind,
    date,
    start_min: startMin,
    end_min: endMin,
    memo: readText(props[L.memo]),
  };
}

function lessonProperties(lesson: LessonInput) {
  return {
    // 제목은 Notion에서 목록을 알아보기 쉬우라고 만들어 넣는다 — 앱은 읽지 않는다
    [L.title]: {
      title: [{ text: { content: lesson.student_name + " · " + lesson.teacher + " " + lesson.kind } }],
    },
    [L.teacher]: { select: { name: lesson.teacher } },
    [L.student]: { relation: [{ id: lesson.student_id }] },
    [L.studentName]: writeText(lesson.student_name),
    [L.kind]: { select: { name: lesson.kind } },
    [L.date]: { date: { start: lesson.date } },
    [L.start]: writeText(toTimeLabel(lesson.start_min)),
    [L.end]: writeText(toTimeLabel(lesson.end_min)),
    [L.memo]: writeText(lesson.memo),
  };
}

export async function listLessons(env: NotionEnv, students: Student[]): Promise<Lesson[]> {
  const { lessonDb } = config(env);
  const byId = new Map(students.map((s) => [s.id, s]));
  const lessons: Lesson[] = [];
  for (const row of await queryAll(env, lessonDb)) {
    const lesson = toLesson(row, byId);
    if (lesson) lessons.push(lesson);
  }
  lessons.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.start_min - b.start_min ||
      TEACHERS.indexOf(a.teacher) - TEACHERS.indexOf(b.teacher),
  );
  return lessons;
}

export async function createLesson(env: NotionEnv, lesson: LessonInput): Promise<string> {
  const { lessonDb } = config(env);
  const page: any = await call(env, "/pages", {
    method: "POST",
    body: { parent: { database_id: lessonDb }, properties: lessonProperties(lesson) },
  });
  return page.id;
}

export async function updateLesson(
  env: NotionEnv,
  id: string,
  lesson: LessonInput,
): Promise<void> {
  await call(env, "/pages/" + id, {
    method: "PATCH",
    body: { properties: lessonProperties(lesson) },
  });
}

export async function archiveLesson(env: NotionEnv, id: string): Promise<void> {
  await call(env, "/pages/" + id, { method: "PATCH", body: { archived: true } });
}
