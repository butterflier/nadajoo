/**
 * 나다주앱의 순수 로직.
 *
 * 저장소(Notion)나 화면에 의존하지 않는다 — 어댑터와 라우터가 이 타입을 주고받는다.
 * 같은 규칙이 public/index.html 에도 복제돼 있다. 한쪽만 고치면 화면과 저장이 어긋난다.
 */

/** 이 학원의 선생님. 늘리거나 이름을 바꾸려면 여기 한 줄만 고친다. */
export const TEACHERS = ["타카하시", "가와구치", "김혜진", "스도", "표지연"] as const;
export type Teacher = (typeof TEACHERS)[number];

/** 수업종류. 겹침 안내 문구에 그대로 들어간다. */
export const KINDS = ["본고사", "면접", "지유서"] as const;
export type Kind = (typeof KINDS)[number];

/** 요일 인덱스는 월=0 … 일=6. JS Date.getDay()(일=0)와 다르니 항상 변환해서 쓴다. */
export const DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

/** 모든 시각의 기준 시간대. "오늘"을 정하는 데도 쓴다. */
export const TIME_ZONE = "Asia/Seoul";

/** 격자가 그리는 범위 — 08:00 부터 24:00 까지, 30분 단위. */
export const DAY_START_MIN = 8 * 60;
export const DAY_END_MIN = 24 * 60;
export const SLOT_MIN = 30;

/** 격자 빈 칸을 눌렀을 때 기본으로 잡히는 수업 길이. */
export const DEFAULT_DURATION_MIN = 120;

export interface Student {
  id: string;          // Notion 페이지 ID
  name: string;
  contact: string | null;
  total_min: number;   // 등록한 개인수업 총 시간 (분)
  memo: string | null;
}

export interface Lesson {
  id: string;          // Notion 페이지 ID
  teacher: Teacher;
  student_id: string;
  student_name: string; // 표시용 사본 — 학생이 지워져도 시간표가 빈칸이 되지 않게 남긴다
  kind: Kind;
  date: string;        // YYYY-MM-DD (이 앱의 수업은 전부 하루짜리다)
  start_min: number;   // 자정 기준 분
  end_min: number;
  content: string | null; // 무슨 수업인지 한 줄 — 블록 아래칸에 그대로 나온다
  memo: string | null;
}

/** 저장 직전의 값 — 아직 ID가 없다. */
export type StudentInput = Omit<Student, "id">;
export type LessonInput = Omit<Lesson, "id">;

// ── 시각 ────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 24:00 을 00:00 으로 되돌리지 않는다 — 종료 시각으로 쓰이기 때문이다. */
export const toTimeLabel = (min: number) => pad2(Math.floor(min / 60)) + ":" + pad2(min % 60);

export function parseTimeLabel(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 24 || mm > 59) return null;
  const min = h * 60 + mm;
  return min <= 1440 ? min : null;
}

/** 분을 "1시간 30분" 꼴로. 0이면 "0분". */
export function toDurationLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h && m) return h + "시간 " + m + "분";
  if (h) return h + "시간";
  return m + "분";
}

/** 분을 시간 단위 숫자로 (Notion 숫자 속성에 그대로 들어간다). 1.5 처럼 소수가 나온다. */
export const minToHours = (min: number) => Math.round((min / 60) * 100) / 100;
export const hoursToMin = (hours: number) => Math.round(hours * 60);

// ── 날짜 ────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 를 UTC 자정 Date 로. 형식이 틀리거나 실재하지 않는 날짜면 null. */
export function parseDate(value: string): Date | null {
  if (!DATE_RE.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  // 2026-02-30 처럼 넘어가 버리는 날짜를 걸러낸다
  return d.toISOString().slice(0, 10) === value ? d : null;
}

export const toDateLabel = (d: Date) => d.toISOString().slice(0, 10);

/** 월=0 … 일=6. JS의 일=0과 다르다. */
export const dowOf = (d: Date): number => (d.getUTCDay() + 6) % 7;

export function addDays(label: string, days: number): string {
  const d = parseDate(label);
  if (!d) return label;
  d.setUTCDate(d.getUTCDate() + days);
  return toDateLabel(d);
}

/** 그 날짜가 속한 주의 월요일. */
export function weekStartOf(label: string): string {
  const d = parseDate(label);
  if (!d) return label;
  return addDays(label, -dowOf(d));
}

/** 서울 기준 오늘. 잔여시간 차감이 이 값을 기준으로 갈린다. */
export function todayInSeoul(now: Date = new Date()): string {
  // en-CA 로케일이 YYYY-MM-DD 를 준다
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
}

// ── 잔여시간 ────────────────────────────────────────

export interface Balance {
  total_min: number;
  used_min: number;      // 이미 차감된 분 (수업일 00:00 이 지난 수업)
  planned_min: number;   // 아직 차감 전인 분 (앞으로의 수업)
  remaining_min: number; // total - used. 음수일 수 있다 — 초과 등록을 숨기지 않는다
}

/**
 * 잔여시간은 저장하지 않고 매번 계산한다.
 *
 * "수업일 00시 00분에 차감" = 수업 날짜가 오늘 이하이면 이미 쓴 것으로 본다.
 * 등록하는 순간 차감하는 쪽으로 바꾸고 싶으면 아래 비교 한 줄만 고치면 된다
 * (`lesson.date <= today` → 전부 used 로).
 */
export function balanceOf(student: Student, lessons: Lesson[], today: string): Balance {
  let used = 0;
  let planned = 0;
  for (const l of lessons) {
    if (l.student_id !== student.id) continue;
    const dur = l.end_min - l.start_min;
    if (l.date <= today) used += dur;
    else planned += dur;
  }
  return {
    total_min: student.total_min,
    used_min: used,
    planned_min: planned,
    remaining_min: student.total_min - used,
  };
}

// ── 겹침 ────────────────────────────────────────────

const overlaps = (a: Lesson | LessonInput, b: Lesson) =>
  a.date === b.date && a.start_min < b.end_min && b.start_min < a.end_min;

/**
 * 새 수업이 부딪히는 기존 수업을 찾는다. `ignoreId` 는 수정 중인 자기 자신.
 *
 * 두 종류를 구분해서 돌려준다:
 *  - student: 그 학생이 같은 시간에 이미 다른 수업에 잡혀 있다 (메모가 말하는 "학생 배치 겹침")
 *  - teacher: 그 선생님이 같은 시간에 이미 다른 학생을 받고 있다
 */
export interface Conflicts {
  student: Lesson | null;
  teacher: Lesson | null;
}

export function findConflicts(
  candidate: Lesson | LessonInput,
  lessons: Lesson[],
  ignoreId?: string,
): Conflicts {
  let student: Lesson | null = null;
  let teacher: Lesson | null = null;
  for (const l of lessons) {
    if (ignoreId && l.id === ignoreId) continue;
    if (!overlaps(candidate, l)) continue;
    if (!student && l.student_id === candidate.student_id) student = l;
    if (!teacher && l.teacher === candidate.teacher) teacher = l;
  }
  return { student, teacher };
}

/** 겹침 안내 문구. 선생님 이름 뒤에 T를 붙인다 — "표지연T 본고사 수업이 …". */
export const conflictMessage = (existing: Lesson) =>
  existing.teacher + "T " + existing.kind + " 수업이 이미 등록되어 있습니다. 수정할까요?";

// ── 검증 ────────────────────────────────────────────

const isTeacher = (v: unknown): v is Teacher => TEACHERS.includes(v as Teacher);
const isKind = (v: unknown): v is Kind => KINDS.includes(v as Kind);

const text = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** 폼에서 온 값을 수업으로. 문제가 있으면 사람이 읽을 메시지를 문자열로 돌려준다. */
export function parseLesson(
  body: Record<string, unknown>,
  students: Student[],
): LessonInput | string {
  const teacher = body.teacher;
  if (!isTeacher(teacher)) return "선생님을 선택해 주세요.";

  const kind = body.kind;
  if (!isKind(kind)) return "수업종류를 선택해 주세요.";

  const studentId = text(body.student_id);
  const student = students.find((s) => s.id === studentId);
  if (!student) return "학생을 선택해 주세요.";

  const date = text(body.date);
  if (!date || !parseDate(date)) return "날짜를 확인해 주세요.";

  const start = typeof body.start_min === "number" ? body.start_min : parseTimeLabel(String(body.start ?? ""));
  const end = typeof body.end_min === "number" ? body.end_min : parseTimeLabel(String(body.end ?? ""));
  if (start === null || end === null) return "시간을 확인해 주세요.";
  if (end <= start) return "종료 시간은 시작 시간보다 늦어야 합니다.";
  if (start < DAY_START_MIN || end > DAY_END_MIN) {
    return "수업은 " + toTimeLabel(DAY_START_MIN) + " 부터 " + toTimeLabel(DAY_END_MIN) + " 사이여야 합니다.";
  }
  if (start % 5 || end % 5) return "시간은 5분 단위로 입력해 주세요.";

  return {
    teacher,
    student_id: student.id,
    student_name: student.name,
    kind,
    date,
    start_min: start,
    end_min: end,
    content: text(body.content),
    memo: text(body.memo),
  };
}

/** 폼에서 온 값을 학생으로. */
export function parseStudent(body: Record<string, unknown>): StudentInput | string {
  const name = text(body.name);
  if (!name) return "이름을 입력해 주세요.";

  const hours = body.total_hours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) {
    return "총 시간을 숫자로 입력해 주세요.";
  }

  return {
    name,
    contact: text(body.contact),
    total_min: hoursToMin(hours),
    memo: text(body.memo),
  };
}
