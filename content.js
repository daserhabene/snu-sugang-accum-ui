console.log("✅ SUGANG EXT content.js loaded", location.href);

(() => {
  "use strict";

  /**********************
   * Config / State
   **********************/
  const STORE_KEY = "__SUGANG_ACCUM_ROWS__v2";
  const UI_ID = "__sugang_accum_ui__";

  const RUN_KEY = "__SUGANG_SEMIAUTO__v3";
  const REVISIT_KEY = "__SUGANG_REVISIT_PAGES__v3";

  const state = {
    running: false,
    remaining: 0,
    done: 0,
    status: "idle",
    lastError: "",
  };

  const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**********************
   * Missing / Key helpers
   **********************/
  function isMissing(v) {
    return v == null || v === "" || v === "__MISSING__";
  }

  function hasValidKey(r) {
    // "__MISSING__"을 truthy로 잘못 취급하던 버그 수정
    return (
      !isMissing(r.year) &&
      !isMissing(r.shtm) &&
      !isMissing(r.deta) &&
      !isMissing(r.code) &&
      !isMissing(r.ltNo) &&
      !isMissing(r.sbjtSubhCd)
    );
  }

  // ✅ 모든 곳(누적/인덱스/아이템키)이 동일한 키 생성 규칙을 씀
  function makeKeyFromRow(r) {
    if (!hasValidKey(r)) return null;
    return `${r.year}__${r.shtm}__${r.deta}__${r.code}__${r.ltNo}__${r.sbjtSubhCd}`;
  }

  function makeKeyFromItem(item) {
    const v = (p) => item.querySelector(`input[id^="${p}_"]`)?.value?.trim() || "__MISSING__";
    const r = {
      year: v("openSchyy"),
      shtm: v("openShtmFg"),
      deta: v("openDetaShtmFg"),
      code: v("sbjtCd"),
      ltNo: v("ltNo"),
      sbjtSubhCd: v("sbjtSubhCd") || "000",
    };
    return makeKeyFromRow(r);
  }

  /**********************
   * Page helpers
   **********************/
  function getCurrentPageNo() {
    const v = document.CC100?.pageNo?.value;
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;

    const active = document.querySelector("a.num.on, a.num.active, .num.on, .num.active");
    if (active) {
      const m = parseInt((active.textContent || "").trim(), 10);
      if (Number.isFinite(m)) return m;
    }
    return null;
  }

  function getLastPageNoFromPager() {
    const last = document.querySelector("a.arrow.last");
    if (!last) return null;
    const href = last.getAttribute("href") || "";
    const m = href.match(/fnGotoPage\((\d+)\)/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  function listSignature() {
    const first = document.querySelector(".course-info-item input[id^='sbjtCd_']")?.value || "";
    const pageNo = getCurrentPageNo() ?? "";
    const count = document.querySelectorAll(".course-info-item").length;
    return `${pageNo}__${count}__${first}`;
  }

  /**********************
   * DOM readiness helpers
   **********************/
  function _pageItems() {
    return [...document.querySelectorAll(".course-info-item")];
  }

  function _keyFilled(item) {
    const v = (p) => item.querySelector(`input[id^="${p}_"]`)?.value ?? "";
    const year = v("openSchyy");
    const shtm = v("openShtmFg");
    const deta = v("openDetaShtmFg");
    const code = v("sbjtCd");
    const ltNo = v("ltNo");
    const sbjtSubhCd = v("sbjtSubhCd") || "000";
    return !!(year && shtm && deta && code && ltNo && sbjtSubhCd);
  }

  function _countValidOnPage() {
    const items = _pageItems();
    const valid = items.filter(_keyFilled).length;
    return { items: items.length, valid };
  }

  function _shouldExpectTen(pageNo) {
    const last = getLastPageNoFromPager();
    if (last == null) return true;
    return pageNo < last;
  }

  async function waitUntilStable(maxWait = 2500) {
    const start = Date.now();
    let lastSig = "";

    while (Date.now() - start < maxWait) {
      const items = _pageItems();
      const sig = items
        .map((it) => {
          const v = (p) => it.querySelector(`input[id^="${p}_"]`)?.value ?? "";
          return `${v("sbjtCd")}|${v("ltNo")}|${v("sbjtNm")}|${v("sbjtSubhCd")}`;
        })
        .join("##");

      const { items: c, valid } = _countValidOnPage();
      if (c > 0 && c === valid && sig && sig === lastSig) {
        // 한 번 더 안정화 확인
        await sleep(120);
        const again = _countValidOnPage();
        if (again.items > 0 && again.items === again.valid) return;
      }

      lastSig = sig;
      await sleep(120);
    }
  }

  /**********************
   * Extract / Accumulate
   **********************/
  function extractRowsFromDOM() {
    const items = _pageItems();
    if (!items.length) return [];

    return items.map((item) => {
      const getValAny = (prefix) =>
        item.querySelector(`input[id^="${prefix}_"]`)?.value?.trim() || "__MISSING__";

      // hidden inputs
      const year = getValAny("openSchyy");
      const shtm = getValAny("openShtmFg");
      const deta = getValAny("openDetaShtmFg");
      const code = getValAny("sbjtCd");
      const ltNo = getValAny("ltNo");
      const sbjtSubhCd = (getValAny("sbjtSubhCd") || "000").trim();

      const name =
        getValAny("sbjtNm") !== "__MISSING__"
          ? getValAny("sbjtNm")
          : norm(item.querySelector(".course-name strong")?.textContent);

      if ([year, shtm, deta, code, ltNo, sbjtSubhCd].some((x) => x === "__MISSING__")) {
        console.warn("⚠️ KEY FIELD MISSING", { year, shtm, deta, code, ltNo, sbjtSubhCd, name });
      }

      // [교수/학과/코드(분반)] 라인
      const firstLineSpans = item.querySelectorAll(".course-info li.txt:first-child span");
      const prof = norm(firstLineSpans?.[0]?.textContent || "");
      const dept = norm(firstLineSpans?.[1]?.textContent || "");
      const codeText = norm(firstLineSpans?.[2]?.textContent || ""); // 예: 352.623(001)

      const section = (() => {
        const m = codeText.match(/\((\d+)\)/);
        return m ? m[1].padStart(3, "0") : (ltNo ? String(ltNo).padStart(3, "0") : "");
      })();

      // 2번째 li(txt): 정원/총수강/학점/시간
      const secondLi = item.querySelectorAll(".course-info li.txt")[1];

      const capEm = norm(secondLi?.querySelector('span[lang="ko"] em')?.textContent || "");
      const [applied, quota] = (() => {
        const m = capEm.match(/(\d+)\s*\/\s*(\d+)/);
        return m ? [m[1], m[2]] : ["", ""];
      })();
      const quotaResident = (() => {
        const m = capEm.match(/\((\d+)\)/);
        return m ? m[1] : "";
      })();

      const totalEnrolled = norm(
        secondLi?.querySelectorAll('span[lang="ko"]')?.[1]?.querySelector("em")?.textContent || ""
      );
      const credit = norm(
        secondLi?.querySelectorAll('span[lang="ko"]')?.[2]?.querySelector("em")?.textContent || ""
      );

      const timeRaw = (() => {
        const spans = secondLi ? [...secondLi.querySelectorAll("span")] : [];
        const texts = spans
          .map((s) => norm(s.textContent))
          .filter((t) => t && !t.includes("수강신청인원") && !t.includes("총수강인원") && !t.includes("학점"));
        return texts.length ? texts[texts.length - 1] : "";
      })();

      const tagText = norm(item.querySelector(".course-name")?.textContent)
        .replace(name, "")
        .replace(/\s+/g, " ")
        .trim();

      return {
        year,
        shtm,
        deta,
        name,
        code,
        ltNo,
        sbjtSubhCd,
        prof,
        dept,
        codeText,
        section,
        applied,
        quota,
        quotaResident,
        totalEnrolled,
        credit,
        timeRaw,
        tagText,
        sbjtSmryKo: "",
        sbjtSmryEn: "",
      };
    });
  }

  function loadAccum() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function saveAccum(rows) {
    localStorage.setItem(STORE_KEY, JSON.stringify(rows));
  }

  async function addThisPageToAccum() {
    await waitUntilStable();

    const pageNo = getCurrentPageNo() ?? 0;
    const raw = extractRowsFromDOM();
    const current = raw.map((r) => ({ pageNo, ...r }));

    const currentValid = current.filter(hasValidKey);
    if (currentValid.length !== current.length) {
      console.warn(
        `[ACCUM][WARN] page=${pageNo} items=${current.length} validKey=${currentValid.length}`,
        current.filter((r) => !hasValidKey(r)).map((r) => ({
          name: r.name,
          code: r.code,
          ltNo: r.ltNo,
          sbjtSubhCd: r.sbjtSubhCd,
          codeText: r.codeText,
        }))
      );
    }

    // 키 중복(페이지 내부) 디버그
    const keys = currentValid.map(makeKeyFromRow).filter(Boolean);
    const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dups.length) {
      console.warn("[KEY DUP ON PAGE]", { pageNo, dups });
    }

    const accum = loadAccum();
    const seen = new Set(accum.map(makeKeyFromRow).filter(Boolean));

    const fresh = currentValid.filter((r) => {
      const k = makeKeyFromRow(r);
      return k && !seen.has(k);
    });

    const merged = accum.concat(fresh);
    saveAccum(merged);

    const res = {
      pageNo,
      freshCount: fresh.length,
      pageCount: currentValid.length,
      total: merged.length,
    };

    console.log(
      `[ACCUM] page=${res.pageNo} pageCount=${res.pageCount} fresh=${res.freshCount} total=${res.total}`
    );

    return res;
  }

  async function addThisPageToAccum_safe({
    maxTries = 7,
    settleMs = 160,
    betweenMs = 200,
    expectPerPage = 10,
  } = {}) {
    const pageNo = getCurrentPageNo() ?? 0;

    for (let t = 1; t <= maxTries; t++) {
      await sleep(settleMs);

      const { items, valid } = _countValidOnPage();
      const expectTen = _shouldExpectTen(pageNo);

      const ok =
        items > 0 &&
        valid === items &&
        (!expectTen || (items === expectPerPage && valid === expectPerPage));

      if (ok) {
        // ✅ 핵심 패치: await 누락 수정
        const res = await addThisPageToAccum();
        console.log(`[ACCUM][OK] page=${pageNo} tries=${t} items=${items} valid=${valid}`);
        return { ok: true, pageNo, tries: t, items, valid, res };
      }

      console.warn(
        `[ACCUM][RETRY] page=${pageNo} try=${t}/${maxTries} items=${items} valid=${valid} expectTen=${expectTen}`
      );
      await sleep(betweenMs);
    }

    const { items, valid } = _countValidOnPage();
    console.warn(`[ACCUM][FAIL] page=${pageNo} items=${items} valid=${valid}`);
    return { ok: false, pageNo, items, valid, reason: "render-not-stable" };
  }

  /**********************
   * CSV
   **********************/
  function buildCSV(rows) {
    const header = [
      "pageNo",
      "year",
      "shtm",
      "deta",
      "name",
      "code",
      "ltNo",
      "sbjtSubhCd",
      "prof",
      "dept",
      "codeText",
      "section",
      "applied",
      "quota",
      "quotaResident",
      "totalEnrolled",
      "credit",
      "timeRaw",
      "tagText",
      "sbjtSmryKo",
      "sbjtSmryEn",
    ];

    const lines = [
      header.join(","),
      ...rows.map((r) => header.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
    ];

    return "\uFEFF" + lines.join("\n");
  }

  /**********************
   * Summary fetch (CC107 ajax)
   **********************/
  async function fetchSummaryDirectCC107({
    openSchyy,
    openShtmFg,
    openDetaShtmFg,
    sbjtCd,
    ltNo,
    sbjtSubhCd = "000",
    t_profPersNo = "",
  }) {
    const fd = new URLSearchParams({
      workType: "+",
      openSchyy,
      openShtmFg,
      openDetaShtmFg,
      sbjtCd,
      ltNo,
      sbjtSubhCd,
      t_profPersNo,
    });

    const r = await fetch("https://sugang.snu.ac.kr/sugang/cc/cc107ajax.action", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json, text/javascript, */*; q=0.01",
      },
      body: fd.toString(),
      credentials: "include",
    });

    const j = await r.json();
    const ko = (j?.LISTTAB02?.sbjtSmryCtnt ?? "").toString().trim();
    const en = (j?.LISTTAB02?.sbjtSmryEngCtnt ?? "").toString().trim();
    return { ko, en, _raw: j };
  }

  async function fetchSummaryForItem(item) {
    const v = (p) => item.querySelector(`input[id^="${p}_"]`)?.value ?? "";
    return fetchSummaryDirectCC107({
      openSchyy: v("openSchyy"),
      openShtmFg: v("openShtmFg"),
      openDetaShtmFg: v("openDetaShtmFg"),
      sbjtCd: v("sbjtCd"),
      ltNo: v("ltNo"),
      sbjtSubhCd: v("sbjtSubhCd") || "000",
      t_profPersNo: "",
    });
  }

  async function collectSummariesForThisPage_concurrent(concurrency = 3, perItemDelayMs = 80, allowWhenNotRunning = false) {
    const items = _pageItems();
    if (!items.length) return;

    const accum = loadAccum();

    // ✅ 키 규칙 완전 통일 (sbjtSubhCd 포함)
    const index = new Map();
    for (let i = 0; i < accum.length; i++) {
      const k = makeKeyFromRow(accum[i]);
      if (k) index.set(k, i);
    }

    let ptr = 0, ok = 0, fail = 0;

    async function worker() {
      while ((state.running || allowWhenNotRunning) && ptr < items.length) {
        const i = ptr++;
        const item = items[i];
        const key = makeKeyFromItem(item);
        const idx = key ? index.get(key) : null;

        if (idx == null) continue;

        if (
          (accum[idx].sbjtSmryKo && accum[idx].sbjtSmryKo.length > 10) ||
          (accum[idx].sbjtSmryEn && accum[idx].sbjtSmryEn.length > 10)
        ) continue;

        try {
          const smry = await fetchSummaryForItem(item);
          accum[idx].sbjtSmryKo = smry.ko;
          accum[idx].sbjtSmryEn = smry.en;
          ok++;
        } catch (e) {
          fail++;
          console.warn("개요 수집 실패:", e);
        }

        if (perItemDelayMs) await sleep(perItemDelayMs);
      }
    }

    await Promise.all(Array.from({ length: concurrency }, worker));
    saveAccum(accum);

    state.status = `${state.status} (개요 OK ${ok}, FAIL ${fail})`;
    ensureUI();
  }

  /**********************
   * 🔧 Accum-wide summary recovery (POST-run)
   **********************/

  async function collectSummariesForAccum({
    storeKey = "__SUGANG_ACCUM_ROWS__v2",
    concurrency = 3,
    perItemDelayMs = 80,
    onlyMissing = true,
    maxItems = Infinity,

    // ✅ NEW: 기본값 false (QuotaExceeded 자동 회피)
    saveToLocalStorage = false,

    // ✅ NEW: 저장을 켰을 때만 의미 있음 (몇 개마다 저장할지)
    saveEvery = 50,
  } = {}) {
    const rows = JSON.parse(localStorage.getItem(storeKey) || "[]");
    if (!Array.isArray(rows) || !rows.length) {
      console.warn("[ACCUM-SUMMARY] 누적 rows 없음:", storeKey);
      return { ok: 0, fail: 0, total: 0 };
    }

    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (!onlyMissing) return true;
        const koOk = r.sbjtSmryKo && r.sbjtSmryKo.length > 10;
        const enOk = r.sbjtSmryEn && r.sbjtSmryEn.length > 10;
        return !(koOk || enOk);
      })
      .slice(0, maxItems);

    console.log("[ACCUM-SUMMARY] total rows:", rows.length, "need:", targets.length);

    let ptr = 0, ok = 0, fail = 0;

    async function worker() {
      while (ptr < targets.length) {
        const { r, i } = targets[ptr++];

        try {
          const smry = await fetchSummaryDirectCC107({
            openSchyy: r.year,
            openShtmFg: r.shtm,
            openDetaShtmFg: r.deta,
            sbjtCd: r.code,
            ltNo: r.ltNo,
            sbjtSubhCd: r.sbjtSubhCd && r.sbjtSubhCd !== "__MISSING__" ? r.sbjtSubhCd : "000",
            t_profPersNo: "",
          });

          rows[i].sbjtSmryKo = smry.ko;
          rows[i].sbjtSmryEn = smry.en;
          ok++;
        } catch (e) {
          fail++;
          console.warn("[ACCUM-SUMMARY][FAIL]", r.code, r.ltNo, e);
        }

        if (perItemDelayMs) await new Promise((r) => setTimeout(r, perItemDelayMs));

        // ✅ 중간 저장은 옵션이 true일 때만
        if (saveToLocalStorage && (ok + fail) % saveEvery === 0) {
          try {
            localStorage.setItem(storeKey, JSON.stringify(rows));
            console.log("[ACCUM-SUMMARY] progress", ok + fail, "/", targets.length, "ok", ok, "fail", fail);
          } catch (e) {
            // ✅ 저장하다 quota 터지면 자동으로 저장 OFF로 전환하고 계속 진행
            console.warn("[ACCUM-SUMMARY] localStorage 저장 실패(Quota 등) -> 이후 저장 비활성화", e);
            saveToLocalStorage = false;
          }
        }
      }
    }

    // (노출) 콘솔에서 필요하면 호출할 수 있게
    window.collectSummariesForAccum = collectSummariesForAccum;

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    console.log("[ACCUM-SUMMARY] DONE", { ok, fail, total: rows.length });

    // ✅ 최종 결과는 localStorage에 굳이 안 넣고 CSV로만 산출(기본 전략)
    const csv = buildCSV(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `sugang_with_summary_${rows.length}.csv`;
    a.click();

    console.log("CSV 다운로드 완료 (localStorage 저장 기본 OFF)");
    return { ok, fail, total: rows.length };
  }


  /**********************
   * Navigation
   **********************/
  function goToPageViaFormContentScript(page) {
    const candidates = [
      document.forms?.CC100,
      document.forms?.HD102,
      document.CC100,
      document.HD102,
    ].filter(Boolean);

    const form = candidates.find((f) => f.pageNo || f.querySelector?.("[name='pageNo']"));
    if (!form) return { ok: false, why: "CC100/HD102 중 pageNo 있는 폼을 못 찾음" };

    const pageNoEl = form.pageNo || form.querySelector("[name='pageNo']");
    if (!pageNoEl) return { ok: false, why: `${form.name || form.id}/pageNo not found` };

    const workTypeEl = form.workType || form.querySelector("[name='workType']");
    if (workTypeEl) workTypeEl.value = "S";

    pageNoEl.value = String(page);

    try { form.target = "_self"; } catch { }

    const wantAction = "/sugang/cc/cc100InterfaceSrch.action";
    if (!String(form.action || "").includes("cc100InterfaceSrch.action")) {
      form.action = wantAction;
    }

    HTMLFormElement.prototype.submit.call(form);
    return { ok: true, formName: form.name || form.id || "unknown" };
  }

  async function goNextPagePlusOne() {
    const cur = getCurrentPageNo();
    if (cur == null) throw new Error("현재 pageNo를 읽지 못했어.");
    const next = cur + 1;

    const res = goToPageViaFormContentScript(next);
    if (!res.ok) throw new Error("폼 submit 이동 실패: " + (res.why || "unknown"));

    console.log("➡️ page move via", res.formName, "to", next);
    return { cur, next, via: "form", formName: res.formName };
  }

  /**********************
   * Revisit Queue
   **********************/
  function loadRun() {
    try { return JSON.parse(localStorage.getItem(RUN_KEY) || "null"); } catch { return null; }
  }
  function saveRun(run) {
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  }
  function loadRevisit() {
    try { return JSON.parse(localStorage.getItem(REVISIT_KEY) || "[]"); } catch { return []; }
  }
  function saveRevisit(q) {
    localStorage.setItem(REVISIT_KEY, JSON.stringify(q));
  }
  function revisitSize() {
    return loadRevisit().length;
  }
  function enqueueRevisit(pageNo, why = "") {
    const q = loadRevisit();
    if (!q.some((x) => x.pageNo === pageNo)) {
      q.push({ pageNo, why, ts: Date.now() });
      saveRevisit(q);
    }
    console.warn("[REVISIT][ADD]", pageNo, why);
  }
  function dequeueRevisit() {
    const q = loadRevisit();
    const x = q.shift();
    saveRevisit(q);
    return x || null;
  }

  /**********************
   * Semi-auto runner
   **********************/

  function startAutoRun(nMoves, mode = "summary", opts = {}) {
    const cur = getCurrentPageNo() || 1;
    const last = getLastPageNoFromPager(); // 마지막 페이지 (있으면)

    const expectPerPage = opts.expectPerPage ?? 10;

    // 🔹 이동 횟수 계산
    // - 숫자면 그대로
    // - "toEnd"면 마지막 페이지까지 남은 만큼
    const moves =
      (nMoves === "toEnd")
        ? (last != null ? Math.max(0, last - cur) : 999999)
        : nMoves;

    // 🔹 목표 누적 개수 계산
    // - 현재 페이지 포함해서 (moves + 1) 페이지 처리한다고 가정
    // - last를 못 읽으면 목표는 Infinity (종료는 last 감지 로직에 맡김)
    const targetTotal =
      (nMoves === "toEnd")
        ? (last != null ? (moves + 1) * expectPerPage : Infinity)
        : (nMoves + 1) * expectPerPage;

    const run = {
      running: true,
      mode,            // "list" | "summary"
      phase: "main",   // "main" | "revisit"
      remaining: moves,
      done: 0,
      startedAt: Date.now(),
      lastPage: cur,
      lastPageProcessed: false,
      lastMsg: "",

      // 목표/제어 관련
      expectPerPage,
      targetTotal,
      overshootSlack: opts.overshootSlack ?? 0, // 0~2 정도 허용

      // 성능/안정 옵션
      opts: {
        concurrency: opts.concurrency ?? 3,
        perItemDelayMs: opts.perItemDelayMs ?? 80,
        perPageDelayMs: opts.perPageDelayMs ?? 450,
      },

      // (표시/디버그용)
      startPage: cur,
      endPage: last ?? null,
    };

    saveRun(run);

    state.status =
      `반자동(${mode === "summary" ? "개요" : "목록"}) ON ` +
      (nMoves === "toEnd" ? "(끝까지 자동)" : `(이동 ${nMoves}회)`);

    state.lastError = "";
    ensureUI();

    setTimeout(stepAutoResume, 260);
  }


  function stopAutoRun(msg = "사용자 중단") {
    const run = loadRun();
    if (run) {
      run.running = false;
      run.lastMsg = msg;
      saveRun(run);
    }
    state.status = `반자동 OFF (${msg})`;
    state.lastError = "";
    ensureUI();
  }

  async function stepAutoResume() {
    const run = loadRun();
    if (!run || !run.running) return;

    try {
      const cur = getCurrentPageNo();
      if (cur == null) throw new Error("현재 페이지 번호를 읽지 못했어.");

      if (run.lastPage === cur && run.lastPageProcessed) {
        state.status = `반자동: page ${cur} 이미 처리됨 → 대기`;
        ensureUI();
        return;
      }

      state.status = `반자동: page ${cur} 누적 시도중… (${run.phase})`;
      ensureUI();

      const acc = await addThisPageToAccum_safe();
      run.lastPage = cur;
      run.lastPageProcessed = true;

      if (!acc.ok) {
        enqueueRevisit(cur, `items=${acc.items}, valid=${acc.valid}`);
        run.lastMsg = `page ${cur} 누적 실패 → revisit 등록`;
        saveRun(run);
        state.status = `반자동: ${run.lastMsg} (revisit=${revisitSize()})`;
        ensureUI();
      } else {
        run.lastMsg = `page ${cur} 누적 OK (+${acc.res.freshCount}/${acc.res.pageCount})`;
        saveRun(run);
        state.status = `반자동: ${run.lastMsg} (남은 이동 ${run.remaining}, revisit=${revisitSize()})`;
        state.lastError = "";
        ensureUI();

      }

      if (run.mode === "summary") {
        state.status = `반자동(개요): page ${cur} 개요 수집중…`;
        ensureUI();
        await collectSummariesForThisPage_concurrent(run.opts.concurrency, run.opts.perItemDelayMs, true);
        state.status = `반자동(개요): page ${cur} 개요 수집 완료`;
        ensureUI();
      }

      const last = getLastPageNoFromPager();
      if (run.phase === "main") {
        if (last != null && cur >= last) run.remaining = 0;

        if (run.remaining <= 0) {
          if (revisitSize() > 0) {
            run.phase = "revisit";
            run.lastPageProcessed = false;
            run.lastMsg = `main 완료 → revisit 시작 (남은 ${revisitSize()}페이지)`;
            saveRun(run);

            state.status = `반자동: ${run.lastMsg}`;
            ensureUI();

            const job = dequeueRevisit();
            if (!job) {
              run.running = false;
              run.lastMsg = "revisit 큐 비어있음";
              saveRun(run);
              state.status = `반자동 종료: ${run.lastMsg}`;
              ensureUI();
              return;
            }

            await sleep(run.opts.perPageDelayMs);
            goToPageViaFormContentScript(job.pageNo);
            return;
          }

          run.running = false;
          run.lastMsg = "main 완료 + revisit 없음";
          saveRun(run);
          state.status = `반자동 종료: ${run.lastMsg}`;
          ensureUI();
          return;
        }

        run.remaining -= 1;
        run.done += 1;
        run.lastPageProcessed = false;
        run.lastMsg = `page ${cur} → next`;
        saveRun(run);

        state.status = `반자동: ${run.lastMsg} (남은 이동 ${run.remaining})`;
        ensureUI();

        await sleep(run.opts.perPageDelayMs);
        await goNextPagePlusOne();
        return;
      }

      if (run.phase === "revisit") {
        // ✅ 목표(total)가 이미 목표 이상이면 revisit 더 돌지 말고 종료
        {
          const totalNow = loadAccum().length;
          const target = run.targetTotal ?? Infinity;
          const slack = run.overshootSlack ?? 0;
          const limit = target + slack;

          if (totalNow >= limit) {
            // revisit 큐 비우고 종료
            localStorage.setItem(REVISIT_KEY, "[]");

            run.running = false;
            run.lastMsg = `목표 도달/초과로 revisit 종료 (total=${totalNow}, target=${target}, slack=${slack})`;
            saveRun(run);

            state.status = `반자동 종료: ${run.lastMsg}`;
            state.lastError = "";
            ensureUI();
            return;
          }
        }
        const job = dequeueRevisit();
        if (!job) {
          run.running = false;
          run.lastMsg = "revisit 완료";
          saveRun(run);
          state.status = `반자동 종료: ${run.lastMsg}`;
          ensureUI();
          return;
        }

        run.lastPageProcessed = false;
        run.lastMsg = `revisit → page ${job.pageNo} 이동 (남은 ${revisitSize()})`;
        saveRun(run);

        state.status = `반자동: ${run.lastMsg}`;
        ensureUI();

        await sleep(run.opts.perPageDelayMs);
        goToPageViaFormContentScript(job.pageNo);
        return;
      }
    } catch (e) {
      const msg = String(e?.message || e);
      const run2 = loadRun();
      if (run2) {
        run2.running = false;
        run2.lastMsg = "오류로 중단: " + msg;
        saveRun(run2);
      }
      state.lastError = msg;
      state.status = "반자동 실패(중단됨)";
      ensureUI();
    }
  }

  function bootAutoRunResume() {
    const run = loadRun();
    if (run?.running) {
      state.status = `반자동 이어서 실행중 (phase=${run.phase}, 남은이동=${run.remaining}, revisit=${revisitSize()})`;
      ensureUI();
      setTimeout(stepAutoResume, 420);
    }
  }

  /**********************
   * UI
   **********************/
  function ensureUI() {
    const existing = document.getElementById(UI_ID);
    if (existing) existing.remove();

    const pageNo = getCurrentPageNo();
    const last = getLastPageNoFromPager();
    const accum = loadAccum();
    const total = accum.length;
    const pageRows = _pageItems().length;

    const wrap = document.createElement("div");
    wrap.id = UI_ID;
    wrap.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;" +
      "background:#fff;border:1px solid #ddd;padding:12px 12px 10px;" +
      "border-radius:12px;box-shadow:0 10px 28px rgba(0,0,0,.16);" +
      "font:13px/1.45 system-ui;max-width:460px;color:#111;";

    const title = document.createElement("div");
    title.style.cssText = "font-weight:800;margin-bottom:6px;";
    title.textContent = "수강 강좌 추출(누적기)";

    const stat = document.createElement("div");
    stat.style.cssText = "color:#333;margin-bottom:10px;";
    stat.innerHTML =
      `현재 페이지: <b>${pageNo ?? "?"}</b>${last ? ` / 마지막: <b>${last}</b>` : ""}` +
      ` (이 페이지 <b>${pageRows}</b>개)<br>` +
      `누적 저장됨: <b>${total}</b>개<br>` +
      `상태: <b>${state.status}</b>` +
      (state.lastError ? `<div style="margin-top:6px;color:#b00020;"><b>오류:</b> ${state.lastError}</div>` : "");

    const row = document.createElement("div");
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px;";

    const mkBtn = (label, css) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.cssText =
        css ||
        "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#f7f7f7;cursor:pointer;font-weight:700;";
      return b;
    };

    const btnAccOnly = mkBtn("이 페이지 누적(이동 없음)");
    btnAccOnly.onclick = async () => {
      try {
        const res = await addThisPageToAccum();
        state.status = `page ${res.pageNo} 누적 완료`;
        state.lastError = "";
        ensureUI();
      } catch (e) {
        state.lastError = String(e?.message || e);
        state.status = "실패";
        ensureUI();
      }
    };

    const btnAccNext = mkBtn("누적 + 다음 페이지(+1)");
    btnAccNext.onclick = async () => {
      try {
        const res = await addThisPageToAccum();
        state.status = `page ${res.pageNo} 누적 완료 → 다음 페이지 이동`;
        state.lastError = "";
        ensureUI();
        await goNextPagePlusOne();
      } catch (e) {
        state.lastError = String(e?.message || e);
        state.status = "실패";
        ensureUI();
      }
    };

    const btnDownload = mkBtn(
      "누적 CSV 받기",
      "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;"
    );
    btnDownload.onclick = () => {
      const rows = loadAccum();
      if (!rows.length) {
        alert("누적 데이터가 비어 있어.");
        return;
      }
      const csv = buildCSV(rows);
      const filename = `sugang_accum_${rows.length}.csv`;

      let a = wrap.querySelector("a.__manual_link");
      if (!a) {
        a = document.createElement("a");
        a.className = "__manual_link";
        a.style.cssText =
          "display:block;margin-top:8px;color:#0b57d0;text-decoration:underline;font-weight:800;";
        wrap.appendChild(a);
      }

      if (a.href) {
        try { URL.revokeObjectURL(a.href); } catch { }
      }

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      a.href = url;
      a.download = filename;
      a.textContent = `⬇️ ${filename} 다운로드`;

      console.log("✅ CSV link updated:", filename);
    };

    const btnRun5 = mkBtn(
      "반자동(개요): 다음 5페이지",
      "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;"
    );
    btnRun5.onclick = () => window.__SUGANG_START_SUMMARY__(5, { concurrency: 3 });

    const btnRun20 = mkBtn(
      "반자동(개요): 다음 20페이지",
      "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;"
    );
    btnRun20.onclick = () => window.__SUGANG_START_SUMMARY__(20, { concurrency: 3, expectPerPage: 10, overshootSlack: 0 });

    const btnStop = mkBtn(
      "중단",
      "padding:8px 10px;border:1px solid #e1a6a6;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;color:#b00020;"
    );
    btnStop.onclick = () => window.__SUGANG_STOP__();

    const btnRunAll = mkBtn(
      "자동(개요): 끝까지",
      "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#fff;cursor:pointer;font-weight:900;"
    );
    btnRunAll.onclick = () => window.__SUGANG_START_SUMMARY_TO_END__({ concurrency: 3 });

    const btnReset = mkBtn(
      "누적 초기화",
      "padding:8px 10px;border:1px solid #e1a6a6;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;color:#b00020;"
    );
    btnReset.onclick = () => {
      if (!confirm("누적 데이터를 지울까?")) return;
      localStorage.removeItem(STORE_KEY);
      localStorage.removeItem(REVISIT_KEY);
      localStorage.removeItem(RUN_KEY);
      state.status = "누적 초기화됨";
      state.lastError = "";
      ensureUI();
    };

    const btnSmry = mkBtn(
      "이 페이지 개요 수집(10개)",
      "padding:8px 10px;border:1px solid #bbb;border-radius:10px;background:#fff;cursor:pointer;font-weight:800;"
    );
    btnSmry.onclick = async () => {
      try {
        // ✅ 핵심 패치: await 누락 수정
        await addThisPageToAccum();
        await collectSummariesForThisPage_concurrent(3, 80, true);
      } catch (e) {
        state.lastError = String(e?.message || e);
        state.status = "개요 수집 실패";
        ensureUI();
      }
    };

    const btnRecoverSummary = mkBtn("누적 전체 개요 채우기");
    btnRecoverSummary.onclick = () => {
      collectSummariesForAccum({
        concurrency: 3,
        perItemDelayMs: 80,
        onlyMissing: true
      });
    };

    const btnClose = mkBtn("닫기");
    btnClose.onclick = () => wrap.remove();

    row.appendChild(btnAccOnly);
    row.appendChild(btnAccNext);
    row.appendChild(btnDownload);
    row.appendChild(btnRun5);
    row.appendChild(btnRun20);
    row.appendChild(btnRunAll);
    row.appendChild(btnStop);
    row.appendChild(btnReset);
    row.appendChild(btnSmry);
    row.appendChild(btnRecoverSummary);
    row.appendChild(btnClose);

    const note = document.createElement("div");
    note.style.cssText = "color:#666;font-size:12px;";
    note.textContent = "반자동은 페이지 로딩/안정화 후 진행. 누락 발생 시 revisit 큐로 자동 재방문.";

    wrap.appendChild(title);
    wrap.appendChild(stat);
    wrap.appendChild(row);
    wrap.appendChild(note);

    document.body.appendChild(wrap);
  }

  /**********************
   * Expose helpers
   **********************/
  window.__SUGANG_START_LIST__ = (n, opts) => startAutoRun(n, "list", opts || {});
  window.__SUGANG_START_SUMMARY__ = (n, opts) => startAutoRun(n, "summary", opts || {});
  window.__SUGANG_START_LIST_TO_END__ = (opts) => startAutoRun("toEnd", "list", opts || {});
  window.__SUGANG_START_SUMMARY_TO_END__ = (opts) => startAutoRun("toEnd", "summary", opts || {});
  window.__SUGANG_STOP__ = () => stopAutoRun("사용자 중단");
  window.__SUGANG_RESUME_STEP__ = () => stepAutoResume();

  /**********************
   * Boot
   **********************/
  function boot() {
    state.status = "UI 주입됨";
    state.lastError = "";
    ensureUI();

    // 늦게 로딩될 수 있어 UI 몇 번 갱신
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (!document.getElementById(UI_ID)) return clearInterval(timer);
      ensureUI();
      if (tries > 8) clearInterval(timer);
    }, 700);

    // ✅ 존재하지 않는 stepSemiAuto* 호출 제거하고,
    // ✅ run 이어하기는 stepAutoResume로만 일원화
    bootAutoRunResume();
  }

  boot();
})();
