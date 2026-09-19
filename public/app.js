(function () {
  "use strict";

  // ── 상수 ────────────────────────────────────────
  // 아래 값들은 src/model.ts 와 같은 규칙이다. 한쪽만 고치면 화면과 저장이 어긋난다.
  var DAY_START_MIN = 8 * 60;
  var DAY_END_MIN = 24 * 60;
  var SLOT_MIN = 30;
  var DEFAULT_DURATION_MIN = 120;
  var DOW_LABELS = ["월", "화", "수", "목", "금", "토", "일"];
  var PW_KEY = "nadajoo-pw";

  /* 좁은 화면에서는 주간 뷰가 하루씩만 보인다. 일곱 칸을 휴대폰에 밀어 넣으면
     한 칸이 50px 도 안 돼서 읽히지도, 눌리지도 않는다. */
  var NARROW = window.matchMedia("(max-width: 640px)");

  /** 좁은 화면에서 주간 뷰가 한 번에 보이는 날 수. 넘길 때도 이만큼 움직인다. */
  var NARROW_DAYS = 2;

  /** 움직임을 줄여 달라고 해 둔 기기에서는 넘기는 효과를 뺀다. */
  var CALM = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* 수업종류별 색. 블록만 보고 종류를 알아볼 수 있게 한다. */
  var KIND_COLOR = {
    "본고사": { bg: "#EDF3FE", line: "#BBD0F7", ink: "#1B3F8F" },
    "면접":   { bg: "#EDF7F0", line: "#BFDEC9", ink: "#1F5B36" },
    "지유서": { bg: "#FDF6EA", line: "#E8D6AE", ink: "#7A5E1B" },
    "일본어": { bg: "#F6F1EC", line: "#DCCBBA", ink: "#6B4A2E" },
    "소논문": { bg: "#F4F0FB", line: "#D4C6EC", ink: "#4C3585" }
  };

  /* 수업불가(정규수업·휴가)는 수업이 아니므로 색을 빼고 회색으로 깐다. */
  var BLOCK_COLOR = { bg: "#F1F3F5", line: "#DEE2E7", ink: "#6B7280" };
  var KIND_FALLBACK = { bg: "#F4F5F7", line: "#DEE2E7", ink: "#1B1D21" };
  var colorOf = function (kind) { return KIND_COLOR[kind] || KIND_FALLBACK; };

  /* 학생별 색. 날짜별 뷰는 칸이 선생님이라, 한 학생이 하루 동안 어디를
     오가는지 색으로 따라갈 수 있게 한다. 모두 같은 밝기로 맞춰 두었다. */
  var STUDENT_PALETTE = [
    { bg: "#EDF3FE", line: "#BBD0F7", ink: "#1B3F8F" },
    { bg: "#EDF7F0", line: "#BFDEC9", ink: "#1F5B36" },
    { bg: "#FDF6EA", line: "#E8D6AE", ink: "#7A5E1B" },
    { bg: "#FDEFF0", line: "#F0C7CA", ink: "#8E2F38" },
    { bg: "#F4F0FB", line: "#D4C6EC", ink: "#4C3585" },
    { bg: "#EAF6F5", line: "#B7DCD8", ink: "#1C5B55" },
    { bg: "#FEF1E8", line: "#F2CDB0", ink: "#8A4A1C" },
    { bg: "#EFF1FB", line: "#C6CCEF", ink: "#333B85" },
    { bg: "#F3F7E9", line: "#D3E0B4", ink: "#4E6320" },
    { bg: "#FCEFF7", line: "#EBC5DD", ink: "#852D68" },
    { bg: "#EAF4FA", line: "#BBD8E9", ink: "#14506E" },
    { bg: "#F6F1EC", line: "#DCCBBA", ink: "#6B4A2E" }
  ];

  /** 학생 ID에서 색을 뽑는다 — 목록 순서가 바뀌어도 같은 학생은 같은 색이다. */
  function studentColorOf(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return STUDENT_PALETTE[h % STUDENT_PALETTE.length];
  }

  /**
   * 블록 색은 보는 뷰에 따라 다르다.
   *  - 선생님별: 선생님이 하나로 고정이라 수업종류가 궁금하다
   *  - 날짜별:   칸이 선생님이라 어느 학생인지가 궁금하다
   */
  /**
   * 블록 가운데 굵은 줄에 무엇을 쓸까.
   *  - 학생별: 학생이 고정이라 궁금한 건 어느 선생님인지다
   *  - 그 밖:  학생 이름 (함께 듣는 수업이면 쉼표로 이어 붙인다)
   */
  function headlineOf(lesson, view) {
    return view === "student" ? lesson.teacher + "T" : lesson.student_names.join(", ");
  }

  function blockColorOf(lesson, view) {
    return view === "date" ? studentColorOf(lesson.student_ids[0] || "") : colorOf(lesson.kind);
  }

  /* 온라인 표시. 이미지 대신 선으로 그려서 글자색(currentColor)을 따라가게 한다. */
  var WIFI_SVG =
    '<svg class="wifi" width="13" height="10" viewBox="0 0 14 10" aria-hidden="true">' +
    '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
    '<path d="M1.92 4.64 A6.2 6.2 0 0 1 12.08 4.64" />' +
    '<path d="M4.22 6.25 A3.4 3.4 0 0 1 9.78 6.25" />' +
    "</g>" +
    '<circle cx="7" cy="8.2" r="1.4" fill="currentColor" />' +
    "</svg>";

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // ── 시각·날짜 ───────────────────────────────────
  var pad2 = function (n) { return String(n).padStart(2, "0"); };
  var toTimeLabel = function (min) { return pad2(Math.floor(min / 60)) + ":" + pad2(min % 60); };

  function toMin(value) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
    if (!m) return null;
    var min = Number(m[1]) * 60 + Number(m[2]);
    return min <= 1440 ? min : null;
  }

  function toDurationLabel(min) {
    var abs = Math.abs(min);
    var h = Math.floor(abs / 60), m = abs % 60;
    if (h && m) return h + "시간 " + m + "분";
    if (h) return h + "시간";
    return m + "분";
  }

  /** 잔여처럼 음수가 될 수 있는 값. 모자라면 "-2시간". */
  var toSigned = function (min) { return (min < 0 ? "-" : "") + toDurationLabel(min); };

  /*
   * <input type="time"> 은 00:00~23:59 만 받는다. "24:00" 을 넣으면 브라우저가
   * 통째로 버려서 칸이 비어 버린다 — 22시 이후 빈 칸을 누르면 종료가 빈 칸으로
   * 열리던 원인이다. 종료 칸에서만 자정을 00:00 으로 주고받는다.
   */
  var toEndValue = function (min) { return min === 1440 ? "00:00" : toTimeLabel(min); };
  function endToMin(value) {
    var m = toMin(value);
    return m === 0 ? 1440 : m;   // 종료 00:00 = 그날 자정
  }

  var parseDate = function (label) { return new Date(label + "T00:00:00Z"); };
  var toDateLabel = function (d) { return d.toISOString().slice(0, 10); };
  /** 월=0 … 일=6. JS의 일=0과 다르다. */
  var dowOf = function (d) { return (d.getUTCDay() + 6) % 7; };

  function addDays(label, days) {
    var d = parseDate(label);
    d.setUTCDate(d.getUTCDate() + days);
    return toDateLabel(d);
  }
  function weekStartOf(label) { return addDays(label, -dowOf(parseDate(label))); }
  var mmdd = function (label) { return label.slice(5).replace("-", "."); };

  // ── 상태 ────────────────────────────────────────
  var state = {
    password: "",
    view: "teacher",
    teacher: null,
    narrow: NARROW.matches,
    student: null,        // 학생별 뷰에서 보고 있는 학생 id
    pickedStudents: [],   // 수업 등록 창에서 고른 학생들
    pickedBlockStudents: [],
    weekStart: "",
    day: "",
    data: null,
    editingLesson: null,
    editingStudent: null,
    editingBlock: null,
    lessonSnapshot: "",
    blockSnapshot: "",
    studentSnapshot: "",
    kind: null
  };

  // ── 통신 ────────────────────────────────────────
  async function api(path, method, payload) {
    var res = await fetch(path, {
      method: method || "GET",
      headers: { "content-type": "application/json", "x-password": state.password },
      cache: "no-store",
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      // 다른 곳에서 비밀번호가 바뀌면 들고 있던 값이 죽는다. 표에 문구만 적어 두면
      // 왜 안 되는지 알 수 없으므로 잠금 화면으로 되돌린다.
      if (res.status === 401 && path !== "/api/login") {
        relock("비밀번호가 바뀌었습니다. 다시 입력해 주세요.");
      }
      var err = new Error(data.error || "요청에 실패했습니다 (" + res.status + ")");
      err.status = res.status;
      err.conflict = data.conflict || null;
      throw err;
    }
    return data;
  }

  /** 들고 있던 비밀번호를 버리고 잠금 화면으로. */
  function relock(message) {
    state.password = "";
    try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* 프라이빗 모드 */ }
    ["scrim-lesson", "scrim-block", "scrim-student"].forEach(function (id) { $(id).hidden = true; });
    $("app").hidden = true;
    $("lock").hidden = false;
    $("lock-pw").value = "";
    $("lock-msg").textContent = message || "";
    $("lock-pw").focus();
  }

  // ── 잠금 화면 ───────────────────────────────────
  async function unlock(password) {
    state.password = password;
    await api("/api/login", "POST", {});
    try { sessionStorage.setItem(PW_KEY, password); } catch (e) { /* 프라이빗 모드 */ }
    $("lock").hidden = true;
    $("app").hidden = false;
    await load();
  }

  $("lock-form").addEventListener("submit", async function (e) {
    e.preventDefault();
    $("lock-msg").textContent = "";
    $("lock-btn").disabled = true;
    try {
      await unlock($("lock-pw").value);
    } catch (err) {
      state.password = "";
      $("lock-msg").textContent = err.message;
    } finally {
      $("lock-btn").disabled = false;
    }
  });

  // ── 데이터 ──────────────────────────────────────
  function banner(text) {
    if (!text) return;
    $("banner-text").textContent = text;
    $("banner").hidden = false;
  }
  $("banner-close").addEventListener("click", function () { $("banner").hidden = true; });

  async function load() {
    try {
      state.data = await api("/api/data");
      if (!state.teacher) state.teacher = state.data.teachers[0];
      if (!state.weekStart) state.weekStart = weekStartOf(state.data.today);
      if (!state.day) state.day = state.data.today;
      renderTeacherPicker();
      render();
    } catch (err) {
      $("sheet").innerHTML = '<div class="empty">' + esc(err.message) + "</div>";
    }
  }

  var lessonsOf = function (studentId) {
    return (state.data.lessons || []).filter(function (l) { return l.student_ids.indexOf(studentId) >= 0; });
  };
  var studentById = function (id) {
    return (state.data.students || []).find(function (s) { return s.id === id; }) || null;
  };

  // ── 탭 ──────────────────────────────────────────
  $("tabs").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-view]");
    if (!btn) return;
    state.view = btn.dataset.view;
    Array.prototype.forEach.call($("tabs").children, function (b) {
      b.classList.toggle("is-active", b === btn);
    });
    render();
  });

  /**
   * 선생님 고르기. 넓으면 단추를 늘어놓고, 좁으면 고르는 칸 하나로 낸다 —
   * 휴대폰에서 단추 다섯이면 두 줄을 먹고 그만큼 시간표가 아래로 밀린다.
   */
  function renderTeacherPicker() {
    if (state.narrow) {
      $("teachers").innerHTML =
        '<select data-teacher-select>' +
        state.data.teachers.map(function (t) {
          return '<option value="' + esc(t) + '"' + (t === state.teacher ? " selected" : "") +
            ">" + esc(t) + " 선생님</option>";
        }).join("") + "</select>";
      return;
    }
    $("teachers").innerHTML = state.data.teachers.map(function (t) {
      return '<button class="btn' + (t === state.teacher ? " is-active" : "") +
        '" type="button" data-teacher="' + esc(t) + '">' + esc(t) + " 선생님</button>";
    }).join("");
  }

  function pickTeacher(name) {
    state.teacher = name;
    renderTeacherPicker();
    render();
  }
  $("teachers").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-teacher]");
    if (btn) pickTeacher(btn.dataset.teacher);
  });
  $("teachers").addEventListener("change", function (e) {
    if (e.target.matches("select[data-teacher-select]")) pickTeacher(e.target.value);
  });

  // ── 그리기 ──────────────────────────────────────
  function render() {
    var calendar = state.view !== "students";
    $("bar-teacher").hidden = state.view !== "teacher";
    $("bar-date").hidden = state.view !== "date";
    $("bar-student").hidden = state.view !== "student";
    $("btn-png").hidden = !calendar;

    var today = state.data.today;
    $("meta").textContent = "오늘 " + today + " · 학생 " + state.data.students.length + "명";

    if (state.view === "teacher") {
      $("wk-label").textContent = rangeLabel();
      renderGrid(teacherColumns(), function (l) {
        return l.teacher === state.teacher ? l.date : null;
      });
      $("hint").textContent = state.narrow
        ? "좌우로 밀면 날짜가 넘어갑니다. 빈 칸을 누르면 그 시각으로 등록 창이 열립니다."
        : "빈 칸을 누르면 그 시각으로 등록 창이 열립니다 (30분 단위, 기본 " +
          DEFAULT_DURATION_MIN / 60 + "시간). 블록을 누르면 수정 창입니다.";
    } else if (state.view === "student") {
      renderStudentPicker();
      $("sw-label").textContent = rangeLabel();
      var me = studentById(state.student);
      if (!me) {
        $("sheet").innerHTML = '<div class="empty">학생을 먼저 등록해 주세요.</div>';
        $("student-balance").textContent = "";
      } else {
        var b = me.balance;
        $("student-balance").textContent =
          "총 " + toDurationLabel(b.total_min) + " · 사용 " + toDurationLabel(b.used_min) +
          " · 잔여 " + toSigned(b.remaining_min);
        renderGrid(studentColumns(), function (l) {
          return l.student_ids.indexOf(state.student) >= 0 ? l.date : null;
        });
      }
      $("hint").textContent = state.narrow
        ? "좌우로 밀면 날짜가 넘어갑니다. 선생님이 달라도 그 학생 수업은 다 보입니다."
        : "그 학생의 한 주입니다. 선생님이 달라도 다 보입니다. 빈 칸을 누르면 그 학생으로 등록 창이 열립니다.";
    } else if (state.view === "date") {
      var d = parseDate(state.day);
      $("dy-label").textContent = state.day + " (" + DOW_LABELS[dowOf(d)] + ")";
      renderGrid(dateColumns(), function (l) {
        return l.date === state.day ? l.teacher : null;
      });
      $("hint").textContent = "선생님들을 하루 단위로 나란히 봅니다. 빈 칸을 누르면 그 선생님으로 등록 창이 열립니다.";
    } else {
      renderStudents();
      $("hint").textContent = "잔여 시간은 저장하지 않고 매번 계산합니다 — 수업일 00시가 지나면 차감된 것으로 봅니다. 학생을 누르면 시간 조정과 메모를 할 수 있습니다.";
    }
  }

  /** 선생님별 주간뷰 — 월~일 7칸. */
  /**
   * 주간 뷰가 그릴 날짜들.
   * 넓으면 월~일 이레, 좁으면 보고 있는 하루뿐이다.
   */
  function weekDays() {
    var n = state.narrow ? NARROW_DAYS : 7;
    var from = state.narrow ? state.day : state.weekStart;
    var out = [];
    for (var i = 0; i < n; i++) out.push(addDays(from, i));
    return out;
  }

  function teacherColumns() {
    var cols = [];
    var days = weekDays();
    for (var i = 0; i < days.length; i++) {
      var label = days[i];
      var dow = dowOf(parseDate(label));
      cols.push({
        key: label,
        title: DOW_LABELS[dow],
        sub: mmdd(label),
        weekend: dow >= 5,
        today: label === state.data.today,
        date: label,
        teacher: state.teacher
      });
    }
    return cols;
  }

  /** 학생별 주간뷰 — 월~일 7칸. 선생님을 가리지 않는다. */
  function studentColumns() {
    return weekDays().map(function (label) {
      var dow = dowOf(parseDate(label));
      return {
        key: label,
        title: DOW_LABELS[dow],
        sub: mmdd(label),
        weekend: dow >= 5,
        today: label === state.data.today,
        date: label,
        teacher: null,          // 빈 칸을 누르면 선생님은 등록 창에서 고른다
        student: state.student
      };
    });
  }

  function renderStudentPicker() {
    var students = state.data.students || [];
    if (!state.student || !studentById(state.student)) {
      state.student = students.length ? students[0].id : null;
    }
    $("pick-student").innerHTML = students.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === state.student ? " selected" : "") +
        ">" + esc(s.name) + "</option>";
    }).join("");
  }

  /** 날짜별 선생님뷰 — 선생님 한 분이 한 칸. */
  function dateColumns() {
    return state.data.teachers.map(function (t) {
      var count = (state.data.lessons || []).filter(function (l) {
        return l.date === state.day && l.teacher === t;
      }).length;
      return {
        key: t,
        title: t + " 선생님",
        sub: count ? count + "건" : "—",
        weekend: false,
        today: false,
        date: state.day,
        teacher: t
      };
    });
  }

  /**
   * 이 수업불가가 그 칸에 걸리는가.
   * 선생님 칸이면 선생님을, 학생 칸이면 학생을 본다. 둘 다 안 가리는 것(연휴)은 어디에나 걸린다.
   */
  function blockHits(b, teacher, student) {
    var global = b.teacher === null && !b.student_ids.length;
    if (global) return true;
    if (teacher && b.teacher === teacher) return true;
    if (student && b.student_ids.indexOf(student) >= 0) return true;
    return false;
  }

  /** 지금 보고 있는 범위를 글로. 좁은 화면은 하루뿐이라 날짜와 요일을 적는다. */
  function rangeLabel() {
    if (!state.narrow) return state.weekStart + " ~ " + addDays(state.weekStart, 6);
    var last = addDays(state.day, NARROW_DAYS - 1);
    return NARROW_DAYS > 1 ? mmdd(state.day) + " ~ " + mmdd(last) : state.day;
  }

  var HOURS = (DAY_END_MIN - DAY_START_MIN) / 60;

  /**
   * 한 시간의 높이. CSS 의 --hour 와 **같아야 한다** — 배경의 눈금선은 CSS 가,
   * 격자 전체 높이는 여기가 정하므로 어긋나면 선과 블록이 따로 논다.
   */
  var hourPx = function () { return state.narrow ? 46 : 54; };
  var topPct = function (min) { return ((min - DAY_START_MIN) / (DAY_END_MIN - DAY_START_MIN)) * 100; };

  /**
   * 겹치는 블록을 나란히 놓기 위한 차선 배정.
   * 서로 겹치는 무리를 찾아, 그 무리의 폭을 인원수로 나눈다.
   */
  function layout(items) {
    var sorted = items.slice().sort(function (a, b) {
      return a.start_min - b.start_min || a.end_min - b.end_min;
    });
    var groups = [], current = [], groupEnd = -1;
    sorted.forEach(function (it) {
      if (current.length && it.start_min >= groupEnd) {
        groups.push(current);
        current = [];
        groupEnd = -1;
      }
      current.push(it);
      groupEnd = Math.max(groupEnd, it.end_min);
    });
    if (current.length) groups.push(current);

    var placed = [];
    groups.forEach(function (group) {
      var lanes = [];
      group.forEach(function (it) {
        var lane = 0;
        while (lanes[lane] !== undefined && lanes[lane] > it.start_min) lane++;
        lanes[lane] = it.end_min;
        it._lane = lane;
      });
      var total = lanes.length;
      group.forEach(function (it) {
        placed.push({ item: it, lane: it._lane, lanes: total });
      });
    });
    return placed;
  }

  function renderGrid(cols, keyOf) {
    var lessons = state.data.lessons || [];
    var byCol = {};
    cols.forEach(function (c) { byCol[c.key] = []; });
    lessons.forEach(function (l) {
      var key = keyOf(l);
      if (key !== null && byCol[key]) byCol[key].push(l);
    });

    // 좁은 화면에서는 최소폭을 걸지 않는다 — 걸면 화면 밖으로 밀린다
    var minW = state.narrow ? 0 : (cols.length > 5 ? 112 : 176);
    var html = '<div class="grid" style="grid-template-columns: var(--time-col) repeat(' +
      cols.length + ", minmax(" + minW + 'px, 1fr));">';

    html += '<div class="head corner"></div>';
    cols.forEach(function (c) {
      html += '<div class="head' + (c.weekend ? " weekend" : "") + (c.today ? " today" : "") + '">' +
        esc(c.title) + '<span class="sub">' + esc(c.sub) + "</span></div>";
    });

    // 시간축
    html += '<div class="timecol" style="position: sticky; height:' + HOURS * hourPx() + 'px;">';
    for (var h = 0; h <= HOURS; h++) {
      var min = DAY_START_MIN + h * 60;
      html += '<span class="tick" style="top:' + (h / HOURS) * 100 + '%;">' +
        (min === 1440 ? "24:00" : toTimeLabel(min)) + "</span>";
    }
    html += "</div>";

    var blocks = state.data.blocks || [];

    cols.forEach(function (c) {
      html += '<div class="col' + (c.weekend ? " weekend" : "") +
        '" data-col="' + esc(c.key) + '" style="height:' + HOURS * hourPx() + 'px;">';

      // 수업불가를 먼저, 칸 전체 폭에 깐다 — 수업과 자리를 나눠 갖지 않는다
      blocks.forEach(function (b) {
        if (b.date !== c.date) return;
        if (!blockHits(b, c.teacher, c.student)) return;
        var mins = b.end_min - b.start_min;
        var size = mins < 40 ? " tiny" : mins < 70 ? " short" : "";
        html += '<button class="lesson blocked' + size + '" type="button" data-block="' + esc(b.id) + '"' +
          ' style="top:' + topPct(b.start_min) + "%; height:" + (topPct(b.end_min) - topPct(b.start_min)) + "%;" +
          " left: 0; width: calc(100% - 3px);" +
          " background:" + BLOCK_COLOR.bg + "; border-color:" + BLOCK_COLOR.line +
          "; color:" + BLOCK_COLOR.ink + ';"' +
          ' title="' + esc(b.title + " · " + toTimeLabel(b.start_min) + "–" + toTimeLabel(b.end_min) +
            (b.teacher ? "" : " · 선생님 전체") + (b.memo ? " · " + b.memo : "")) + '">' +
          '<span class="when">' + toTimeLabel(b.start_min) + "–" + toTimeLabel(b.end_min) + "</span>" +
          '<span class="t">' + esc(b.title) + "</span>" +
          "</button>";
      });

      layout(byCol[c.key]).forEach(function (p) {
        var l = p.item;
        var color = blockColorOf(l, state.view);
        var height = topPct(l.end_min) - topPct(l.start_min);
        var width = 100 / p.lanes;
        var mins = l.end_min - l.start_min;
        var size = mins < 40 ? " tiny" : mins < 70 ? " short" : "";
        html += '<button class="lesson' + size + '" type="button" data-lesson="' + esc(l.id) + '"' +
          ' style="top:' + topPct(l.start_min) + "%; height:" + height + "%;" +
          " left:" + p.lane * width + "%; width: calc(" + width + "% - 3px);" +
          " background:" + color.bg + "; border-color:" + color.line + "; color:" + color.ink + ';"' +
          ' title="' + esc(l.student_names.join(", ") + " · " + l.teacher + " " + l.kind +
            (l.online ? " · 온라인" : "") +
            (l.series_id ? " · 반복" : "") +
            (l.content ? " · " + l.content : "") +
            (l.memo ? " · " + l.memo : "")) + '">' +
          '<span class="when">[' + esc(l.kind) + "] " +
            toTimeLabel(l.start_min) + "–" + toTimeLabel(l.end_min) + "</span>" +
          '<span class="t">' + (l.online ? WIFI_SVG : "") + esc(headlineOf(l, state.view)) + "</span>" +
          (l.content ? '<span class="who">' + esc(l.content) + "</span>" : "") +
          "</button>";
      });
      html += "</div>";
    });

    html += "</div>";
    $("sheet").innerHTML = html;
    $("sheet").dataset.cols = JSON.stringify(cols.map(function (c) {
      return { key: c.key, date: c.date, teacher: c.teacher, student: c.student || null };
    }));
  }

  // 격자 클릭 — 블록이면 수정, 빈 곳이면 그 시각으로 등록
  $("sheet").addEventListener("click", function (e) {
    var hit = e.target.closest("button[data-lesson]");
    if (hit) {
      var lesson = (state.data.lessons || []).find(function (l) { return l.id === hit.dataset.lesson; });
      if (lesson) openLesson(lesson, null);
      return;
    }
    var blockHit = e.target.closest("button[data-block]");
    if (blockHit) {
      var found = (state.data.blocks || []).find(function (b) { return b.id === blockHit.dataset.block; });
      if (found) openBlock(found, null);
      return;
    }
    var col = e.target.closest(".col");
    if (!col) return;
    var meta = JSON.parse($("sheet").dataset.cols || "[]").find(function (c) { return c.key === col.dataset.col; });

    if (!meta) return;

    var rect = col.getBoundingClientRect();
    var ratio = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 1);
    var raw = DAY_START_MIN + ratio * (DAY_END_MIN - DAY_START_MIN);
    var start = Math.floor(raw / SLOT_MIN) * SLOT_MIN;
    var end = Math.min(start + DEFAULT_DURATION_MIN, DAY_END_MIN);
    if (end - start < SLOT_MIN) start = end - DEFAULT_DURATION_MIN;

    openLesson(null, {
      teacher: meta.teacher || state.teacher,
      student_ids: meta.student ? [meta.student] : [],
      date: meta.date,
      start_min: start,
      end_min: end
    });
  });

  // ── 주/일 이동 ──────────────────────────────────
  /**
   * 앞뒤로 넘기기. 좁은 화면의 주간 뷰는 하루씩, 넓으면 한 주씩 움직인다.
   * 날짜별 뷰는 언제나 하루씩이다.
   */
  /** 한 번에 몇 날을 움직일까. 보이는 만큼 움직여야 겹치지 않고 넘어간다. */
  function stepDays() {
    if (state.view === "date") return 1;          // 날짜별은 언제나 하루씩
    return state.narrow ? NARROW_DAYS : 7;
  }

  function step(dir) {
    var move = function () {
      if (state.view === "date" || state.narrow) {
        state.day = addDays(state.day, dir * stepDays());
        state.weekStart = weekStartOf(state.day); // 넓은 화면으로 돌아가도 그 주가 보이게
      } else {
        state.weekStart = addDays(state.weekStart, dir * 7);
      }
      render();
    };
    if (state.narrow && !CALM.matches) slide(dir, move);
    else move();
  }

  /**
   * 넘어가는 효과. 가던 쪽으로 밀려 나갔다가 반대쪽에서 들어온다.
   *
   * 움직이는 것은 **날짜 칸과 그 머리뿐**이다. 시간축은 제자리에 있어야
   * 눈금을 따라 읽던 자리를 잃지 않는다. 시간축은 z-index 30 에 흰 바탕이라
   * 칸이 그 뒤로 미끄러져 들어간다.
   *
   * 끝나면 transform 을 지운다 — 남겨 두면 그 요소가 위치 기준이 되어
   * 요일 머리의 sticky 가 흔들린다.
   */
  function dayParts() {
    return $("sheet").querySelectorAll(".head:not(.corner), .col");
  }

  function setStyle(list, css) {
    Array.prototype.forEach.call(list, function (el) {
      for (var k in css) el.style[k] = css[k];
    });
  }

  function slide(dir, move) {
    var out = dir > 0 ? -26 : 26;

    setStyle(dayParts(), {
      transition: "transform .13s ease-in, opacity .13s ease-in",
      transform: "translateX(" + out + "px)",
      opacity: "0"
    });

    setTimeout(function () {
      move();                       // 다시 그리면 칸이 통째로 새 것으로 바뀐다
      var next = dayParts();
      setStyle(next, { transition: "none", transform: "translateX(" + -out + "px)", opacity: "0" });
      void $("sheet").offsetWidth;  // 여기서 한 번 끊어 줘야 되돌아오는 게 보인다
      setStyle(next, {
        transition: "transform .16s ease-out, opacity .16s ease-out",
        transform: "",
        opacity: "1"
      });
      setTimeout(function () {
        setStyle(dayParts(), { transition: "", transform: "", opacity: "" });
      }, 180);
    }, 130);
  }

  function goToday() {
    state.day = state.data.today;
    state.weekStart = weekStartOf(state.data.today);
    render();
  }

  ["wk", "sw", "dy"].forEach(function (p) {
    $(p + "-prev").addEventListener("click", function () { step(-1); });
    $(p + "-next").addEventListener("click", function () { step(1); });
    $(p + "-today").addEventListener("click", goToday);
  });

  /*
   * 좌우로 밀어서 날짜 넘기기.
   *
   * 가로로 스크롤되는 화면(날짜별 뷰의 선생님 칸들)에서는 밀기가 스크롤과
   * 부딪히므로 걸지 않는다. 하루만 보이는 주간 뷰에서만 받는다.
   */
  (function bindSwipe() {
    var x0 = null, y0 = null, sheet = $("sheet");

    var canSwipe = function () {
      return state.narrow && state.view !== "students" &&
        sheet.scrollWidth <= sheet.clientWidth + 2;
    };

    sheet.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1 || !canSwipe()) { x0 = null; return; }
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });

    sheet.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0;
      var dy = t.clientY - y0;
      x0 = null;
      // 가로로 충분히, 그리고 세로보다 확실히 많이 움직였을 때만
      if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      step(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  /* 화면 폭이 바뀌면(회전 등) 칸 수가 달라지므로 다시 그린다. */
  var onNarrowChange = function () {
    state.narrow = NARROW.matches;
    if (!state.data) return;
    renderTeacherPicker();   // 단추 ↔ 고르는 칸
    render();
  };
  if (NARROW.addEventListener) NARROW.addEventListener("change", onNarrowChange);
  else NARROW.addListener(onNarrowChange);
  $("pick-student").addEventListener("change", function () { state.student = this.value; render(); });
  $("btn-refresh").addEventListener("click", function () { load(); });

  // ── 학생 관리 ───────────────────────────────────
  function renderStudents() {
    var students = state.data.students || [];
    if (!students.length) {
      $("sheet").innerHTML = '<div class="empty">등록된 학생이 없습니다. 오른쪽 위 “학생 등록”으로 시작하세요.</div>';
      return;
    }
    var rows = students.map(function (s) {
      var b = s.balance;
      var low = b.remaining_min <= 0;
      return '<tr data-student="' + esc(s.id) + '">' +
        '<td class="name">' + esc(s.name) + "</td>" +
        "<td>" + esc(s.contact || "—") + "</td>" +
        '<td class="num">' + toDurationLabel(b.total_min) + "</td>" +
        '<td class="num">' + toDurationLabel(b.used_min) + "</td>" +
        '<td class="num' + (low ? " low" : "") + '">' +
          toSigned(b.remaining_min) +
        "</td>" +
        '<td class="num planned">' + (b.planned_min ? toDurationLabel(b.planned_min) : "—") + "</td>" +
        "<td>" + esc(s.memo || "") + "</td>" +
        "</tr>";
    }).join("");

    $("sheet").innerHTML =
      '<table class="table"><thead><tr>' +
      "<th>이름</th><th>연락처</th>" +
      '<th class="num">총 시간</th><th class="num">사용</th><th class="num">잔여</th><th class="num">예정</th>' +
      "<th>메모</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table>";
  }

  $("sheet").addEventListener("click", function (e) {
    var row = e.target.closest("tr[data-student]");
    if (row) openStudent(studentById(row.dataset.student));
  });

  // ── 수업 창 ─────────────────────────────────────
  function renderKindChips() {
    $("f-kinds").innerHTML = state.data.kinds.map(function (k) {
      return '<button class="btn' + (k === state.kind ? " is-active" : "") +
        '" type="button" data-kind="' + esc(k) + '">' + esc(k) + "</button>";
    }).join("");
  }
  $("f-kinds").addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-kind]");
    if (!btn) return;
    state.kind = btn.dataset.kind;
    renderKindChips();
  });

  /**
   * 학생을 여러 명 고르는 목록. 두 창(수업·수업불가)이 같이 쓴다.
   * 이미 고른 사람은 이름으로 걸러도 목록에서 빠지지 않는다.
   */
  function renderPicklist(boxId, filterId, picked) {
    var q = ($(filterId).value || "").trim();
    var students = state.data.students || [];
    if (!students.length) {
      $(boxId).innerHTML = '<div class="none">학생을 먼저 등록해 주세요.</div>';
      return;
    }
    var shown = students.filter(function (s) {
      return picked.indexOf(s.id) >= 0 || !q || s.name.indexOf(q) >= 0;
    });
    if (!shown.length) {
      $(boxId).innerHTML = '<div class="none">찾는 학생이 없습니다.</div>';
      return;
    }
    $(boxId).innerHTML = shown.map(function (s) {
      var left = s.balance.remaining_min;
      var tag = "잔여 " + toSigned(left);
      return '<label class="check"><input type="checkbox" value="' + esc(s.id) + '"' +
        (picked.indexOf(s.id) >= 0 ? " checked" : "") + " />" +
        '<span class="who">' + esc(s.name) + '</span>' +
        '<span class="left">' + tag + "</span></label>";
    }).join("");
  }

  /** 체크 상태를 상태 배열에 반영한다. 고른 순서를 지킨다. */
  function bindPicklist(boxId, filterId, key) {
    $(boxId).addEventListener("change", function (e) {
      var input = e.target;
      if (!input || input.type !== "checkbox") return;
      var picked = state[key];
      var at = picked.indexOf(input.value);
      if (input.checked && at < 0) picked.push(input.value);
      if (!input.checked && at >= 0) picked.splice(at, 1);
      if (key === "pickedStudents") updatePickedCount();
    });
    $(filterId).addEventListener("input", function () {
      renderPicklist(boxId, filterId, state[key]);
    });
  }
  bindPicklist("f-students", "f-student-filter", "pickedStudents");
  bindPicklist("b-students", "b-student-filter", "pickedBlockStudents");

  function updatePickedCount() {
    var n = state.pickedStudents.length;
    $("f-student-count").textContent = n > 1 ? "— " + n + "명이 함께 듣는 수업" : "";
  }

  function fillSelects() {
    $("f-teacher").innerHTML = state.data.teachers.map(function (t) {
      return '<option value="' + esc(t) + '">' + esc(t) + " 선생님</option>";
    }).join("");
  }

  function openLesson(lesson, prefill) {
    state.editingLesson = lesson;
    var base = lesson || prefill || {};
    state.kind = base.kind || state.data.kinds[0];

    $("lesson-title").textContent = lesson ? "수업 수정" : "수업 등록";
    fillSelects();
    state.pickedStudents = (base.student_ids || []).slice();
    $("f-student-filter").value = "";
    renderPicklist("f-students", "f-student-filter", state.pickedStudents);
    updatePickedCount();
    $("f-online").checked = base.online === true;
    renderKindChips();
    $("f-teacher").value = base.teacher || state.teacher;
    $("f-date").value = base.date || state.data.today;
    $("f-start").value = toTimeLabel(base.start_min != null ? base.start_min : 16 * 60);
    $("f-end").value = toEndValue(base.end_min != null ? base.end_min : 16 * 60 + DEFAULT_DURATION_MIN);
    $("f-content").value = base.content || "";
    $("f-memo").value = base.memo || "";
    $("f-repeat").value = "1";
    $("f-repeat").closest(".field").hidden = !!lesson;   // 수정할 때는 반복이 의미가 없다
    $("btn-delete").hidden = !lesson;
    $("lesson-msg").textContent = "";
    var n = seriesCount(lesson, state.data.lessons);
    $("lesson-series").hidden = n < 2;
    if (n >= 2) {
      $("lesson-series").textContent =
        n + "주 반복 묶음의 하나입니다. 저장하거나 지울 때 어디까지 미칠지 묻습니다.";
    }

    state.lessonSnapshot = snapshotLesson();
    $("scrim-lesson").hidden = false;
    $("f-student-filter").focus();
  }

  var closeLesson = function () { $("scrim-lesson").hidden = true; state.editingLesson = null; };

  /**
   * 사람이 닫으려 할 때. 쓰던 내용이 있으면 한 번 묻는다 — 메모를 길게 쓰다
   * 실수로 바깥을 누르면 되돌릴 길이 없었다.
   */
  function askCloseLesson() {
    if (snapshotLesson() !== state.lessonSnapshot && !confirm("쓰던 내용을 버릴까요?")) return;
    closeLesson();
  }
  $("btn-cancel").addEventListener("click", askCloseLesson);
  $("scrim-lesson").addEventListener("mousedown", function (e) {
    if (e.target === $("scrim-lesson")) askCloseLesson();
  });

  /* 창을 열 때와 닫을 때의 입력값을 견줘서 "쓰던 내용이 있는가"를 판단한다. */
  var joinValues = function (ids, extra) {
    return ids.map(function (id) {
      var el = $(id);
      return el.type === "checkbox" ? String(el.checked) : el.value;
    }).concat(extra || []).join("\u0001");
  };
  var snapshotLesson = function () {
    return joinValues(
      ["f-teacher", "f-online", "f-date", "f-start", "f-end", "f-content", "f-repeat", "f-memo"],
      [state.kind, state.pickedStudents.join(",")],
    );
  };
  var snapshotBlock = function () {
    return joinValues(
      ["b-teacher", "b-title", "b-date", "b-start", "b-end", "b-repeat", "b-memo"],
      [state.pickedBlockStudents.join(",")],
    );
  };
  var snapshotStudent = function () {
    return joinValues(["s-name", "s-contact", "s-hours", "s-memo"]);
  };

  function collectLesson() {
    var start = toMin($("f-start").value);
    var end = endToMin($("f-end").value);
    if (start === null || end === null) return "시간을 확인해 주세요.";
    if (end <= start) return "종료 시간은 시작 시간보다 늦어야 합니다.";
    if (start < DAY_START_MIN || end > DAY_END_MIN) {
      return "수업은 " + toTimeLabel(DAY_START_MIN) + " 부터 24:00 사이여야 합니다.";
    }
    if (!state.pickedStudents.length) return "학생을 선택해 주세요.";
    if (!$("f-date").value) return "날짜를 입력해 주세요.";
    return {
      teacher: $("f-teacher").value,
      student_ids: state.pickedStudents.slice(),
      online: $("f-online").checked,
      kind: state.kind,
      date: $("f-date").value,
      start_min: start,
      end_min: end,
      content: $("f-content").value.trim(),
      memo: $("f-memo").value.trim()
    };
  }

  /**
   * 서버가 409로 물어보면 사람에게 확인하고 다시 보낸다.
   *
   * 물어볼 게 여럿일 수 있어서(겹침 + 잔여 부족) 확인한 종류를 쌓아 보낸다.
   * 하나로 뭉뚱그리면 겹침만 확인했는데 잔여 부족까지 조용히 지나가 버린다.
   */
  async function saveOne(path, method, payload) {
    var acks = [];
    for (var round = 0; round < 6; round++) {
      try {
        return await api(path, method, acks.length ? Object.assign({}, payload, { force: acks }) : payload);
      } catch (err) {
        if (err.status !== 409 || !err.conflict) throw err;
        if (!confirm(err.conflict.message)) return { skipped: true };
        // 같은 것을 또 물어보면 서버와 어긋난 것이다 — 무한 반복을 막는다
        if (acks.indexOf(err.conflict.type) >= 0) throw err;
        acks.push(err.conflict.type);
      }
    }
    throw new Error("확인이 너무 여러 번 필요합니다. 새로고침 후 다시 해 주세요.");
  }

  /**
   * 반복 묶음에서 어디까지 미칠지 묻는다. 셋 중 하나를 고르거나 취소.
   *
   * confirm() 은 둘 중 하나뿐이라 쓸 수 없어서 작은 창을 따로 둔다.
   * 묶음이 아니면 물어보지 않고 바로 "이것만" 으로 친다.
   */
  function askScope(what, count) {
    return new Promise(function (resolve) {
      $("scope-title").textContent = what + " — 반복 묶음";
      $("scope-text").textContent =
        "이 " + what + "은 " + count + "건짜리 반복 묶음의 하나입니다. 어디까지 할까요?";

      function done(value) {
        $("scrim-scope").hidden = true;
        $("scrim-scope").removeEventListener("click", onClick);
        document.removeEventListener("keydown", onKey);
        resolve(value);
      }
      function onClick(e) {
        var pick = e.target.closest("button[data-scope]");
        if (pick) return done(pick.dataset.scope);
        if (e.target === $("scope-cancel") || e.target === $("scrim-scope")) done(null);
      }
      function onKey(e) { if (e.key === "Escape") done(null); }

      $("scrim-scope").addEventListener("click", onClick);
      document.addEventListener("keydown", onKey);
      $("scrim-scope").hidden = false;
    });
  }

  /** 같은 묶음에 몇 건이 있는가. 묶음이 아니면 0. */
  function seriesCount(item, list) {
    if (!item || !item.series_id) return 0;
    return list.filter(function (x) { return x.series_id === item.series_id; }).length;
  }

  /**
   * 같은 것을 주 단위로 여러 건 넣는다.
   *
   * 중간에 실패하면 거기서 멈추되, 몇 건이 들어갔고 어디서 멈췄는지 돌려준다.
   * 예외를 그대로 던지면 앞 주차가 들어간 것을 아무도 모른 채 창만 열려 있고,
   * 다시 저장하면 그 앞 주차가 두 번 들어간다.
   */
  async function saveWeeks(path, base, weeks) {
    var out = { saved: 0, skipped: 0, failedAt: null, error: "" };
    // 두 건 이상이면 한 묶음으로 엮는다. 나중에 한꺼번에 옮기고 지울 수 있다.
    var series = weeks > 1
      ? "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      : null;
    for (var i = 0; i < weeks; i++) {
      var one = Object.assign({}, base, { date: addDays(base.date, i * 7), series_id: series });
      try {
        var r = await saveOne(path, "POST", one);
        if (r.skipped) out.skipped++;
        else out.saved++;
      } catch (err) {
        out.failedAt = one.date;
        out.error = err.message;
        break;   // 뒤 주차를 더 보내지 않는다
      }
    }
    return out;
  }

  function weeksReport(out, weeks) {
    if (out.failedAt) {
      return weeks + "주 가운데 " + out.saved + "주를 넣고 " + out.failedAt +
        " 에서 멈췄습니다 — " + out.error + " 남은 주차는 그 날짜부터 다시 등록해 주세요.";
    }
    if (out.skipped) return out.skipped + "주치는 취소하셔서 넣지 않았습니다.";
    return "";
  }

  $("form-lesson").addEventListener("submit", async function (e) {
    e.preventDefault();
    var collected = collectLesson();
    if (typeof collected === "string") { $("lesson-msg").textContent = collected; return; }

    $("btn-save").disabled = true;
    try {
      // 잔여 부족·겹침은 saveOne 이 저장 전에 물어본다. 여기서는 결과만 센다.
      if (state.editingLesson) {
        var n = seriesCount(state.editingLesson, state.data.lessons);
        var scope = "one";
        if (n > 1) {
          scope = await askScope("수업", n);
          if (!scope) return;                 // 취소 — 창은 그대로 둔다
        }
        var res = await saveOne(
          "/api/lessons/" + state.editingLesson.id, "PUT",
          Object.assign({}, collected, { scope: scope }),
        );
        // 취소했으면 창을 닫지 않는다 — 고치던 내용이 사라지면 안 된다
        if (res.skipped) { $("lesson-msg").textContent = "저장하지 않았습니다."; return; }
        closeLesson();
        await load();
        if (res.changed > 1) banner(res.changed + "건을 함께 바꿨습니다.");
        return;
      }

      var weeks = Number($("f-repeat").value) || 1;
      var out = await saveWeeks("/api/lessons", collected, weeks);
      closeLesson();
      await load();   // 어떻게 끝났든 표를 다시 읽는다 — 들어간 주차가 보여야 한다
      banner(weeksReport(out, weeks));
    } catch (err) {
      $("lesson-msg").textContent = err.message;
    } finally {
      $("btn-save").disabled = false;
    }
  });

  $("btn-delete").addEventListener("click", async function () {
    var lesson = state.editingLesson;
    if (!lesson) return;

    var n = seriesCount(lesson, state.data.lessons);
    var scope = "one";
    if (n > 1) {
      scope = await askScope("수업", n);
      if (!scope) return;
    }
    var what = scope === "one"
      ? lesson.student_names.join(", ") + " 학생의 " + lesson.date + " " +
        toTimeLabel(lesson.start_min) + " 수업을"
      : "묶음에서 " + (scope === "all" ? "전부를" : lesson.date + " 이후를");
    if (!confirm(what + " 삭제할까요?")) return;

    $("btn-delete").disabled = true;
    try {
      var res = await api("/api/lessons/" + lesson.id, "DELETE", { scope: scope });
      closeLesson();
      await load();
      if (res.removed > 1) banner(res.removed + "건을 삭제했습니다.");
    } catch (err) {
      $("lesson-msg").textContent = err.message;
    } finally {
      $("btn-delete").disabled = false;
    }
  });

  // ── 수업불가 창 ─────────────────────────────────
  var ALL_TEACHERS = "__all__";

  function openBlock(block, prefill) {
    state.editingBlock = block;
    var base = block || prefill || {};

    $("block-title").textContent = block ? "수업불가 수정" : "수업불가 추가";
    $("b-teacher").innerHTML =
      '<option value="' + ALL_TEACHERS + '">선생님 전체</option>' +
      state.data.teachers.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + " 선생님</option>";
      }).join("");
    // teacher 를 일부러 비워 넘긴 경우(날짜별·학생별 뷰)와 아예 안 넘긴 경우를 가른다.
    // 가르지 않으면 화면에 보이지도 않는 선생님이 기본으로 골라져, 모르고 저장하면
    // 그 선생님 시간까지 막힌다.
    var picked;
    if (block) picked = block.teacher || ALL_TEACHERS;
    else if (prefill && Object.prototype.hasOwnProperty.call(prefill, "teacher")) {
      picked = prefill.teacher || ALL_TEACHERS;
    } else picked = state.teacher;
    $("b-teacher").value = picked;

    state.pickedBlockStudents = (base.student_ids || []).slice();
    $("b-student-filter").value = "";
    renderPicklist("b-students", "b-student-filter", state.pickedBlockStudents);

    $("b-title").value = base.title || "";
    $("b-date").value = base.date || state.data.today;
    $("b-start").value = toTimeLabel(base.start_min != null ? base.start_min : 14 * 60);
    $("b-end").value = toEndValue(base.end_min != null ? base.end_min : 16 * 60);
    $("b-memo").value = base.memo || "";
    $("b-repeat").value = "1";
    $("b-repeat-field").hidden = !!block;   // 수정할 때는 반복이 의미가 없다
    $("b-delete").hidden = !block;
    $("block-msg").textContent = "";
    var bn = seriesCount(block, state.data.blocks);
    $("block-series").hidden = bn < 2;
    if (bn >= 2) {
      $("block-series").textContent =
        bn + "주 반복 묶음의 하나입니다. 저장하거나 지울 때 어디까지 미칠지 묻습니다.";
    }

    state.blockSnapshot = snapshotBlock();
    $("scrim-block").hidden = false;
    $("b-title").focus();
  }

  var closeBlock = function () { $("scrim-block").hidden = true; state.editingBlock = null; };

  function askCloseBlock() {
    if (snapshotBlock() !== state.blockSnapshot && !confirm("쓰던 내용을 버릴까요?")) return;
    closeBlock();
  }
  $("b-cancel").addEventListener("click", askCloseBlock);
  $("scrim-block").addEventListener("mousedown", function (e) {
    if (e.target === $("scrim-block")) askCloseBlock();
  });

  $("btn-new-block").addEventListener("click", function () {
    var weekEnd = addDays(state.weekStart, 6);
    var inWeek = state.data.today >= state.weekStart && state.data.today <= weekEnd;
    openBlock(null, {
      teacher: state.view === "student" ? null : state.view === "date" ? null : state.teacher,
      student_ids: state.view === "student" && state.student ? [state.student] : [],
      date: state.view === "date" ? state.day : (inWeek ? state.data.today : state.weekStart)
    });
  });

  function collectBlock() {
    var start = toMin($("b-start").value);
    var end = endToMin($("b-end").value);
    if (start === null || end === null) return "시간을 확인해 주세요.";
    if (end <= start) return "종료 시간은 시작 시간보다 늦어야 합니다.";
    if (start < DAY_START_MIN || end > DAY_END_MIN) {
      return "시간은 " + toTimeLabel(DAY_START_MIN) + " 부터 24:00 사이여야 합니다.";
    }
    if (!$("b-title").value.trim()) return "사유를 입력해 주세요. (예: 정규수업, 휴가)";
    if (!$("b-date").value) return "날짜를 입력해 주세요.";
    var teacher = $("b-teacher").value;
    if (teacher === ALL_TEACHERS && !state.pickedBlockStudents.length &&
        !confirm("선생님도 학생도 안 고르셨습니다. 모두에게 걸리는 수업불가로 둘까요? (연휴처럼)")) {
      return "선생님이나 학생을 골라 주세요.";
    }
    return {
      teacher: teacher === ALL_TEACHERS ? "" : teacher,
      student_ids: state.pickedBlockStudents.slice(),
      title: $("b-title").value.trim(),
      date: $("b-date").value,
      start_min: start,
      end_min: end,
      memo: $("b-memo").value.trim()
    };
  }

  $("form-block").addEventListener("submit", async function (e) {
    e.preventDefault();
    var collected = collectBlock();
    if (typeof collected === "string") { $("block-msg").textContent = collected; return; }

    $("b-save").disabled = true;
    try {
      if (state.editingBlock) {
        var n = seriesCount(state.editingBlock, state.data.blocks);
        var scope = "one";
        if (n > 1) {
          scope = await askScope("수업불가", n);
          if (!scope) return;
        }
        var res = await saveOne(
          "/api/blocks/" + state.editingBlock.id, "PUT",
          Object.assign({}, collected, { scope: scope }),
        );
        if (res.skipped) { $("block-msg").textContent = "저장하지 않았습니다."; return; }
        closeBlock();
        await load();
        if (res.changed > 1) banner(res.changed + "건을 함께 바꿨습니다.");
        return;
      }

      var weeks = Number($("b-repeat").value) || 1;
      var out = await saveWeeks("/api/blocks", collected, weeks);
      closeBlock();
      await load();
      banner(weeksReport(out, weeks));
    } catch (err) {
      $("block-msg").textContent = err.message;
    } finally {
      $("b-save").disabled = false;
    }
  });

  $("b-delete").addEventListener("click", async function () {
    var block = state.editingBlock;
    if (!block) return;

    var n = seriesCount(block, state.data.blocks);
    var scope = "one";
    if (n > 1) {
      scope = await askScope("수업불가", n);
      if (!scope) return;
    }
    var what = scope === "one"
      ? block.date + " " + block.title + " 을(를)"
      : block.title + " 묶음에서 " + (scope === "all" ? "전부를" : block.date + " 이후를");
    if (!confirm(what + " 삭제할까요?")) return;

    $("b-delete").disabled = true;
    try {
      var res = await api("/api/blocks/" + block.id, "DELETE", { scope: scope });
      closeBlock();
      await load();
      if (res.removed > 1) banner(res.removed + "건을 삭제했습니다.");
    } catch (err) {
      $("block-msg").textContent = err.message;
    } finally {
      $("b-delete").disabled = false;
    }
  });

  // ── 학생 창 ─────────────────────────────────────
  function openStudent(student) {
    state.editingStudent = student;
    $("student-title").textContent = student ? "학생 정보" : "학생 등록";
    $("s-name").value = student ? student.name : "";
    $("s-contact").value = student && student.contact ? student.contact : "";
    $("s-hours").value = student ? Math.round((student.balance.total_min / 60) * 100) / 100 : "";
    $("s-memo").value = student && student.memo ? student.memo : "";
    $("s-delete").hidden = !student;
    $("student-msg").textContent = "";

    if (student) {
      var b = student.balance;
      $("s-balance").textContent =
        "총 " + toDurationLabel(b.total_min) + " · 사용 " + toDurationLabel(b.used_min) +
        " · 잔여 " + toSigned(b.remaining_min) +
        (b.planned_min ? " · 아직 차감 전인 예정 " + toDurationLabel(b.planned_min) : "");

      var mine = lessonsOf(student.id).slice().sort(function (a, b2) {
        return b2.date.localeCompare(a.date) || b2.start_min - a.start_min;
      });
      $("s-lessons").innerHTML = mine.length
        ? mine.map(function (l) {
            var past = l.date <= state.data.today;
            return '<div class="item' + (past ? " past" : "") + '">' +
              '<span class="d">' + esc(l.date) + " " + toTimeLabel(l.start_min) + "–" + toTimeLabel(l.end_min) + "</span>" +
              "<span>" + (l.online ? WIFI_SVG : "") + esc(l.teacher) + " · " + esc(l.kind) +
                (l.content ? " · " + esc(l.content) : "") +
                (l.student_ids.length > 1 ? " · " + esc(l.student_names.join(", ")) : "") + "</span>" +
              '<span class="d">' + (past ? "차감됨" : "예정") + "</span>" +
              "</div>";
          }).join("")
        : '<div class="item"><span class="d">등록된 수업이 없습니다.</span></div>';
    } else {
      $("s-balance").textContent = "";
      $("s-lessons").innerHTML = "";
    }
    state.studentSnapshot = snapshotStudent();
    $("scrim-student").hidden = false;
    $("s-name").focus();
  }

  var closeStudent = function () { $("scrim-student").hidden = true; state.editingStudent = null; };

  function askCloseStudent() {
    if (snapshotStudent() !== state.studentSnapshot && !confirm("쓰던 내용을 버릴까요?")) return;
    closeStudent();
  }
  $("s-cancel").addEventListener("click", askCloseStudent);
  $("scrim-student").addEventListener("mousedown", function (e) {
    if (e.target === $("scrim-student")) askCloseStudent();
  });
  $("btn-new-student").addEventListener("click", function () { openStudent(null); });

  /**
   * 툴바의 "수업 등록" — 격자를 누르지 않고도 열 수 있게.
   * 지금 보고 있는 화면을 그대로 따라간다: 날짜별 뷰면 그 날, 선생님별 뷰면
   * 고른 선생님과 (보고 있는 주에 오늘이 들어 있으면) 오늘.
   */
  $("btn-new-lesson").addEventListener("click", function () {
    if (!state.data.students.length) {
      alert("학생을 먼저 등록해 주세요.");
      openStudent(null);
      return;
    }
    var weekEnd = addDays(state.weekStart, 6);
    var inWeek = state.data.today >= state.weekStart && state.data.today <= weekEnd;
    openLesson(null, {
      teacher: state.view === "date" ? state.data.teachers[0] : state.teacher,
      student_ids: state.view === "student" && state.student ? [state.student] : [],
      date: state.view === "date" ? state.day : (inWeek ? state.data.today : state.weekStart)
    });
  });

  $("form-student").addEventListener("submit", async function (e) {
    e.preventDefault();
    var name = $("s-name").value.trim();
    if (!name) { $("student-msg").textContent = "이름을 입력해 주세요."; return; }
    var hours = Number($("s-hours").value);
    if (!Number.isFinite(hours) || hours < 0) { $("student-msg").textContent = "총 시간을 숫자로 입력해 주세요."; return; }

    var payload = {
      name: name,
      contact: $("s-contact").value.trim(),
      total_hours: hours,
      memo: $("s-memo").value.trim()
    };
    $("s-save").disabled = true;
    try {
      if (state.editingStudent) await api("/api/students/" + state.editingStudent.id, "PUT", payload);
      else await api("/api/students", "POST", payload);
      closeStudent();
      await load();
    } catch (err) {
      $("student-msg").textContent = err.message;
    } finally {
      $("s-save").disabled = false;
    }
  });

  $("s-delete").addEventListener("click", async function () {
    var student = state.editingStudent;
    if (!student) return;
    if (!confirm(student.name + " 학생을 삭제할까요?")) return;
    $("s-delete").disabled = true;
    try {
      var res = await saveOne("/api/students/" + student.id, "DELETE", {});
      if (!res.skipped) { closeStudent(); await load(); }
    } catch (err) {
      $("student-msg").textContent = err.message;
    } finally {
      $("s-delete").disabled = false;
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    // 닫기 단추·바깥 누름·Esc 가 모두 같은 길을 탄다
    if (!$("scrim-scope").hidden) return;   // 범위 창은 스스로 Esc 를 받는다
    if (!$("scrim-lesson").hidden) askCloseLesson();
    else if (!$("scrim-student").hidden) askCloseStudent();
    else if (!$("scrim-block").hidden) askCloseBlock();
  });

  // ── 시작 ────────────────────────────────────────
  window.__nadajoo = { state: state, render: render, load: load, helpers: {
    toTimeLabel: toTimeLabel, colorOf: colorOf, layout: layout, topPct: topPct,
    studentColorOf: studentColorOf, blockColorOf: blockColorOf, blockHits: blockHits,
    headlineOf: headlineOf,
    DAY_START_MIN: DAY_START_MIN, DAY_END_MIN: DAY_END_MIN, HOURS: HOURS,
    DOW_LABELS: DOW_LABELS, addDays: addDays, dowOf: dowOf, parseDate: parseDate,
    mmdd: mmdd, esc: esc, teacherColumns: teacherColumns, dateColumns: dateColumns
  } };

  (function boot() {
    var saved = "";
    try { saved = sessionStorage.getItem(PW_KEY) || ""; } catch (e) { /* 프라이빗 모드 */ }
    if (!saved) return;
    unlock(saved).catch(function () {
      state.password = "";
      try { sessionStorage.removeItem(PW_KEY); } catch (e) { /* 프라이빗 모드 */ }
    });
  })();
})();
