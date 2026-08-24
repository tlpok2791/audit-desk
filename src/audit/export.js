/*
 * 정산표 xlsx 생성 — "살아있는" 정산표.
 *
 * 정산표 시트의 전기·당기·수정분개·수정후·증감액·증감비율은 전부 실제 수식이다.
 * PBC 시트나 수정분개 시트를 엑셀에서 직접 고치면 정산표가 따라 갱신된다.
 * 값을 계산해서 박아 넣지 않는다.
 *
 * 쓰기는 ExcelJS로 한다. SheetJS 커뮤니티 버전은 셀 배경색을 기록하지 못해
 * 강조 표시 요건(중요성 초과 행·초안 셀·불일치 셀)을 만족할 수 없다.
 * ExcelJS는 내보내기를 누를 때만 내려받는다 (약 950KB).
 */
(function (root) {
  "use strict";

  var EXCELJS_SRC = "vendor/exceljs.min.js";

  var FILL = {
    header: "FF16202E",
    subtotal: "FFE8E6DF",
    material: "FFFEF3C7",   // 중요성 이상 증감
    draft: "FFDCEAFE",      // 검토 전 초안
    bad: "FFFEE2E2",
    good: "FFD1FAE5",
    pbc: "FFF1F5F9",
  };
  var MONEY = "#,##0;(#,##0);\"-\"";
  var PCT = "0.0%";

  function loadExcelJS() {
    if (root.ExcelJS) return Promise.resolve(root.ExcelJS);
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = EXCELJS_SRC;
      s.onload = function () {
        root.ExcelJS ? resolve(root.ExcelJS) : reject(new Error("ExcelJS를 불러오지 못했습니다."));
      };
      s.onerror = function () { reject(new Error("ExcelJS 파일을 찾지 못했습니다: " + EXCELJS_SRC)); };
      document.head.appendChild(s);
    });
  }

  function colLetter(i) {           // 0-based → A, B, ... AA
    var s = "";
    i = i + 1;
    while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - m) / 26); }
    return s;
  }

  function quoteSheet(name) { return "'" + String(name).replace(/'/g, "''") + "'"; }

  function fillCell(cell, argb) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb } };
  }

  function headerRow(ws, rowNum, lastCol) {
    for (var c = 1; c <= lastCol; c++) {
      var cell = ws.getCell(rowNum, c);
      cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      fillCell(cell, FILL.header);
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
  }

  /**
   * spec:
   *   meta          engagement (회사명·회사코드·결산일·작성자·검토자·중요성금액·수행중요성)
   *   pbcCurrent    { aoa, headerRow, amountCols:[idx…], sheetTitle }  당기 시산표 원본
   *   pbcPrior      { aoa, headerRow, amountCols:[idx…] }              전기 재무제표 원본
   *   coaOfRow      { current: [코드…], prior: [코드…] }  각 원본 행에 붙일 표준COA코드
   *   adjustments   [{번호,차변계정,대변계정,금액,적요,조서참조,구분}]
   *   rows          [{코드,계정과목명,구분,전기,당기,수정분개,수정후,증감액}]  ← 미리보기 계산값(강조 판단용)
   *   reasons       { COA코드: {text, draft:true} }
   *   checks        [{항목,결과,내용,ok}]
   */
  function build(spec) {
    return loadExcelJS().then(function (ExcelJS) {
      var wb = new ExcelJS.Workbook();
      wb.creator = "감사 데스크";
      wb.created = new Date();

      var S_TB = "PBC_시산표", S_FS = "PBC_전기FS", S_ADJ = "수정분개", S_WS = "정산표", S_CHK = "검증";

      var tb = addPbcSheet(wb, S_TB, spec.pbcCurrent, spec.coaOfRow.current);
      var fs = addPbcSheet(wb, S_FS, spec.pbcPrior, spec.coaOfRow.prior);
      var adj = addAdjSheet(wb, S_ADJ, spec.adjustments);
      addWorksheetSheet(wb, S_WS, spec, { tb: tb, fs: fs, adj: adj, names: { tb: S_TB, fs: S_FS, adj: S_ADJ } });
      addCheckSheet(wb, S_CHK, spec, { tb: tb, fs: fs, names: { tb: S_TB, fs: S_FS, ws: S_WS } });

      return wb.xlsx.writeBuffer();
    });
  }

  /* ── PBC 시트 — 원본 그대로 + 표준COA코드 열만 추가 ── */
  function addPbcSheet(wb, name, pbc, coaCodes) {
    var ws = wb.addWorksheet(name);
    var aoa = pbc.aoa;
    var width = aoa.reduce(function (m, r) { return Math.max(m, r ? r.length : 0); }, 0);
    var coaCol = width;                       // 0-based — 원본 오른쪽 끝 다음 칸

    aoa.forEach(function (row, i) {
      var vals = (row || []).slice();
      while (vals.length < width) vals.push(null);
      // 머리글 행에는 열 이름을, 데이터 행에는 매핑된 코드를 넣는다
      if (i === pbc.headerRow) vals.push("표준COA코드");
      else if (i > pbc.headerRow) vals.push(coaCodes[i] || "");
      else vals.push(null);
      ws.addRow(vals);
    });

    var r = ws.getRow(pbc.headerRow + 1);
    r.eachCell(function (cell) {
      cell.font = { name: "Arial", bold: true, size: 10 };
      fillCell(cell, FILL.pbc);
    });
    // 추가한 열만 눈에 띄게 (원본은 손대지 않는다)
    var letter = colLetter(coaCol);
    ws.getColumn(coaCol + 1).width = 14;
    for (var i = pbc.headerRow + 1; i < aoa.length; i++) {
      fillCell(ws.getCell(i + 1, coaCol + 1), FILL.pbc);
    }
    ws.views = [{ state: "frozen", ySplit: pbc.headerRow + 1 }];

    return {
      coaColLetter: letter,
      amountColLetters: (pbc.amountCols || []).map(colLetter),
      firstDataRow: pbc.headerRow + 2,          // 1-based
      lastRow: aoa.length,
    };
  }

  /* ── 수정분개 ─────────────────────────────────────── */
  function addAdjSheet(wb, name, adjustments) {
    var ws = wb.addWorksheet(name);
    ws.addRow(["번호", "차변코드", "대변코드", "금액", "적요", "조서참조", "구분"]);
    headerRow(ws, 1, 7);
    (adjustments || []).forEach(function (j) {
      var r = ws.addRow([
        j.번호, String(j.차변계정 || ""), String(j.대변계정 || ""),
        Number(j.금액) || 0, j.적요 || "", j.조서참조 || "", j.구분 || "수정",
      ]);
      r.getCell(4).numFmt = MONEY;
    });
    ws.columns = [{ width: 8 }, { width: 12 }, { width: 12 }, { width: 16 },
                  { width: 32 }, { width: 12 }, { width: 10 }];
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return { firstDataRow: 2, lastRow: Math.max(2, (adjustments || []).length + 1) };
  }

  /* ── 정산표 — 열 9개, 전부 수식 ───────────────────── */
  function addWorksheetSheet(wb, name, spec, ref) {
    var ws = wb.addWorksheet(name);
    var HEAD = ["COA", "계정과목명", "전기", "당기", "수정분개", "수정후", "증감액", "증감비율", "증감사유"];
    ws.addRow(HEAD);
    headerRow(ws, 1, 9);

    var fsRange = rangeOf(ref.names.fs, ref.fs);
    var tbRange = rangeOf(ref.names.tb, ref.tb);
    var adjSheet = quoteSheet(ref.names.adj);
    var adjFrom = ref.adj.firstDataRow, adjTo = Math.max(ref.adj.lastRow, adjFrom);

    var material = Math.abs(Number(spec.meta.중요성금액) || 0);
    var bsRows = [], plRows = [], rowNum = 1;

    spec.rows.forEach(function (item) {
      rowNum++;
      var R = rowNum;
      var r = ws.addRow([item.코드, item.계정과목명, null, null, null, null, null, null, null]);

      // 전기 = SUMIFS(전기FS 금액열, 전기FS COA열, 해당 COA)
      r.getCell(3).value = { formula: sumifs(fsRange, "$A" + R) };
      // 당기 = SUMIFS(시산표 금액열, 시산표 COA열, 해당 COA)
      r.getCell(4).value = { formula: sumifs(tbRange, "$A" + R) };
      // 수정분개 = 차변 - 대변.
      // 열 전체를 참조한다 — 엑셀에서 분개 줄을 새로 추가해도 정산표가 따라오도록.
      r.getCell(5).value = { formula:
        "SUMIFS(" + adjSheet + "!$D:$D," + adjSheet + "!$B:$B,$A" + R + ")"
        + "-SUMIFS(" + adjSheet + "!$D:$D," + adjSheet + "!$C:$C,$A" + R + ")" };
      r.getCell(6).value = { formula: "D" + R + "+E" + R };            // 수정후
      r.getCell(7).value = { formula: "F" + R + "-C" + R };            // 증감액
      r.getCell(8).value = { formula: 'IFERROR(G' + R + "/ABS(C" + R + '),"")' };  // 0 나눗셈 → 공란

      var reason = spec.reasons && spec.reasons[item.코드];
      if (reason && reason.text) {
        r.getCell(9).value = reason.text;
        if (reason.draft) {
          fillCell(r.getCell(9), FILL.draft);
          r.getCell(9).note = "audit-fs-analyzer 초안입니다. 검토 후 확정하세요.";
        }
      }

      styleMoneyRow(r);
      if (material && Math.abs(item.증감액 || 0) >= material) {
        [1, 2, 3, 4, 5, 6, 7, 8].forEach(function (c) { fillCell(r.getCell(c), FILL.material); });
      }
      (item.구분 === "PL" ? plRows : bsRows).push(R);
    });

    // BS/PL 소계 — COA 칸은 비운다 (검증 시트의 LEFT() 집계에서 빠지도록)
    function subtotal(label, list) {
      if (!list.length) return null;
      rowNum++;
      var R = rowNum;
      var r = ws.addRow(["", label, null, null, null, null, null, null, null]);
      ["C", "D", "E", "F", "G"].forEach(function (c, i) {
        r.getCell(3 + i).value = { formula: sumList(c, list) };
      });
      r.getCell(8).value = { formula: 'IFERROR(G' + R + "/ABS(C" + R + '),"")' };
      styleMoneyRow(r);
      for (var c = 1; c <= 9; c++) {
        r.getCell(c).font = { name: "Arial", bold: true, size: 10 };
        fillCell(r.getCell(c), FILL.subtotal);
      }
      return R;
    }
    var bsSub = subtotal("BS 소계", bsRows);
    var plSub = subtotal("PL 소계", plRows);

    ws.columns = [{ width: 10 }, { width: 26 }, { width: 16 }, { width: 16 }, { width: 14 },
                  { width: 16 }, { width: 16 }, { width: 11 }, { width: 46 }];
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 9 } };

    spec._wsInfo = { firstDataRow: 2, lastRow: rowNum, bsSub: bsSub, plSub: plSub };
  }

  function rangeOf(sheetName, info) {
    return {
      sheet: quoteSheet(sheetName),
      coa: info.coaColLetter,
      amounts: info.amountColLetters,
      from: info.firstDataRow,
      to: Math.max(info.lastRow, info.firstDataRow),
    };
  }

  /**
   * 금액 열이 하나면 SUMIFS 하나, 차변·대변 두 열이면 차변-대변.
   * PBC 시트도 열 전체를 참조한다 — 원본에 행을 덧붙여도 반영되도록.
   * 머리글·합계 행은 표준COA코드 칸이 비어 있어 어떤 코드와도 매칭되지 않는다.
   */
  function sumifs(rg, criteriaRef) {
    function one(letter) {
      return "SUMIFS(" + rg.sheet + "!$" + letter + ":$" + letter
        + "," + rg.sheet + "!$" + rg.coa + ":$" + rg.coa
        + "," + criteriaRef + ")";
    }
    if (!rg.amounts.length) return "0";
    if (rg.amounts.length === 1) return one(rg.amounts[0]);
    return one(rg.amounts[0]) + "-" + one(rg.amounts[1]);
  }

  function sumList(col, rows) {
    return "SUM(" + rows.map(function (r) { return col + r; }).join(",") + ")";
  }

  function styleMoneyRow(r) {
    [3, 4, 5, 6, 7].forEach(function (c) {
      r.getCell(c).numFmt = MONEY;
      r.getCell(c).font = { name: "Arial", size: 10 };
    });
    r.getCell(8).numFmt = PCT;
    r.getCell(1).font = { name: "Arial", size: 10 };
    r.getCell(2).font = { name: "Arial", size: 10 };
    r.getCell(9).font = { name: "Arial", size: 9 };
    r.getCell(9).alignment = { wrapText: true, vertical: "top" };
  }

  /* ── 검증 ─────────────────────────────────────────── */
  function addCheckSheet(wb, name, spec, ref) {
    var ws = wb.addWorksheet(name);
    var wsName = quoteSheet(ref.names.ws);
    var info = spec._wsInfo;
    var A = wsName + "!$A$" + info.firstDataRow + ":$A$" + info.lastRow;
    var F = wsName + "!$F$" + info.firstDataRow + ":$F$" + info.lastRow;
    var D = wsName + "!$D$" + info.firstDataRow + ":$D$" + info.lastRow;

    // 대분류 합계 — 코드 첫 자리로 판단 (소계 행은 COA가 비어 있어 자동 제외)
    function byHead(digit, col) {
      return "SUMPRODUCT((LEFT(" + A + ",1)=\"" + digit + "\")*" + col + ")";
    }

    ws.addRow([(spec.meta.회사명 || "") + " 정산표 검증"]);
    ws.getCell("A1").font = { name: "Arial", size: 14, bold: true };
    ws.addRow(["결산일 " + spec.meta.결산일 + " · 작성 " + (spec.meta.작성자 || "-")
      + " · 검토 " + (spec.meta.검토자 || "-")]);
    ws.getCell("A2").font = { name: "Arial", size: 9, italic: true, color: { argb: "FF6B7280" } };
    ws.addRow(["아래 값은 모두 수식입니다. PBC나 수정분개를 고치면 함께 갱신됩니다."]);
    ws.getCell("A3").font = { name: "Arial", size: 9, italic: true, color: { argb: "FF6B7280" } };
    ws.addRow([]);

    ws.addRow(["항목", "금액", "판정"]);
    headerRow(ws, 5, 3);

    var r = 5;
    function check(label, formula, judge) {
      r++;
      var row = ws.addRow([label, null, null]);
      row.getCell(2).value = { formula: formula };
      row.getCell(2).numFmt = MONEY;
      row.getCell(3).value = { formula: judge.replace(/@/g, "B" + r) };
      row.getCell(1).font = { name: "Arial", size: 10 };
      row.getCell(3).alignment = { horizontal: "center" };
      return r;
    }

    var okJudge = 'IF(ABS(@)<1,"일치","불일치")';
    // 비용은 코드 첫 자리가 5~9 이므로 합쳐서 본다
    var expense = ["5", "6", "7", "8", "9"].map(function (d) { return byHead(d, F); }).join("+");

    var rAsset = check("자산 합계 (수정후)", byHead("1", F), '""');
    var rLiab = check("부채 합계 (수정후)", byHead("2", F), '""');
    var rEq = check("자본 합계 (수정후)", byHead("3", F), '""');
    var rRev = check("수익 합계 (수정후)", byHead("4", F), '""');
    var rExp = check("비용 합계 (수정후)", expense, '""');
    var rNi = check("당기순손익", "-(B" + rRev + "+B" + rExp + ")", '""');

    // 손익 마감 전이므로 자산 = 부채 + 자본 + 당기순손익 이다
    var rBal = check("자산 - (부채 + 자본 + 당기순손익)",
      "B" + rAsset + "-(-B" + rLiab + "-B" + rEq + "+B" + rNi + ")", okJudge);

    var rDr = check("정산표 수정후 총합 (차대일치)",
      "SUMPRODUCT((LEN(" + A + ")>0)*" + F + ")", okJudge);

    // PBC 합계 ↔ 정산표 당기 합계 대사
    var tbSum = ref.tb.amountColLetters.map(function (L, i) {
      var s = "SUM(" + quoteSheet(ref.names.tb) + "!$" + L + "$" + ref.tb.firstDataRow + ":$" + L + "$" + ref.tb.lastRow + ")";
      return i === 1 ? "-" + s : s;
    }).join("");
    var fsSum = ref.fs.amountColLetters.map(function (L, i) {
      var s = "SUM(" + quoteSheet(ref.names.fs) + "!$" + L + "$" + ref.fs.firstDataRow + ":$" + L + "$" + ref.fs.lastRow + ")";
      return i === 1 ? "-" + s : s;
    }).join("");

    r++; ws.addRow([]);
    r++;
    var rTb = r;
    var rowTb = ws.addRow(["PBC_시산표 합계 - 정산표 당기 합계", null, null]);
    rowTb.getCell(2).value = { formula: "(" + tbSum + ")-SUMPRODUCT((LEN(" + A + ")>0)*" + D + ")" };
    rowTb.getCell(2).numFmt = MONEY;
    rowTb.getCell(3).value = { formula: okJudge.replace(/@/g, "B" + rTb) };
    rowTb.getCell(3).alignment = { horizontal: "center" };

    r++;
    var rFs = r;
    var C = wsName + "!$C$" + info.firstDataRow + ":$C$" + info.lastRow;
    var rowFs = ws.addRow(["PBC_전기FS 합계 - 정산표 전기 합계", null, null]);
    rowFs.getCell(2).value = { formula: "(" + fsSum + ")-SUMPRODUCT((LEN(" + A + ")>0)*" + C + ")" };
    rowFs.getCell(2).numFmt = MONEY;
    rowFs.getCell(3).value = { formula: okJudge.replace(/@/g, "B" + rFs) };
    rowFs.getCell(3).alignment = { horizontal: "center" };

    // 생성 시점에 이미 아는 불일치는 색으로 표시해 둔다
    (spec.checks || []).forEach(function (c) {
      if (c.row && !c.ok) {
        [1, 2, 3].forEach(function (col) { fillCell(ws.getCell(c.row, col), FILL.bad); });
      }
    });
    [rBal, rDr, rTb, rFs].forEach(function (rr) {
      var known = (spec.checks || []).find(function (c) { return c.at === rr; });
      var bad = known ? !known.ok : false;
      [1, 2, 3].forEach(function (col) { fillCell(ws.getCell(rr, col), bad ? FILL.bad : FILL.good); });
    });

    r += 2;
    ws.getCell("A" + r).value = "증감사유 셀 중 파란 배경은 audit-fs-analyzer 초안입니다. 검토 전 상태입니다.";
    ws.getCell("A" + r).font = { name: "Arial", size: 9, color: { argb: "FF6B7280" } };
    r++;
    ws.getCell("A" + r).value = "정산표의 노란 배경 행은 증감액이 중요성금액("
      + (Number(spec.meta.중요성금액) || 0).toLocaleString("ko-KR") + ") 이상인 행입니다.";
    ws.getCell("A" + r).font = { name: "Arial", size: 9, color: { argb: "FF6B7280" } };

    ws.columns = [{ width: 40 }, { width: 20 }, { width: 10 }];
  }

  root.WSExport = { build: build, loadExcelJS: loadExcelJS, colLetter: colLetter };
})(typeof self !== "undefined" ? self : this);
