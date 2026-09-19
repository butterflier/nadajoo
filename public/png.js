/**
 * PNG 내보내기 — 화면을 캡처하는 대신 캔버스에 직접 그린다.
 *
 * 캡처 라이브러리는 웹폰트와 CSS 격자에서 자주 어긋나고, 카톡·슬랙에 올리면
 * 글자가 뭉갠다. 2배 해상도로 직접 그리면 선생님께 그대로 보내도 읽힌다.
 */
(function () {
  "use strict";

  var H = window.__nadajoo.helpers;
  var state = window.__nadajoo.state;

  var SCALE = 2;
  var PAD = 26;
  var TITLE_H = 46;
  var HEAD_H = 42;
  var TIME_W = 54;
  var HOUR_H = 56;
  var LEGEND_ROW_H = 20;

  var BLOCK_BG = "#F1F3F5";
  var BLOCK_LINE = "#DEE2E7";
  var BLOCK_INK = "#6B7280";

  var LINE = "#DEE2E7";
  var LINE_SOFT = "#F1F3F5";
  var INK = "#1B1D21";
  var INK_SOFT = "#6B7280";

  var font = function (weight, size) {
    return weight + " " + size + 'px "Noto Sans KR", -apple-system, "Apple SD Gothic Neo", sans-serif';
  };

  /** 웹폰트가 준비되기 전에 그리면 시스템 폰트로 나온다. */
  async function ready() {
    if (!document.fonts) return;
    try {
      await Promise.all([400, 500, 600, 700].map(function (w) {
        return document.fonts.load(font(w, 14).replace(/^\d+/, String(w)));
      }));
      await document.fonts.ready;
    } catch (e) { /* 폰트를 못 불러와도 그리기는 계속한다 */ }
  }

  /** 그 칸(선생님·날짜)에 걸리는 수업불가. 선생님을 비운 것은 모두에게 걸린다. */
  function blocksFor(teacher, date, student) {
    return (state.data.blocks || []).filter(function (b) {
      return b.date === date && H.blockHits(b, teacher, student || null);
    });
  }

  function currentPlan() {
    var lessons = state.data.lessons || [];
    if (state.view === "date") {
      return {
        title: state.day + " (" + H.DOW_LABELS[H.dowOf(H.parseDate(state.day))] + ") · 선생님별",
        file: "나다주_" + state.day + "_선생님별.png",
        colW: 190,
        cols: state.data.teachers.map(function (t) {
          return {
            title: t + " 선생님",
            sub: "",
            weekend: false,
            items: lessons.filter(function (l) { return l.date === state.day && l.teacher === t; }),
            blocks: blocksFor(t, state.day),
            second: function (l) { return l.content || ""; }
          };
        }),
        // 칸이 선생님이므로 색은 학생을 가리킨다 — 그날 나오는 학생만 싣는다
        legend: dedupe(
          lessons
            .filter(function (l) { return l.date === state.day; })
            // 색은 첫 학생을 따르므로 범례도 첫 학생만 싣는다
            .map(function (l) { return { id: l.student_ids[0], name: l.student_names[0] }; })
            .filter(function (x) { return x.id; }),
          function (x) { return x.id; }
        ).map(function (x) {
          return { label: x.name, color: H.studentColorOf(x.id) };
        }).sort(function (a, b) { return a.label.localeCompare(b.label, "ko"); })
      };
    }
    var byStudent = state.view === "student";
    var me = byStudent ? (state.data.students || []).find(function (s) { return s.id === state.student; }) : null;

    var cols = [];
    for (var i = 0; i < 7; i++) {
      var label = H.addDays(state.weekStart, i);
      cols.push({
        title: H.DOW_LABELS[i],
        sub: H.mmdd(label),
        weekend: i >= 5,
        items: lessons.filter(function (l) {
          return l.date === label &&
            (byStudent ? l.student_ids.indexOf(state.student) >= 0 : l.teacher === state.teacher);
        }),
        blocks: byStudent ? blocksFor(null, label, state.student) : blocksFor(state.teacher, label),
        // 선생님은 이미 굵은 줄에 있다(headlineOf) — 아래칸은 수업내용이다
        second: function (l) { return l.content || ""; }
      });
    }

    var who = byStudent ? (me ? me.name + " 학생" : "학생") : state.teacher + " 선생님";
    var span = state.weekStart + " ~ " + H.addDays(state.weekStart, 6);
    return {
      title: who + " · " + span,
      file: "나다주_" + who.replace(/ /g, "") + "_" + span.replace(/ /g, "") + ".png",
      colW: 136,
      cols: cols,
      legend: state.data.kinds.map(function (kind) {
        return { label: kind, color: H.colorOf(kind) };
      })
    };
  }

  /** 같은 키가 처음 나온 것만 남긴다. */
  function dedupe(list, keyOf) {
    var seen = {};
    return list.filter(function (it) {
      var k = keyOf(it);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
  }

  /**
   * 그릴 시간 구간을 수업에서 뽑는다.
   *
   * 화면은 08:00~24:00 을 다 보여 주지만, PNG는 카톡·슬랙으로 받아 보는 것이라
   * 빈 시간을 그대로 두면 수업이 작게 깔린다. 가장 이른 수업~가장 늦은 수업에
   * 앞뒤 한 시간씩만 남기고 잘라낸다.
   */
  function rangeOf(items) {
    var lo = null, hi = null;
    items.forEach(function (l) {
      lo = lo === null ? l.start_min : Math.min(lo, l.start_min);
      hi = hi === null ? l.end_min : Math.max(hi, l.end_min);
    });
    // 수업이 하나도 없으면 빈 시간표라도 보기 좋은 구간으로 낸다
    if (lo === null) return { from: 9 * 60, to: 18 * 60 };
    return {
      from: Math.max(H.DAY_START_MIN, Math.floor((lo - 60) / 60) * 60),
      to: Math.min(H.DAY_END_MIN, Math.ceil((hi + 60) / 60) * 60)
    };
  }

  /** 범례 항목을 주어진 폭 안에서 줄 단위로 접는다. 최소 한 줄은 낸다. */
  function packLegend(items, maxWidth) {
    var measure = document.createElement("canvas").getContext("2d");
    measure.font = font(400, 11.5);

    var rows = [[]];
    var used = 0;
    (items || []).forEach(function (it) {
      var width = 16 + measure.measureText(it.label).width + 16;
      if (used && used + width > maxWidth) {
        rows.push([]);
        used = 0;
      }
      rows[rows.length - 1].push({ label: it.label, color: it.color, width: width });
      used += width;
    });
    return rows;
  }

  /** 온라인 표시. 화면의 SVG와 같은 모양을 선으로 그린다 (세로 가운데가 cy). */
  function drawWifi(ctx, x, cy, w) {
    var s = w / 14;               // 14 x 10 기준으로 그린 것을 w 에 맞춘다
    var cx = x + w / 2;
    var base = cy + 3.2 * s;      // 점의 중심
    var a1 = -145 * Math.PI / 180;
    var a2 = -35 * Math.PI / 180;

    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.6 * s;
    ctx.lineCap = "round";
    [6.2, 3.4].forEach(function (r) {
      ctx.beginPath();
      ctx.arc(cx, base, r * s, a1, a2);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.arc(cx, base, 1.4 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  /** 폭에 안 맞으면 끝을 … 로 자른다. */
  function clip(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    var out = text;
    while (out.length > 1 && ctx.measureText(out + "…").width > max) out = out.slice(0, -1);
    return out + "…";
  }

  async function draw() {
    await ready();

    var plan = currentPlan();

    // 수업이 있는 시간대만 그린다
    var all = [];
    plan.cols.forEach(function (c) { all = all.concat(c.items, c.blocks || []); });
    var range = rangeOf(all);
    var hours = (range.to - range.from) / 60;
    var span = range.to - range.from;

    var bodyH = hours * HOUR_H;
    var w = PAD * 2 + TIME_W + plan.colW * plan.cols.length;

    // 범례 항목이 많으면(학생이 여럿이면) 여러 줄로 접힌다. 줄 수를 먼저 세야
    // 캔버스 높이를 정할 수 있다.
    var rows = packLegend(plan.legend, w - PAD * 2);
    var h = PAD * 2 + TITLE_H + HEAD_H + bodyH + rows.length * LEGEND_ROW_H + 4;

    var canvas = document.getElementById("png-canvas");
    canvas.width = w * SCALE;
    canvas.height = h * SCALE;
    var ctx = canvas.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.textBaseline = "alphabetic";

    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, w, h);

    // 제목
    ctx.fillStyle = INK;
    ctx.font = font(700, 19);
    ctx.fillText(plan.title, PAD, PAD + 20);
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(400, 12);
    ctx.fillText("나다주앱 · " + state.data.today + " 기준", PAD, PAD + 38);

    var gridX = PAD + TIME_W;
    var headY = PAD + TITLE_H;
    var bodyY = headY + HEAD_H;

    // 격자 바깥 테두리
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = LINE;
    roundRect(ctx, PAD, headY, w - PAD * 2, HEAD_H + bodyH, 4);
    ctx.stroke();

    // 주말 칸 배경
    plan.cols.forEach(function (c, i) {
      if (!c.weekend) return;
      ctx.fillStyle = "#FBFBFC";
      ctx.fillRect(gridX + i * plan.colW, bodyY, plan.colW, bodyH);
    });

    // 헤더
    ctx.textAlign = "center";
    plan.cols.forEach(function (c, i) {
      var cx = gridX + i * plan.colW + plan.colW / 2;
      ctx.fillStyle = c.weekend ? INK_SOFT : INK;
      ctx.font = font(600, 13);
      ctx.fillText(c.title, cx, headY + (c.sub ? 19 : 26));
      if (c.sub) {
        ctx.fillStyle = INK_SOFT;
        ctx.font = font(400, 11);
        ctx.fillText(c.sub, cx, headY + 33);
      }
    });
    ctx.textAlign = "left";

    ctx.beginPath();
    ctx.moveTo(PAD, bodyY);
    ctx.lineTo(w - PAD, bodyY);
    ctx.strokeStyle = LINE;
    ctx.stroke();

    // 30분 선(연하게) → 정시 선 → 세로 선 순으로 겹쳐 그린다
    for (var k = 1; k < hours * 2; k++) {
      if (k % 2 === 0) continue;
      var y = bodyY + (k / 2) * HOUR_H;
      ctx.beginPath();
      ctx.moveTo(gridX, y);
      ctx.lineTo(w - PAD, y);
      ctx.strokeStyle = LINE_SOFT;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.lineWidth = 1.4;
    ctx.strokeStyle = LINE;
    for (var hh = 0; hh <= hours; hh++) {
      var yy = bodyY + hh * HOUR_H;
      if (hh > 0 && hh < hours) {
        ctx.beginPath();
        ctx.moveTo(gridX, yy);
        ctx.lineTo(w - PAD, yy);
        ctx.stroke();
      }
      ctx.fillStyle = INK_SOFT;
      ctx.font = font(400, 11);
      ctx.textAlign = "right";
      var min = range.from + hh * 60;
      ctx.fillText(min === 1440 ? "24:00" : H.toTimeLabel(min), gridX - 8, yy + 4);
      ctx.textAlign = "left";
    }
    for (var ci = 0; ci <= plan.cols.length; ci++) {
      var x = gridX + ci * plan.colW;
      ctx.beginPath();
      ctx.moveTo(x, headY);
      ctx.lineTo(x, bodyY + bodyH);
      ctx.stroke();
    }

    // 수업불가를 먼저 — 칸 전체 폭에 깔리고, 수업이 그 위에 온다
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    plan.cols.forEach(function (c, i) {
      (c.blocks || []).forEach(function (b) {
        var x = gridX + i * plan.colW + 2;
        var bw = plan.colW - 4;
        var y = bodyY + ((b.start_min - range.from) / span) * bodyH;
        var bh = ((b.end_min - b.start_min) / span) * bodyH;
        var boxH = Math.max(bh - 2, 12);

        ctx.fillStyle = BLOCK_BG;
        ctx.strokeStyle = BLOCK_LINE;
        ctx.lineWidth = 1.4;
        roundRect(ctx, x, y + 1, bw, boxH, 4);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        roundRect(ctx, x, y + 1, bw, boxH, 4);
        ctx.clip();
        ctx.fillStyle = BLOCK_INK;
        var lines = boxH >= 34
          ? [
              { text: H.toTimeLabel(b.start_min) + "–" + H.toTimeLabel(b.end_min), font: font(400, 10.5), lh: 14 },
              { text: b.title, font: font(600, 12), lh: 16 }
            ]
          : [{ text: b.title, font: font(600, 11.5), lh: 14 }];
        var total = lines.reduce(function (sum, ln) { return sum + ln.lh; }, 0);
        var cursor = y + 1 + (boxH - total) / 2;
        lines.forEach(function (ln) {
          ctx.font = ln.font;
          ctx.fillText(clip(ctx, ln.text, bw - 12), x + bw / 2, cursor + ln.lh / 2);
          cursor += ln.lh;
        });
        ctx.restore();
      });
    });
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    // 수업 블록
    plan.cols.forEach(function (c, i) {
      H.layout(c.items).forEach(function (p) {
        var l = p.item;
        var color = H.blockColorOf(l, state.view);
        var names = H.headlineOf(l, state.view);
        var laneW = (plan.colW - 4) / p.lanes;
        var x = gridX + i * plan.colW + 2 + p.lane * laneW;
        var y = bodyY + ((l.start_min - range.from) / span) * bodyH;
        var bh = ((l.end_min - l.start_min) / span) * bodyH;
        var bw = laneW - 2;

        ctx.fillStyle = color.bg;
        ctx.strokeStyle = color.line;
        ctx.lineWidth = 1.4;
        roundRect(ctx, x, y + 1, bw, Math.max(bh - 2, 12), 4);
        ctx.fill();
        ctx.stroke();

        ctx.save();
        roundRect(ctx, x, y + 1, bw, Math.max(bh - 2, 12), 4);
        ctx.clip();
        ctx.fillStyle = color.ink;

        var inner = bw - 12;
        var blockH = Math.max(bh - 2, 12);
        var head = "[" + l.kind + "] " + H.toTimeLabel(l.start_min) + "–" + H.toTimeLabel(l.end_min);

        // 블록 높이에 맞춰 위에서부터 덜어낸다 — 화면 격자와 같은 순서다
        var lines;
        if (bh >= 44) {
          lines = [
            { text: head, font: font(400, 10.5), alpha: 0.8, lh: 14 },
            { text: names, font: font(700, 13), alpha: 1, lh: 17, wifi: l.online }
          ];
          if (c.second(l)) {
            lines.push({ text: c.second(l), font: font(400, 10.5), alpha: 0.8, lh: 14 });
          }
        } else if (bh >= 30) {
          lines = [
            { text: head, font: font(400, 10), alpha: 0.8, lh: 13 },
            { text: names, font: font(700, 12), alpha: 1, lh: 15, wifi: l.online }
          ];
        } else {
          lines = [{ text: names, font: font(700, 11.5), alpha: 1, lh: 14, wifi: l.online }];
        }

        // 가로세로 가운데. 화면 블록이 flex 로 가운데 두는 것과 같은 결과다.
        var total = lines.reduce(function (sum, ln) { return sum + ln.lh; }, 0);
        var cursor = y + 1 + (blockH - total) / 2;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        lines.forEach(function (ln) {
          ctx.font = ln.font;
          ctx.globalAlpha = ln.alpha;
          var mid = cursor + ln.lh / 2;
          if (ln.wifi) {
            // 표시 + 여백만큼 글자를 오른쪽으로 밀고, 둘을 묶어 가운데에 놓는다
            var gap = 3;
            var iconW = 11;
            var textW = Math.min(ctx.measureText(ln.text).width, inner - iconW - gap);
            var startX = x + bw / 2 - (iconW + gap + textW) / 2;
            drawWifi(ctx, startX, mid, iconW);
            ctx.textAlign = "left";
            ctx.fillText(clip(ctx, ln.text, inner - iconW - gap), startX + iconW + gap, mid);
            ctx.textAlign = "center";
          } else {
            ctx.fillText(clip(ctx, ln.text, inner), x + bw / 2, mid);
          }
          cursor += ln.lh;
        });
        ctx.globalAlpha = 1;
        ctx.restore();
      });
    });

    // 범례 — PNG만 봐도 색이 무슨 뜻인지 알 수 있게.
    // 선생님별 뷰는 수업종류, 날짜별 뷰는 그날 나오는 학생이다.
    ctx.font = font(400, 11.5);
    rows.forEach(function (row, r) {
      var lx = PAD;
      var ly = bodyY + bodyH + 17 + r * LEGEND_ROW_H;
      row.forEach(function (it) {
        ctx.fillStyle = it.color.bg;
        ctx.strokeStyle = it.color.line;
        ctx.lineWidth = 1.4;
        roundRect(ctx, lx, ly - 8, 11, 11, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = INK_SOFT;
        ctx.fillText(it.label, lx + 16, ly + 1);
        lx += it.width;
      });
    });

    return { canvas: canvas, file: plan.file };
  }

  document.getElementById("btn-png").addEventListener("click", async function () {
    var btn = this;
    btn.disabled = true;
    try {
      var out = await draw();
      var blob = await new Promise(function (resolve) { out.canvas.toBlob(resolve, "image/png"); });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = out.file;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    } catch (err) {
      alert("PNG를 만들지 못했습니다. " + (err && err.message ? err.message : ""));
    } finally {
      btn.disabled = false;
    }
  });
})();
