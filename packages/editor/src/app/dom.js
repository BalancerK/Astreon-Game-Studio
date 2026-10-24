// A tiny element builder and the editor's stylesheet.

/** h('div', { class: 'x', onclick: fn, dataset: { id: 1 } }, 'text', child) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== undefined && c !== null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

export const CSS = `
:root { --bg:#1b1d22; --panel:#23262d; --panel2:#2a2e36; --line:#363a44; --text:#d8dbe2; --dim:#8b91a0; --accent:#4d8bf5; --accent2:#3a6fd0; --warn:#e5a93d; --bad:#e0605e; --good:#5cc489; }
* { box-sizing: border-box; }
html, body { margin:0; height:100%; background:var(--bg); color:var(--text); font:13px/1.35 system-ui, Segoe UI, sans-serif; overflow:hidden; }
button, input, select, textarea { font:inherit; color:inherit; }
#ed { display:grid; grid-template: "bar bar bar" 38px "left stage right" 1fr "status status status" 24px / 250px 1fr 310px; height:100vh; }
.bar { grid-area:bar; display:flex; align-items:center; gap:6px; padding:0 8px; background:var(--panel); border-bottom:1px solid var(--line); }
.bar .sep { width:1px; height:20px; background:var(--line); margin:0 4px; }
.bar .title { font-weight:600; margin-right:6px; }
.btn { background:var(--panel2); border:1px solid var(--line); border-radius:4px; padding:3px 9px; cursor:pointer; }
.btn:hover { border-color:var(--accent); }
.btn.on { background:var(--accent2); border-color:var(--accent); }
.btn:disabled { opacity:.4; cursor:default; border-color:var(--line); }
.btn.play { background:#2b5a3d; border-color:#3f8a5c; } .btn.play.on { background:#8a3a3a; border-color:#c25b5b; }
select.btn { padding:3px 5px; }
.left { grid-area:left; display:flex; flex-direction:column; background:var(--panel); border-right:1px solid var(--line); min-height:0; }
.right { grid-area:right; background:var(--panel); border-left:1px solid var(--line); overflow:auto; }
.pane-title { padding:6px 10px; font-weight:600; color:var(--dim); text-transform:uppercase; font-size:11px; letter-spacing:.05em; border-bottom:1px solid var(--line); background:var(--panel2); }
#hier { flex:1 1 60%; overflow:auto; min-height:0; }
#palette { flex:0 0 36%; overflow:auto; border-top:1px solid var(--line); }
.row { display:flex; align-items:center; gap:4px; padding:2px 8px; cursor:default; white-space:nowrap; border-top:2px solid transparent; border-bottom:2px solid transparent; }
.row:hover { background:#2d313a; }
.row .label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.row input.rename { width:100%; box-sizing:border-box; padding:1px 4px; font:inherit; background:#10131c; color:inherit; border:1px solid #5a78d8; border-radius:3px; }
.row input.rename.bad { border-color:#e5534b; }
.row.sel { background:#2c4f8c; } .row.primary { background:#3665b5; }
.row.off { opacity:.45; text-decoration:line-through; }
.row.drop-into { outline:1px solid var(--accent); outline-offset:-2px; background:#2a3e63; }
.row.drop-before { border-top-color:var(--accent); } .row.drop-after { border-bottom-color:var(--accent); }
.row .arrow { width:12px; text-align:center; color:var(--dim); cursor:pointer; user-select:none; }
.row .meta { color:var(--dim); font-size:11px; margin-left:auto; padding-left:8px; overflow:hidden; text-overflow:ellipsis; }
.row.bad .label { color:var(--bad); }
.item { padding:3px 10px; cursor:grab; } .item:hover { background:#2d313a; }
#stage { grid-area:stage; position:relative; overflow:hidden; background:#000; outline:none; }
#stage canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
#overlay { pointer-events:none; }
#stage .hud { position:absolute; left:8px; bottom:8px; color:#cfd3dc; background:#0008; padding:3px 8px; border-radius:4px; font-size:11px; pointer-events:none; }
#stage .banner { position:absolute; top:8px; left:50%; transform:translateX(-50%); background:#8a3a3ae0; padding:3px 14px; border-radius:4px; pointer-events:none; }
.marquee { position:absolute; border:1px solid var(--accent); background:#4d8bf522; pointer-events:none; }
.status { grid-area:status; display:flex; align-items:center; gap:12px; padding:0 10px; background:var(--panel); border-top:1px solid var(--line); color:var(--dim); font-size:12px; }
.status .problems { cursor:pointer; } .status .problems.bad { color:var(--bad); } .status .problems.ok { color:var(--good); }
.status .msg { margin-left:auto; color:var(--text); }
.sect { border-bottom:1px solid var(--line); }
.sect > .head { padding:5px 10px; background:var(--panel2); font-weight:600; cursor:pointer; user-select:none; }
.sect.colour .swatch { display:inline-block; width:12px; height:12px; border-radius:3px; margin-right:6px; vertical-align:-2px; border:1px solid #0006; }
.field { display:grid; grid-template-columns: 105px 1fr 18px; gap:6px; align-items:center; padding:2px 10px; }
.field label { color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.field.over label { color:var(--text); }
.field input[type=text], .field input[type=number], .field textarea, .field select { width:100%; background:#171a1f; border:1px solid var(--line); border-radius:3px; padding:2px 5px; min-width:0; }
.field input:focus, .field textarea:focus { outline:1px solid var(--accent); border-color:var(--accent); }
.field .vec { display:flex; gap:3px; } .field .vec input { flex:1; }
.field .reset { width:16px; height:16px; line-height:12px; padding:0; text-align:center; background:none; border:none; color:var(--warn); cursor:pointer; visibility:hidden; }
.field.over .reset { visibility:visible; }
.field .err { grid-column:2 / 4; color:var(--bad); font-size:11px; }
.field.readonly span { color:var(--dim); }
.empty { padding:16px; color:var(--dim); }
.problem { padding:2px 10px; cursor:pointer; } .problem:hover { background:#2d313a; } .problem.warning { color:var(--warn); } .problem.error { color:var(--bad); }
#problems { position:absolute; left:250px; right:310px; bottom:24px; max-height:35%; overflow:auto; background:var(--panel); border:1px solid var(--line); z-index:5; }
#help { position:absolute; inset:60px auto auto 50%; transform:translateX(-50%); background:var(--panel); border:1px solid var(--line); border-radius:6px; padding:12px 18px; z-index:6; box-shadow:0 8px 30px #0009; }
#help table td { padding:2px 14px 2px 0; } #help kbd { background:var(--panel2); border:1px solid var(--line); border-radius:3px; padding:0 5px; }
`;

