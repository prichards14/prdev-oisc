const SZ = 256,
  IN = 0xfe,
  OUT = 0xff;
let mem = new Uint8Array(SZ),
  pc = 0,
  cycles = 0,
  running = false,
  timer = null,
  speed = 4,
  inp = 0,
  trace = [],
  prog = "counter";
let _keySeq = 0;
function genKey() {
  return "prog_" + ++_keySeq + "_" + Date.now();
}

function u8(v) {
  return ((v % 256) + 256) % 256;
}
function hx(v, p = 2) {
  return v.toString(16).toUpperCase().padStart(p, "0");
}

// ---------- Program registry ----------
let PROGS = {
  knight: {
    name: "Knight Rider LEDs",
    desc: "Adjacent LED pair bouncing; single LED at each edge",
    isCustom: false,
    ledColor: "red",
    build(m) {
      m.fill(0);
      // Pattern: single LED at left/right edges, two adjacent LEDs everywhere else.
      // Cycle (16 frames): 1→3→6→12→24→48→96→192→128→192→96→48→24→12→6→3→(repeat)
      // Uses delta-based output: each instruction subtracts a pre-computed constant
      // from OUT so the result equals the next pattern value directly — no 0x00 flash.
      const pat = [
        1, 3, 6, 12, 24, 48, 96, 192, 128, 192, 96, 48, 24, 12, 6, 3,
      ];
      const n = pat.length; // 16
      const DBASE = 200;
      const Z = 240;

      // sub[i] = u8(pat[i] - pat[i+1]): subtracting from pat[i] gives pat[i+1]
      for (let i = 0; i < n; i++) {
        m[DBASE + i] = u8(pat[i] - pat[(i + 1) % n]);
      }

      // Pre-seed OUT to pat[0]=1 so the startup display is correct,
      // and the first instruction (DBASE+0) produces pat[1]=3
      m[255] = pat[0]; // = 1

      let x = 0;
      const em = (a, b, c) => {
        m[x++] = a;
        m[x++] = b;
        m[x++] = c;
      };

      // 16 pattern steps
      for (let i = 0; i < n; i++) {
        em(DBASE + i, 255, (i + 1) * 3);
      }
      // Unconditional loop-back at address 42
      em(Z, Z, 0);
    },
  },
  vu: {
    name: "VU Meter LEDs",
    desc: "LED bar growing from one edge to full, then shrinking back",
    isCustom: false,
    ledColor: "red",
    build(m) {
      m.fill(0);
      const pat = [
        1, 3, 7, 15, 31, 63, 127, 255, 127, 63, 31, 15, 7, 3,
      ];
      const n = pat.length; // 14
      const DBASE = 200;
      const Z = 240;

      // sub[i] = u8(pat[i] - pat[i+1]): subtracting from pat[i] gives pat[i+1]
      for (let i = 0; i < n; i++) {
        m[DBASE + i] = u8(pat[i] - pat[(i + 1) % n]);
      }

      // Pre-seed OUT to pat[0]=1 so the startup display is correct,
      // and the first instruction (DBASE+0) produces pat[1]=3
      m[255] = pat[0]; // = 1

      let x = 0;
      const em = (a, b, c) => {
        m[x++] = a;
        m[x++] = b;
        m[x++] = c;
      };

      // 14 pattern steps
      for (let i = 0; i < n; i++) {
        em(DBASE + i, 255, (i + 1) * 3);
      }
      // Unconditional loop-back at address 42
      em(Z, Z, 0);
    },
  },
  counter: {
    name: "Binary counter",
    desc: "Counts 0\u219225\u21920 on the output LEDs",
    isCustom: false,
    ledColor: "blue",
    build(m) {
      m.fill(0);
      m[250] = 0xff;
      m[251] = 0;
      [250, 255, 3, 251, 251, 0].forEach((v, i) => (m[i] = v));
    },
  },
  fibonacci: {
    name: "Fibonacci sequence",
    desc: "Outputs 1,1,2,3,5,8,13,21,34,55,89,144,233\u2026 (wraps mod 256)",
    isCustom: false,
    ledColor: "green",
    build(m) {
      m.fill(0);
      const A = 240,
        B = 241,
        T = 242,
        Z = 244,
        S = 245,
        T2 = 246,
        O = 255;
      m[A] = 0;
      m[B] = 1;
      m[T] = 0;
      m[Z] = 0;
      m[S] = 0;
      m[T2] = 0;
      const p = [
        T,
        T,
        3,
        B,
        T,
        6,
        O,
        O,
        9,
        T,
        O,
        12,
        A,
        T,
        15,
        S,
        S,
        18,
        T,
        S,
        21,
        T2,
        T2,
        24,
        B,
        T2,
        27,
        A,
        A,
        30,
        T2,
        A,
        33,
        T,
        T,
        36,
        S,
        T,
        39,
        B,
        B,
        42,
        T,
        B,
        45,
        Z,
        Z,
        0,
      ];
      p.forEach((v, i) => (m[i] = v));
    },
  },
  echo: {
    name: "Toggle switch echo",
    desc: "Mirrors input switches (FE) to output LEDs (FF) every cycle",
    isCustom: false,
    ledColor: "",
    build(m) {
      m.fill(0);
      const Z = 251,
        T = 252,
        O = 255;
      m[Z] = 0;
      m[T] = 0;
      [T, T, 3, IN, T, 6, O, O, 9, T, O, 12, Z, Z, 0].forEach(
        (v, i) => (m[i] = v),
      );
    },
  },
};

function getSnapshot(key) {
  const p = PROGS[key];
  const m = new Uint8Array(SZ);
  if (p.isCustom) m.set(p.snapshot);
  else p.build(m);
  return m;
}

function rebuildSelect() {
  const sel = document.getElementById("prog-sel");
  sel.innerHTML = "";
  for (const [key, p] of Object.entries(PROGS)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = p.name + (p.isCustom ? " ✎" : "");
    if (key === prog) opt.selected = true;
    sel.appendChild(opt);
  }
  document.getElementById("del-btn").disabled = !PROGS[prog].isCustom;
}

// ---------- Program management ----------
function newProgram() {
  const key = genKey();
  const m = new Uint8Array(SZ);
  PROGS[key] = {
    name: "New Program",
    desc: "",
    isCustom: true,
    ledColor: "",
    snapshot: m,
  };
  rebuildSelect();
  loadProgram(key);
  openEditor(key);
}

function duplicateProgram() {
  const src = PROGS[prog];
  const m = getSnapshot(prog);
  const key = genKey();
  PROGS[key] = {
    name: src.name + " (copy)",
    desc: src.desc || "",
    isCustom: true,
    ledColor: src.ledColor || "",
    snapshot: m.slice(),
  };
  rebuildSelect();
  loadProgram(key);
}

function deleteProgram() {
  if (!PROGS[prog] || !PROGS[prog].isCustom) return;
  if (!confirm('Delete "' + PROGS[prog].name + '"?')) return;
  const keys = Object.keys(PROGS);
  const idx = keys.indexOf(prog);
  delete PROGS[prog];
  const newKey = Object.keys(PROGS)[Math.max(0, idx - 1)];
  rebuildSelect();
  loadProgram(newKey);
}

// ---------- Editor state ----------
let editKey = null;
let editInstrs = [];
let editConsts = [];

function parseProgram(m) {
  let maxAddr = -1;
  for (let i = 0; i < 0xe0; i++) if (m[i] !== 0) maxAddr = i;
  const endBytes = maxAddr < 0 ? 3 : Math.floor(maxAddr / 3) * 3 + 6;
  const endClamped = Math.min(endBytes, 0xe0);
  const instrs = [];
  for (let a = 0; a < endClamped; a += 3)
    instrs.push({ a: m[a], b: m[a + 1], c: m[a + 2] });
  if (instrs.length === 0) instrs.push({ a: 0, b: 0, c: 0 });
  const instrEnd = instrs.length * 3;
  const consts = [];
  for (let a = instrEnd; a < 0xff; a++)
    if (m[a] !== 0) consts.push({ addr: a, val: m[a] });
  return { instrs, consts };
}

function effectLabel(a, b, c) {
  const bL = b === 0xff ? "OUT" : b === 0xfe ? "IN" : "mem[" + hx(b) + "]";
  const aL = a === 0xfe ? "IN" : "mem[" + hx(a) + "]";
  return bL + " -= " + aL + (c === 0 ? "; \u2192 00" : "; \u2192 " + hx(c));
}

function renderInstrTable() {
  const tbody = document.getElementById("instr-tbody");
  tbody.innerHTML = "";
  editInstrs.forEach((instr, i) => {
    const addr = i * 3;
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><span class="edit-addr">${hx(addr)}</span></td>` +
      `<td><input class="hex-inp" id="ia_${i}" maxlength="2" value="${hx(instr.a)}" oninput="onInstrInput(${i},'a',this)"></td>` +
      `<td><input class="hex-inp" id="ib_${i}" maxlength="2" value="${hx(instr.b)}" oninput="onInstrInput(${i},'b',this)"></td>` +
      `<td><input class="hex-inp" id="ic_${i}" maxlength="2" value="${hx(instr.c)}" oninput="onInstrInput(${i},'c',this)"></td>` +
      `<td><span class="effect-lbl" id="ieff_${i}">${effectLabel(instr.a, instr.b, instr.c)}</span></td>` +
      `<td><button class="del-btn" onclick="deleteInstrRow(${i})">×</button></td>`;
    tbody.appendChild(tr);
  });
}

function renderConstTable() {
  const tbody = document.getElementById("const-tbody");
  tbody.innerHTML = "";
  editConsts.forEach((c, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML =
      `<td><input class="addr-inp" id="ca_${i}" maxlength="2" value="${hx(c.addr)}" oninput="onConstInput(${i},'addr',this)"></td>` +
      `<td><input class="hex-inp" id="cv_${i}" maxlength="2" value="${hx(c.val)}" oninput="onConstInput(${i},'val',this)"></td>` +
      `<td><span class="effect-lbl" id="ceff_${i}">${c.val} dec / signed ${c.val > 127 ? c.val - 256 : c.val}</span></td>` +
      `<td><button class="del-btn" onclick="deleteConstRow(${i})">×</button></td>`;
    tbody.appendChild(tr);
  });
}

function onInstrInput(i, field, el) {
  const v = parseInt(el.value, 16);
  const ok = el.value.length > 0 && !isNaN(v) && v >= 0 && v <= 255;
  el.classList.toggle("err", !ok && el.value.length > 0);
  if (ok) {
    editInstrs[i][field] = v;
    document.getElementById("ieff_" + i).textContent = effectLabel(
      editInstrs[i].a,
      editInstrs[i].b,
      editInstrs[i].c,
    );
  }
}

function onConstInput(i, field, el) {
  const v = parseInt(el.value, 16);
  const ok = el.value.length > 0 && !isNaN(v) && v >= 0 && v <= 255;
  el.classList.toggle("err", !ok && el.value.length > 0);
  if (ok) {
    editConsts[i][field] = v;
    const eff = document.getElementById("ceff_" + i);
    if (eff) {
      const val = editConsts[i].val;
      eff.textContent = val + " dec / signed " + (val > 127 ? val - 256 : val);
    }
  }
}

function addInstrRow() {
  editInstrs.push({ a: 0, b: 0, c: 0 });
  renderInstrTable();
}
function deleteInstrRow(i) {
  if (editInstrs.length > 1) editInstrs.splice(i, 1);
  else editInstrs[0] = { a: 0, b: 0, c: 0 };
  renderInstrTable();
}
function addConstRow() {
  const used = new Set(editConsts.map((c) => c.addr));
  let addr = 0xf0;
  while (used.has(addr) && addr < 0xff) addr++;
  editConsts.push({ addr, val: 0 });
  renderConstTable();
}
function deleteConstRow(i) {
  editConsts.splice(i, 1);
  renderConstTable();
}

function openEditor(key) {
  editKey = key;
  const p = PROGS[key];
  const m = getSnapshot(key);
  const parsed = parseProgram(m);
  editInstrs = parsed.instrs.map((x) => ({ ...x }));
  editConsts = parsed.consts.map((x) => ({ ...x }));
  document.getElementById("edit-name").value = p.name;
  document.getElementById("modal-title").textContent = p.isCustom
    ? "Edit Program"
    : 'Edit Copy of "' + p.name + '"';
  document.getElementById("edit-error").style.display = "none";
  renderInstrTable();
  renderConstTable();
  document.getElementById("prog-modal").classList.add("open");
}

function closeEditor() {
  document.getElementById("prog-modal").classList.remove("open");
}

function saveEditor() {
  const errEl = document.getElementById("edit-error");
  const errs = document.querySelectorAll(".hex-inp.err,.addr-inp.err");
  if (errs.length > 0) {
    errEl.textContent = "Fix highlighted fields (must be hex 00–FF).";
    errEl.style.display = "block";
    return;
  }
  const finalInstrs = [];
  for (let i = 0; i < editInstrs.length; i++) {
    const a = parseInt(document.getElementById("ia_" + i).value, 16);
    const b = parseInt(document.getElementById("ib_" + i).value, 16);
    const c = parseInt(document.getElementById("ic_" + i).value, 16);
    if (isNaN(a) || isNaN(b) || isNaN(c)) {
      errEl.textContent = "All instruction fields must be hex 00–FF.";
      errEl.style.display = "block";
      return;
    }
    finalInstrs.push({ a: a & 0xff, b: b & 0xff, c: c & 0xff });
  }
  const finalConsts = [];
  for (let i = 0; i < editConsts.length; i++) {
    const addr = parseInt(document.getElementById("ca_" + i).value, 16);
    const val = parseInt(document.getElementById("cv_" + i).value, 16);
    if (isNaN(addr) || isNaN(val)) {
      errEl.textContent = "All constant fields must be hex 00–FF.";
      errEl.style.display = "block";
      return;
    }
    finalConsts.push({ addr: addr & 0xff, val: val & 0xff });
  }
  const instrEnd = finalInstrs.length * 3;
  for (const c of finalConsts) {
    if (c.addr < instrEnd) {
      errEl.textContent = `Constant at ${hx(c.addr)} overlaps with instruction area (0x00–${hx(instrEnd - 1)}).`;
      errEl.style.display = "block";
      return;
    }
  }
  const name = document.getElementById("edit-name").value.trim() || "Unnamed";
  const m = new Uint8Array(SZ);
  finalInstrs.forEach((instr, i) => {
    m[i * 3] = instr.a;
    m[i * 3 + 1] = instr.b;
    m[i * 3 + 2] = instr.c;
  });
  finalConsts.forEach(({ addr, val }) => {
    m[addr] = val;
  });
  if (!PROGS[editKey].isCustom) {
    const key = genKey();
    PROGS[key] = {
      name,
      desc: "",
      isCustom: true,
      ledColor: PROGS[editKey].ledColor || "",
      snapshot: m,
    };
    closeEditor();
    rebuildSelect();
    loadProgram(key);
  } else {
    PROGS[editKey].name = name;
    PROGS[editKey].snapshot = m;
    closeEditor();
    rebuildSelect();
    loadProgram(editKey);
  }
}

// ---------- Core simulator (original logic, adapted for custom programs) ----------
function buildAsmList() {
  const el = document.getElementById("asm-list");
  el.innerHTML = "";
  let last = 0;
  for (let i = 87; i >= 0; i--) {
    if (mem[i] !== 0) {
      last = i;
      break;
    }
  }
  last = Math.max(last, 11);
  for (let addr = 0; addr <= last; addr += 3) {
    const a = mem[addr],
      b = mem[addr + 1],
      c = mem[addr + 2];
    const row = document.createElement("div");
    row.className = "asm-row";
    row.id = "ar" + addr;
    row.innerHTML =
      `<span class="asm-addr">${hx(addr)}</span>` +
      `<span style="flex:1">SUBLEQ <span class="ka">${hx(a)}</span>,` +
      `<span class="kb">${hx(b)}</span>,<span class="kc">${hx(c)}</span></span>` +
      `<span class="asm-comment">; mem[${hx(b)}]-=mem[${hx(a)}]</span>`;
    el.appendChild(row);
  }
}

function hiliteAsm() {
  document
    .querySelectorAll(".asm-row")
    .forEach((r) => r.classList.remove("cur"));
  const el = document.getElementById("ar" + pc);
  if (el) {
    el.classList.add("cur");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function initGrid() {
  const g = document.getElementById("mem-grid");
  if (g.children.length) return;
  for (let i = 0; i < 256; i++) {
    const c = document.createElement("div");
    c.className = "mc";
    c.id = "mc" + i;
    c.onclick = (
      (addr) => () =>
        inspectCell(addr)
    )(i);
    g.appendChild(c);
  }
}

function renderMem() {
  const a = mem[pc],
    b = mem[pc + 1],
    c2 = mem[pc + 2];
  for (let i = 0; i < 256; i++) {
    const el = document.getElementById("mc" + i);
    el.textContent = hx(mem[i]);
    el.className = "mc";
    if (i === pc) el.classList.add("pc-cur");
    else if (i === a) el.classList.add("pc-a");
    else if (i === b) el.classList.add("pc-b");
    else if (i === c2) el.classList.add("pc-c");
  }
}

function inspectCell(addr) {
  const v = mem[addr],
    s = v > 127 ? v - 256 : v;
  document.getElementById("mem-inspect").textContent =
    `[${hx(addr)}] = 0x${hx(v)} = ${v} unsigned  /  ${s} signed`;
}

function renderLEDs(val) {
  const color = (PROGS[prog] || {}).ledColor || "";
  for (let i = 0; i < 8; i++) {
    const el = document.getElementById("ol" + i);
    const on = !!(val & (1 << i));
    el.className = "led " + (on ? "on" : "off");
    if (on && color) el.classList.add(color);
  }
  document.getElementById("out-hex").textContent = `0x${hx(val)} = ${val}`;
  if (val !== 0) {
    trace.unshift(hx(val));
    if (trace.length > 24) trace.pop();
  }
  document.getElementById("out-trace").textContent = trace.join(" ");
}

function renderSwitches() {
  for (let i = 0; i < 8; i++)
    document.getElementById("sw" + i).className =
      "sw " + (inp & (1 << i) ? "on" : "off");
  document.getElementById("in-hex").textContent = `0x${hx(inp)}`;
  mem[IN] = inp;
}

function toggleSw(bit) {
  inp ^= 1 << bit;
  mem[IN] = inp;
  renderSwitches();
}

function renderRegs(a, b, c, result, branched) {
  document.getElementById("r-pc").textContent = "0x" + hx(pc);
  document.getElementById("r-pc-d").textContent = "dec " + pc;
  document.getElementById("r-a").textContent = "0x" + hx(a);
  document.getElementById("r-av").textContent = "val=" + mem[a];
  document.getElementById("r-b").textContent = "0x" + hx(b);
  document.getElementById("r-bv").textContent = "val=" + mem[b];
  document.getElementById("r-c").textContent = "0x" + hx(c);
  document.getElementById("r-cv").textContent = "addr=" + c;
  const s = result > 127 ? result - 256 : result;
  document.getElementById("r-res").textContent = hx(result);
  document.getElementById("r-res2").textContent = (s >= 0 ? "+" : "") + s;
  document.getElementById("r-cyc").textContent = cycles;
  const neg = s <= 0,
    zero = s === 0;
  const fn = document.getElementById("f-n");
  fn.textContent = "N=" + (neg ? 1 : 0);
  fn.className = "flag" + (neg ? " active" : "");
  const fz = document.getElementById("f-z");
  fz.textContent = "Z=" + (zero ? 1 : 0);
  fz.className = "flag" + (zero ? " active" : "");
  const fb = document.getElementById("f-br");
  fb.textContent = "branch: " + (branched ? "YES" : "NO");
  fb.className = "flag" + (branched ? " active" : "");
  document.getElementById("instr-decode").innerHTML =
    `<span class="kw">SUBLEQ</span> <span class="ka">0x${hx(a)}</span>, <span class="kb">0x${hx(b)}</span>, <span class="kc">0x${hx(c)}</span><br>` +
    `mem[${hx(b)}] = ${(result - s + s) & 0xff} &minus; ${mem[a]} = <b>${s}</b><br>` +
    (branched
      ? `result &le; 0 &rarr; <b>jumped to 0x${hx(c)}</b>`
      : `result &gt; 0 &rarr; <b>PC+3 = 0x${hx(u8(pc))}</b>`);
  document.getElementById("cur-instr").innerHTML =
    `SUBLEQ <span class="ka">mem[${hx(a)}]</span>, <span class="kb">mem[${hx(b)}]</span>, <span class="kc">${hx(c)}</span><br>` +
    `result=${s} &rarr; ${branched ? "jump to " + hx(c) : "PC+3"}`;
}

function stepCPU() {
  if (pc > SZ - 3) pc = 0;
  const a = mem[pc],
    b = mem[pc + 1],
    c = mem[pc + 2];
  mem[IN] = inp;
  const bv = mem[b],
    av = mem[a];
  const res = u8(bv - av);
  mem[b] = res;
  if (b === OUT) renderLEDs(res);
  cycles++;
  const s = res > 127 ? res - 256 : res,
    branched = s <= 0,
    next = branched ? c : u8(pc + 3);
  renderRegs(a, b, c, res, branched);
  pc = next;
  renderMem();
  hiliteAsm();
  document.getElementById("status").textContent =
    `Cycle ${cycles}: SUBLEQ [${hx(a)}],[${hx(b)}],${hx(c)} \u2192 ${bv}\u2212${av}=${s} \u2192 ${branched ? "JUMP\u2192" + hx(c) : "fall through"}`;
}

function toggleRun() {
  running = !running;
  const btn = document.getElementById("run-btn");
  if (running) {
    btn.textContent = "Pause";
    btn.className = "btn active-btn";
    startTimer();
  } else {
    btn.textContent = "Run";
    btn.className = "btn";
    stopTimer();
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(stepCPU, Math.round(1000 / speed));
}
function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function updateSpeed(v) {
  speed = parseInt(v);
  document.getElementById("speed-lbl").textContent =
    speed + " step" + (speed === 1 ? "" : "s") + "/s";
  if (running) startTimer();
}

function resetCPU() {
  stopTimer();
  if (running) {
    running = false;
    document.getElementById("run-btn").textContent = "Run";
    document.getElementById("run-btn").className = "btn";
  }
  pc = 0;
  cycles = 0;
  trace = [];
  const p = PROGS[prog];
  if (p.isCustom) mem.set(p.snapshot);
  else p.build(mem);
  mem[IN] = inp;
  renderMem();
  renderLEDs(mem[OUT]);
  renderSwitches();
  buildAsmList();
  hiliteAsm();
  ["r-a", "r-b", "r-c", "r-res"].forEach(
    (id) => (document.getElementById(id).textContent = "\u2014"),
  );
  ["r-av", "r-bv", "r-cv", "r-res2"].forEach(
    (id) => (document.getElementById(id).textContent = "\u2014"),
  );
  document.getElementById("r-pc").textContent = "0x00";
  document.getElementById("r-pc-d").textContent = "dec 0";
  document.getElementById("r-cyc").textContent = "0";
  ["f-n", "f-z", "f-br"].forEach((id) => {
    const e = document.getElementById(id);
    e.className = "flag";
  });
  document.getElementById("f-n").textContent = "N=0";
  document.getElementById("f-z").textContent = "Z=0";
  document.getElementById("f-br").textContent = "branch: NO";
  document.getElementById("instr-decode").innerHTML =
    '<span class="kw">SUBLEQ</span> <span class="ka">A</span>, <span class="kb">B</span>, <span class="kc">C</span>&nbsp;&mdash;&nbsp;' +
    "mem[B] = mem[B] &minus; mem[A]&nbsp;&mdash;&nbsp;if result &le; 0 &rarr; jump to C";
  document.getElementById("cur-instr").textContent = "\u2014";
  document.getElementById("out-trace").textContent = "";
  document.getElementById("status").textContent =
    "Loaded: " + p.name + (p.desc ? " \u2014 " + p.desc : "");
}

function loadProgram(key) {
  prog = key;
  inp = 0;
  rebuildSelect();
  resetCPU();
}

// Close modal on backdrop click
document.getElementById("prog-modal").addEventListener("click", function (e) {
  if (e.target === this) closeEditor();
});

initGrid();
rebuildSelect();
loadProgram("knight");
