"""Build v2/web/html/index.html from the locked v1.0 dashboard (v1.0 is read, never modified).

Usage:  python3 v2/tools/build/build_v2.py [path/to/scfn_dashboard_v1.0.html] [output.html]
Default v1.0 path: the repository's scfn_dashboard_v1.0.html (one level above v2/).
Every patch anchor must match exactly once, so an unexpected v1 change fails the build loudly.
"""
import hashlib, pathlib, sys
B = pathlib.Path(__file__).resolve().parent
V2 = B.parent.parent
SRC = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else V2.parent / "scfn_dashboard_v1.0.html"
OUT = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else V2 / "web/html/index.html"
V1_SHA256_PREFIX = "73ca1891"   # fingerprint of the locked v1.0 release
if not SRC.exists(): sys.exit(f"v1.0 source not found: {SRC} (pass its path as the first argument)")
if not hashlib.sha256(SRC.read_bytes()).hexdigest().startswith(V1_SHA256_PREFIX):
    sys.exit("v1.0 source fingerprint mismatch: the locked release has changed")
s = SRC.read_text(encoding="utf8")

def rep(a, b, label):
    global s
    n = s.count(a)
    if n != 1: sys.exit(f"anchor '{label}' matched {n} times")
    s = s.replace(a, b)

css = (B / "admin_css.css").read_text(encoding="utf8"); js = (B / "admin_js.js").read_text(encoding="utf8")
rep("</style>\n</head>", css + "</style>\n</head>", "css")
rep('<b data-glean-id="app-version">v1.0</b>', '<b data-glean-id="app-version">v2.0</b>', "version label")
rep('  <div class="tab" data-tab="about" onclick="switchTab(\'about\')">About &amp; Methodology</div>',
    '  <div class="tab" data-tab="admin" onclick="switchTab(\'admin\')">Administrator</div>\n'
    '  <div class="tab" data-tab="about" onclick="switchTab(\'about\')">About &amp; Methodology</div>', "tab")

PANEL = '''<!-- ===================== ADMINISTRATOR (v2) ===================== -->
<section class="panel" id="panel-admin" data-glean-id="panel-admin">
  <div class="banner b-info" data-glean-id="admin-banner">
    <div class="ico">🛡</div>
    <div>
      <div class="bt">Administrator · AI Operations Analyst</div>
      <div class="bd">Chat with a local LLM (Ollama) about the simulated hall. <b>Live analysis</b> sends a snapshot of the current state. <b>Twin advisor</b> evaluates what-if configurations with the dashboard's own model and can propose settings for you to apply to the Digital Twin. All data is simulated. AI advice is advisory: check it against the dashboard.</div>
    </div>
    <div class="meta"><div id="admBannerModel">Model —</div></div>
  </div>
  <div class="adm-status" id="admStatus" data-glean-id="admin-status">
    <span class="adm-chip"><span class="led off" id="admLedApi"></span>API <b id="admApi">checking…</b></span>
    <span class="adm-chip"><span class="led off" id="admLedOll"></span>Ollama <b id="admOll">—</b></span>
    <span class="adm-chip"><span class="led off" id="admLedModel"></span>Model <b id="admModel">—</b></span>
    <span class="adm-chip">Runtime <b id="admRt">—</b></span>
    <button class="btn" type="button" onclick="admCheck(true)">Check connection</button>
    <span class="adm-tok" id="admTok"><input type="password" id="admTokIn" placeholder="Administrator token" aria-label="Administrator token" autocomplete="off"><button class="btn primary" type="button" onclick="admSaveToken()">Unlock</button></span>
  </div>
  <div class="adm-grid">
    <div class="card adm-chat" data-glean-id="admin-chat">
      <div class="adm-head">
        <div class="mode-toggle"><button id="admModeA" class="on" type="button" onclick="admSetMode('analyse')">Live analysis</button><button id="admModeT" type="button" onclick="admSetMode('twin')">Twin advisor</button></div>
        <label class="adm-think"><input type="checkbox" id="admThink"> Show model reasoning (slower)</label>
        <button class="btn" type="button" onclick="admClear()">New chat</button>
      </div>
      <div class="adm-chips" id="admChips"></div>
      <div class="adm-msgs" id="admMsgs" aria-live="polite"></div>
      <div class="adm-input">
        <textarea id="admIn" rows="2" placeholder="Ask about the current state" onkeydown="admKey(event)" aria-label="Message to the AI analyst"></textarea>
        <button class="btn primary" type="button" id="admSend" onclick="admSend()">Send</button>
        <button class="btn danger" type="button" id="admStop" onclick="admStop()" style="display:none">Stop</button>
      </div>
      <div class="adm-foot" id="admFoot"></div>
    </div>
    <div class="adm-side">
      <div class="card" id="admCtxA" data-glean-id="admin-context">
        <h3>Context sent to the model</h3>
        <div class="adm-sum" id="admSum"></div>
        <details id="admJsonDet" ontoggle="admRenderSide(true)"><summary>View the JSON snapshot</summary><pre id="admJson"></pre></details>
      </div>
      <div class="card" id="admCtxT" style="display:none" data-glean-id="admin-whatif">
        <h3>What-if scenario <span class="info">i<span class="tip down">Starts from the current Digital Twin configuration. The dashboard evaluates it with its steady-state model (the same v1 formulas, without transient fault ramps). Nothing changes in the live hall until you click Apply to Digital Twin, and Undo apply restores the previous configuration.</span></span></h3>
        <div class="adm-link">Evaluated by the dashboard model, not by the AI. The live hall changes only when you apply.</div>
        <div id="admSliders"></div>
        <div class="adm-acts">
          <button class="btn" type="button" onclick="admScnFromTwin()">Reset to current twin</button>
          <button class="btn primary" type="button" onclick="admAsk('Assess this scenario: can the hall handle it, what is the impact on power, cooling and sustainability versus current and baseline, and how would you optimise it?')">Ask AI to assess</button>
          <button class="btn" type="button" onclick="admApply(ADM.scn,'scenario')">Apply to Digital Twin</button>
          <button class="btn" type="button" id="admUndo" onclick="admUndo()" disabled>Undo apply</button>
        </div>
        <div id="admVerdict"></div>
        <table class="adm-tbl" id="admCmp"></table>
        <div class="adm-hr" id="admHead"></div>
        <details id="admJsonTDet" ontoggle="admRenderSide(true)"><summary>View the JSON sent to the model</summary><pre id="admJsonT"></pre></details>
      </div>
    </div>
  </div>
</section>

'''
rep('<section class="panel about" id="panel-about" data-glean-id="panel-about">', PANEL + '<section class="panel about" id="panel-about" data-glean-id="panel-about">', "panel")

rep("Version 1.0 · locked 9 November 2026. A simulated liquid-cooled AI data hall for demos and enablement. Nothing connects to live equipment, and all figures are synthetic and generated in your browser.",
    "Version 2.0 (in development) · builds on v1.0, locked 9 November 2026. A simulated liquid-cooled AI data hall for demos and enablement. Nothing connects to live equipment, and all figures are synthetic and generated in your browser. New in v2: the Administrator tab with a local AI analyst (Ollama), deployed with Docker.", "about banner")
rep("      <tr><td>Sustainability</td><td>PUE by outdoor temperature, liquid vs air mix, rear doors on or off, and annual carbon, cost and water.</td></tr>\n    </table>\n  </div>",
    "      <tr><td>Sustainability</td><td>PUE by outdoor temperature, liquid vs air mix, rear doors on or off, and annual carbon, cost and water.</td></tr>\n"
    "      <tr><td>Administrator</td><td>v2: chat with a local LLM. Live analysis of the current state, and a Twin advisor that evaluates what-if scenarios, proposes settings and applies them to the Digital Twin with undo.</td></tr>\n    </table>\n  </div>\n"
    '''  <div class="card section-gap" data-glean-id="about-v2">
    <h3>v2 · Administrator AI analyst · how it works</h3>
    <ol class="ab-steps">
      <li><div class="ab-n">1</div><div><div class="ab-t">The dashboard does the maths</div><div class="ab-do">Every value the AI sees is computed in your browser by the same simulation model as the other tabs. In Twin advisor, what-if scenarios and AI proposals are evaluated with the steady-state model before you decide anything.</div></div></li>
      <li><div class="ab-n">2</div><div><div class="ab-t">The AI does the reasoning</div><div class="ab-do">A small API adds the analyst instructions and a JSON snapshot, then streams the answer from a local model served by Ollama (default qwen3:8b; qwen3:14b optional). No data leaves the deployment.</div></div></li>
      <li><div class="ab-n">3</div><div><div class="ab-t">You decide</div><div class="ab-do">AI proposals appear as cards with the dashboard's evaluation. Apply to Digital Twin changes the hall through the normal controls and is logged; Undo apply restores the previous configuration.</div></div></li>
    </ol>
    <div class="ab-prep"><b>Demo (3 min):</b> open <b>Administrator</b> and click <b>Analyse the current state</b>. Switch to <b>Twin advisor</b>, click <b>8 nodes at 100 %</b>, then <b>Maximise compute</b>. Review the proposal card and click <b>Apply to Digital Twin</b>, show the Digital Twin tab, then <b>Undo apply</b>. Say: "The AI explains and proposes; the model verifies; the operator decides."</div>
    <div class="ab-prep"><b>Limits:</b> the what-if evaluator is steady state (no fault transients) and uses the live CRAC and CDU availability. The SFN supply lever is the Digital Twin what-if temperature; applying it sets the Twin to Manual and does not change the live CDU set-point. AI answers can be wrong; the dashboard figures are authoritative.</div>
  </div>''', "about tabs table")

rep("  else if (activeTab==='sustain') renderSustain();\n}", "  else if (activeTab==='sustain') renderSustain();\n  else if (activeTab==='admin') renderAdmin();\n}", "render dispatch")
rep("function switchTab(name){\n  activeTab=name;", "function switchTab(name){\n  activeTab=name;\n  if (name==='admin' && typeof admOnShow==='function') admOnShow();", "switchTab")
rep("\nwindow.addEventListener('DOMContentLoaded', function(){", "\n" + js + "\nwindow.addEventListener('DOMContentLoaded', function(){", "admin js")
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(s, encoding="utf8")
print(f"built {OUT} · {len(s.encode())} bytes · {s.count(chr(10))+1} lines")
