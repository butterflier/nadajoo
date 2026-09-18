/**
 * 나다주앱 (nadajoo) — 학원 스케줄 관리
 *
 * - 부원장 한 사람이 선생님 4인의 개인수업 시간표를 짜고, 학생별 잔여 시간을 본다.
 * - 원본 데이터는 Notion 데이터베이스 둘(학생·수업). Notion에서 직접 고쳐도 앱에 보인다.
 * - 정적 자산(public/)은 ASSETS 바인딩이 그대로 서빙하고, /api/* 만 이 Worker가 처리한다.
 * - 시간표 앱과 달리 **조회도 잠근다** — 학생 연락처를 다루기 때문이다.
 */

import {
  KINDS,
  TEACHERS,
  balanceOf,
  conflictMessage,
  findConflicts,
  parseBlock,
  parseLesson,
  parseStudent,
  toDurationLabel,
  todayInSeoul,
  type Block,
  type BlockInput,
  type Lesson,
  type LessonInput,
  type Student,
} from "./model";
import {
  NotionError,
  archiveBlock,
  archiveLesson,
  archiveStudent,
  createBlock,
  createLesson,
  createStudent,
  listBlocks,
  listLessons,
  listStudents,
  updateBlock,
  updateLesson,
  updateStudent,
  type NotionEnv,
} from "./notion";

export interface Env extends NotionEnv {
  ASSETS: Fetcher;
  SHARED_PASSWORD?: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const bad = (message: string, status = 400) => json({ error: message }, status);

/** 길이가 달라도 비교 시간이 값에 덜 좌우되도록 한 상수시간 비교. */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const len = Math.max(ea.length, eb.length);
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

/**
 * 조회를 포함한 모든 요청에 비밀번호가 필요하다.
 * 화면은 sessionStorage 에 담아 두고 x-password 헤더로 매번 보낸다.
 */
function checkPassword(env: Env, request: Request, body: Record<string, unknown> | null): string | null {
  const expected = env.SHARED_PASSWORD;
  if (!expected) {
    return "서버에 SHARED_PASSWORD가 설정되어 있지 않습니다. (wrangler secret put SHARED_PASSWORD)";
  }
  const supplied = request.headers.get("x-password") ?? (typeof body?.password === "string" ? body.password : null);
  if (typeof supplied !== "string" || !safeEqual(supplied, expected)) return "비밀번호가 올바르지 않습니다.";
  return null;
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── 조회 캐시 ────────────────────────────────────
//
// Notion API가 초당 3회 제한이고 한 번 그리는 데 쿼리 두 벌이 나간다.
// isolate 안에서 짧게 캐시하되, 이 Worker를 통한 쓰기가 있으면 바로 버린다.

const CACHE_MS = 20_000;
interface Snapshot {
  students: Student[];
  lessons: Lesson[];
  blocks: Block[];
}
let cache: ({ at: number } & Snapshot) | null = null;

async function loadAll(env: Env): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return { students: cache.students, lessons: cache.lessons, blocks: cache.blocks };
  }
  const students = await listStudents(env);
  const lessons = await listLessons(env, students);
  const blocks = await listBlocks(env);
  cache = { at: Date.now(), students, lessons, blocks };
  return { students, lessons, blocks };
}

const dropCache = () => {
  cache = null;
};

// ── 핸들러 ──────────────────────────────────────

/** 화면이 그릴 데이터 한 벌. 학생에는 계산된 잔여 시간을 붙여 보낸다. */
async function handleData(env: Env): Promise<Response> {
  const { students, lessons, blocks } = await loadAll(env);
  const today = todayInSeoul();
  return json({
    today,
    teachers: TEACHERS,
    kinds: KINDS,
    students: students.map((s) => ({ ...s, balance: balanceOf(s, lessons, today) })),
    lessons,
    blocks,
  });
}

/** 잔여 시간이 모자라면 막지는 않고 알려만 준다 — 판단은 부원장이 한다. */
function shortageWarning(
  studentId: string,
  addedMin: number,
  students: Student[],
  lessons: Lesson[],
  today: string,
): string | null {
  const student = students.find((s) => s.id === studentId);
  if (!student) return null;
  const left = balanceOf(student, lessons, today).remaining_min;
  if (addedMin <= left) return null;
  return (
    student.name + " 학생의 잔여 시간이 모자랍니다 — 잔여 " +
    toDurationLabel(Math.max(left, 0)) + ", 이 수업 " + toDurationLabel(addedMin) + "."
  );
}

/**
 * 수업 등록/수정 공통. 겹치면 409로 되돌려 보내고, 화면이 다시 물어본 뒤
 * force 를 달아 보내면 그때 진행한다.
 *
 *  - 학생 겹침: 그 학생이 같은 시간에 이미 잡혀 있다 → force 면 기존 것을 지우고 옮겨온다
 *  - 선생님 겹침: 그 선생님이 같은 시간에 이미 다른 학생을 받고 있다 → force 면 둘 다 남긴다
 */
async function saveLesson(
  env: Env,
  body: Record<string, unknown>,
  existingId: string | null,
): Promise<Response> {
  const { students, lessons, blocks } = await loadAll(env);

  const parsed = parseLesson(body, students);
  if (typeof parsed === "string") return bad(parsed);

  const force = body.force === true;
  const conflicts = findConflicts(parsed, lessons, blocks, existingId ?? undefined);

  // 정규수업이나 휴가가 깔려 있는 시간 — 학생 겹침보다 먼저 알려 준다
  if (!force && conflicts.blocked) {
    const b = conflicts.blocked;
    return json(
      {
        conflict: {
          type: "blocked",
          message:
            (b.teacher ? b.teacher + "T는 " : "") +
            "수업을 넣을 수 없는 시간입니다. 그래도 등록할까요?",
          existing: b,
        },
      },
      409,
    );
  }

  if (!force && conflicts.student) {
    return json(
      {
        conflict: {
          type: "student",
          message: conflictMessage(conflicts.student),
          existing: conflicts.student,
        },
      },
      409,
    );
  }
  if (!force && conflicts.teacher) {
    return json(
      {
        conflict: {
          type: "teacher",
          message:
            conflicts.teacher.teacher + " 선생님은 그 시간에 " + conflicts.teacher.student_name +
            " 학생 수업이 있습니다. 그래도 등록할까요?",
          existing: conflicts.teacher,
        },
      },
      409,
    );
  }

  // 학생 겹침을 확인받고 진행하는 경우 = 옮겨오기. 기존 등록을 지운다.
  const moved = force && conflicts.student ? conflicts.student : null;
  if (moved) await archiveLesson(env, moved.id);

  // 경고는 방금 옮겨온/수정 중인 수업을 뺀 나머지 기준으로 센다
  const others = lessons.filter((l) => l.id !== existingId && l.id !== moved?.id);
  const warning = shortageWarning(
    parsed.student_id,
    parsed.end_min - parsed.start_min,
    students,
    others,
    todayInSeoul(),
  );

  let id = existingId;
  if (existingId) await updateLesson(env, existingId, parsed as LessonInput);
  else id = await createLesson(env, parsed as LessonInput);

  dropCache();
  return json({ id, moved: moved?.id ?? null, warning });
}

/**
 * 수업불가 저장. 이미 잡혀 있는 수업 위에 깔면 알려만 주고, 확인하면 그대로 깐다
 * — 정규수업이 잡힌 걸 앱이 멋대로 지우면 안 된다.
 */
async function saveBlock(
  env: Env,
  body: Record<string, unknown>,
  existingId: string | null,
): Promise<Response> {
  const parsed = parseBlock(body);
  if (typeof parsed === "string") return bad(parsed);

  if (body.force !== true) {
    const { lessons } = await loadAll(env);
    const hit = lessons.filter(
      (l) =>
        (parsed.teacher === null || l.teacher === parsed.teacher) &&
        l.date === parsed.date &&
        l.start_min < parsed.end_min &&
        parsed.start_min < l.end_min,
    );
    if (hit.length) {
      return json(
        {
          conflict: {
            type: "lessons-under",
            message:
              "그 시간에 이미 수업이 " + hit.length + "건 있습니다 (" +
              hit.map((l) => l.student_name).join(", ") + "). 그래도 수업불가로 둘까요?",
            count: hit.length,
          },
        },
        409,
      );
    }
  }

  let id = existingId;
  if (existingId) await updateBlock(env, existingId, parsed as BlockInput);
  else id = await createBlock(env, parsed as BlockInput);

  dropCache();
  return json({ id });
}

async function saveStudent(
  env: Env,
  body: Record<string, unknown>,
  existingId: string | null,
): Promise<Response> {
  const parsed = parseStudent(body);
  if (typeof parsed === "string") return bad(parsed);

  let id = existingId;
  if (existingId) await updateStudent(env, existingId, parsed);
  else id = await createStudent(env, parsed);

  dropCache();
  return json({ id });
}

/** 학생을 지울 때, 그 학생의 수업이 남아 있으면 먼저 알려 준다. */
async function removeStudent(env: Env, id: string, force: boolean): Promise<Response> {
  const { lessons } = await loadAll(env);
  const mine = lessons.filter((l) => l.student_id === id);
  if (mine.length && !force) {
    return json(
      {
        conflict: {
          type: "student-lessons",
          message: "등록된 수업이 " + mine.length + "건 있습니다. 수업까지 함께 지울까요?",
          count: mine.length,
        },
      },
      409,
    );
  }
  for (const lesson of mine) await archiveLesson(env, lesson.id);
  await archiveStudent(env, id);
  dropCache();
  return json({ ok: true, removed_lessons: mine.length });
}

// Notion 페이지 ID는 하이픈이 있을 수도, 없을 수도 있다
const ID_RE = "([0-9a-fA-F-]{32,36})";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const method = request.method;
    const body = method === "GET" || method === "HEAD" ? null : await readBody(request);

    const authError = checkPassword(env, request, body);
    if (authError) return bad(authError, 401);

    try {
      // 비밀번호만 확인하고 끝 — 화면의 잠금 해제에 쓴다
      if (url.pathname === "/api/login" && method === "POST") return json({ ok: true });

      if (url.pathname === "/api/data" && method === "GET") return await handleData(env);

      if (url.pathname === "/api/students") {
        if (method === "POST") return await saveStudent(env, body ?? {}, null);
        return bad("허용되지 않는 메서드입니다.", 405);
      }
      const student = url.pathname.match(new RegExp("^/api/students/" + ID_RE + "$"));
      if (student) {
        if (method === "PUT") return await saveStudent(env, body ?? {}, student[1]);
        if (method === "DELETE") return await removeStudent(env, student[1], body?.force === true);
        return bad("허용되지 않는 메서드입니다.", 405);
      }

      if (url.pathname === "/api/blocks") {
        if (method === "POST") return await saveBlock(env, body ?? {}, null);
        return bad("허용되지 않는 메서드입니다.", 405);
      }
      const block = url.pathname.match(new RegExp("^/api/blocks/" + ID_RE + "$"));
      if (block) {
        if (method === "PUT") return await saveBlock(env, body ?? {}, block[1]);
        if (method === "DELETE") {
          await archiveBlock(env, block[1]);
          dropCache();
          return json({ ok: true });
        }
        return bad("허용되지 않는 메서드입니다.", 405);
      }

      if (url.pathname === "/api/lessons") {
        if (method === "POST") return await saveLesson(env, body ?? {}, null);
        return bad("허용되지 않는 메서드입니다.", 405);
      }
      const lesson = url.pathname.match(new RegExp("^/api/lessons/" + ID_RE + "$"));
      if (lesson) {
        if (method === "PUT") return await saveLesson(env, body ?? {}, lesson[1]);
        if (method === "DELETE") {
          await archiveLesson(env, lesson[1]);
          dropCache();
          return json({ ok: true });
        }
        return bad("허용되지 않는 메서드입니다.", 405);
      }

      return bad("없는 경로입니다.", 404);
    } catch (err) {
      if (err instanceof NotionError) return bad(err.message, err.status);
      console.error(err);
      return bad("서버 오류가 발생했습니다.", 500);
    }
  },
} satisfies ExportedHandler<Env>;
