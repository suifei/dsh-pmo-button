/**
 * PMO button — Client half v0.12.0.
 * Visual contributions, all session-aware:
 *  - conversation.input.right: ONE control (red start/stop button + a visible
 *    caret that opens the session-level quick menu). The control is a single
 *    slot occupant; the menu is session-scoped.
 *  - conversation.composer.dock: liveness strip.
 *  - plugins.bundle.config: global config panel on the bundle page with
 *    aligned rows and semantic widgets (model/effort/provider dropdowns,
 *    number inputs, textareas) and per-field auto-save through /config/save.
 * Session-level overrides live in the Host's pmo-state.json and only affect
 * the current session; global fields persist for every session.
 * Everything talks to the package-private /pmo-button/* same-origin routes.
 */
window.__ModuleLoader__.load({
  id: '@suifei/dsh-pmo-button',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const BASE = '/pmo-button';
    const VER = 'v0.12.0';
    const EFFORTS = [
      ['', '继承主会话思考等级'],
      ['minimal', 'minimal（最小）'],
      ['low', 'low（低）'],
      ['medium', 'medium（中）'],
      ['high', 'high（高）'],
      ['max', 'max（最大）'],
    ];
    let loadError = null;
    let t = {
      start: 'PMO：启动自动化', stop: 'PMO：运行中，点击停止', busy: 'PMO：处理中…', offline: 'PMO：宿主未响应',
      menuTitle: '会话级审查设置', menuSub: '只影响当前会话；全局默认在 插件 → PMO 按钮 页面配置',
      model: '审查模型', effort: '思考等级', rounds: '轮数上限',
      inheritModel: '继承主会话模型', inheritEffort: '继承主会话思考等级',
      roundsHint: '留空 = 继承全局', saved: '已保存 ✓（对本会话立即生效）', fail: '保存失败',
      close: '关闭', menuAria: '会话级审查设置',
    };

    let menuEl = null;
    let menuCleanup = null;

    const CSS = [
      '.pmo-ctl{display:inline-flex;align-items:center;gap:2px;flex:0 0 auto}',
      '.pmo-btn{position:relative;flex:0 0 auto;width:32px;height:32px;margin:0;padding:0;border:0;border-radius:9999px;',
      'background:var(--dsw-alias-bg-layer-2,#e8e8ea);color:var(--dsw-alias-state-error-primary,#e5484d);display:inline-flex;',
      'align-items:center;justify-content:center;cursor:pointer;transition:background .15s ease,color .15s ease,transform .15s ease}',
      '.pmo-btn:hover{background:var(--dsw-alias-bg-overlay,#dcdcdf)}',
      '.pmo-btn:focus-visible{outline:2px solid currentColor;outline-offset:2px}',
      '.pmo-btn:disabled{opacity:.5;cursor:default}',
      '.pmo-btn svg{width:17px;height:17px;display:block}',
      '.pmo-btn.pmo-on{background:var(--dsw-alias-state-error-primary,#e5484d);color:#fff;',
      'animation:pmo-work 1.4s ease-in-out infinite}',
      '.pmo-btn.pmo-on:hover{filter:brightness(.92)}',
      '@keyframes pmo-work{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}',
      '@media (prefers-reduced-motion:reduce){.pmo-btn.pmo-on{animation:none}}',
      '.pmo-caret-btn{flex:0 0 auto;width:22px;height:32px;margin:0;padding:0;border:0;border-radius:8px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#7a7a80);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;',
      'font-size:11px;line-height:1;transition:background .15s ease,color .15s ease}',
      '.pmo-caret-btn:hover{background:var(--dsw-alias-bg-layer-2,#e8e8ea);color:var(--dsw-alias-label-primary,#222)}',
      '.pmo-caret-btn:focus-visible{outline:2px solid currentColor;outline-offset:1px}',
      '.pmo-strip{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 10px;',
      'font-size:11px;color:var(--dsw-alias-label-secondary,#888);user-select:none}',
      '.pmo-strip .pmo-ok{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-strip .pmo-bad{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.pmo-cfg{width:100%;max-width:760px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:16px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e2e6);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px;line-height:1.45}',
      '.pmo-cfg-section{display:flex;flex-direction:column;gap:8px}',
      '.pmo-cfg-sectitle{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary,#222);',
      'border-bottom:1px solid var(--dsw-alias-border-l1,#eee);padding-bottom:5px}',
      '.pmo-cfg-row{display:grid;grid-template-columns:180px minmax(0,1fr);gap:12px;align-items:center}',
      '.pmo-cfg-row.pmo-wide{display:flex;flex-direction:column;align-items:stretch;gap:6px}',
      '.pmo-cfg-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666);line-height:1.4}',
      '.pmo-cfg-input{width:100%;min-width:0;box-sizing:border-box;height:30px;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font:inherit;font-size:12.5px}',
      'select.pmo-cfg-input{appearance:auto;cursor:pointer}',
      'textarea.pmo-cfg-input{height:auto;min-height:96px;padding:8px;resize:vertical;line-height:1.5}',
      '.pmo-cfg-input:focus{outline:2px solid var(--dsw-alias-brand-primary,#4a7dd8);outline-offset:0}',
      '.pmo-cfg-note{font-size:11px;color:var(--dsw-alias-label-secondary,#888);line-height:1.45}',
      '.pmo-cfg-status{min-height:16px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#888)}',
      '.pmo-menu{position:fixed;z-index:99999;width:400px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;',
      'padding:14px;display:flex;flex-direction:column;gap:10px;border-radius:12px;background:var(--dsw-alias-bg-overlay,#fff);',
      'border:1px solid var(--dsw-alias-border-l2,#c9c9cf);box-shadow:0 12px 32px rgba(0,0,0,.24);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:12.5px;line-height:1.45}',
      '.pmo-menu-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.pmo-menu-title{font-weight:600;font-size:13px}',
      '.pmo-menu-close{width:24px;height:24px;margin:0;padding:0;border:0;border-radius:6px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#888);font-size:16px;line-height:1;cursor:pointer}',
      '.pmo-menu-close:hover{background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-label-primary,#222)}',
      '.pmo-menu-sub{font-size:11px;color:var(--dsw-alias-label-secondary,#888);line-height:1.45}',
      '.pmo-menu-row{display:grid;grid-template-columns:84px minmax(0,1fr);gap:10px;align-items:center}',
      '.pmo-menu-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-menu-select,.pmo-menu-input{width:100%;min-width:0;box-sizing:border-box;height:28px;padding:3px 6px;',
      'border:1px solid var(--dsw-alias-border-l1,#ccc);border-radius:6px;background:var(--dsw-alias-bg-base,#fff);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:12.5px}',
      '.pmo-menu-select{cursor:pointer}',
      '.pmo-menu-hint{grid-column:2;font-size:11px;color:var(--dsw-alias-label-secondary,#888);line-height:1.4;margin-top:-4px}',
      '.pmo-menu-status{min-height:16px;font-size:11.5px;color:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-menu-foot{font-size:10.5px;color:var(--dsw-alias-label-secondary,#999);line-height:1.45;',
      'border-top:1px solid var(--dsw-alias-border-l1,#eee);padding-top:8px}',
    ].join('');

    function pickDict(localeSvc) {
      try {
        const snap = localeSvc && typeof localeSvc.getLocale === 'function' ? localeSvc.getLocale() : null;
        const id = typeof snap === 'string'
          ? snap
          : ((snap && (snap.id || snap.locale)) || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en');
        return String(id).toLowerCase().indexOf('zh') === 0
          ? { start: 'PMO：启动自动化', stop: 'PMO：运行中，点击停止', busy: 'PMO：处理中…', offline: 'PMO：宿主未响应' }
          : { start: 'Start PMO automation', stop: 'PMO running: click to stop', busy: 'PMO: pending…', offline: 'PMO: host unreachable' };
      } catch (e) {
        return { start: 'Start PMO automation', stop: 'PMO running: click to stop', busy: 'PMO: pending…', offline: 'PMO: host unreachable' };
      }
    }

    function sessionIdOf(props) {
      const cands = [
        props ? props.sessionId : void 0,
        props && props.session ? props.session.id : void 0,
        props && props.sessionSnapshot ? props.sessionSnapshot.id : void 0,
        props && props.binding ? props.binding.id : void 0,
      ];
      for (let i = 0; i < cands.length; i++) if (typeof cands[i] === 'string' && cands[i]) return cands[i];
      return 'no-session';
    }

    function el(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== void 0 && text !== null) n.textContent = text;
      return n;
    }

    function closeMenu() {
      if (menuCleanup) { try { menuCleanup(); } catch (e) { /* ignore */ } menuCleanup = null; }
      if (menuEl) { if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }
    }

    function menuRow(label, control, hint) {
      const row = el('div', 'pmo-menu-row');
      row.appendChild(el('span', 'pmo-menu-label', label));
      row.appendChild(control);
      if (hint) row.appendChild(hint);
      return row;
    }

    function openMenu(anchor, sid) {
      closeMenu();
      const stl = el('style');
      stl.textContent = CSS;
      document.head.appendChild(stl);
      const m = el('div', 'pmo-menu');
      const head = el('div', 'pmo-menu-head');
      head.appendChild(el('div', 'pmo-menu-title', t.menuTitle));
      const close = el('button', 'pmo-menu-close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', t.close);
      close.addEventListener('click', closeMenu);
      head.appendChild(close);
      m.appendChild(head);
      m.appendChild(el('div', 'pmo-menu-sub', t.menuSub));

      const selM = el('select', 'pmo-menu-select');
      const optInh = el('option', null, t.inheritModel);
      optInh.value = '';
      selM.appendChild(optInh);
      const selE = el('select', 'pmo-menu-select');
      for (const o of EFFORTS) {
        const opt = el('option', null, o[1]);
        opt.value = o[0];
        selE.appendChild(opt);
      }
      const inR = el('input', 'pmo-menu-input');
      inR.type = 'number';
      inR.min = '0';
      inR.step = '1';
      inR.placeholder = t.roundsHint;
      const hintR = el('div', 'pmo-menu-hint', t.roundsHint);

      m.appendChild(menuRow(t.model, selM));
      m.appendChild(menuRow(t.effort, selE));
      m.appendChild(menuRow(t.rounds, inR, hintR));
      const status = el('div', 'pmo-menu-status');
      m.appendChild(status);
      m.appendChild(el('div', 'pmo-menu-foot', t.menuSub));
      document.body.appendChild(m);

      const r = anchor && anchor.getBoundingClientRect
        ? anchor.getBoundingClientRect()
        : { left: 8, right: 8, top: window.innerHeight - 48, bottom: window.innerHeight - 48 };
      m.style.visibility = 'hidden';
      requestAnimationFrame(function () {
        const mw = m.offsetWidth || 400;
        const mh = m.offsetHeight || 220;
        const maxLeft = Math.max(8, window.innerWidth - mw - 8);
        const left = Math.min(Math.max(8, r.left), maxLeft);
        let top = r.top - mh - 10;
        if (top < 8) top = Math.min(window.innerHeight - mh - 8, r.bottom + 10);
        if (top < 8) top = 8;
        m.style.left = left + 'px';
        m.style.top = top + 'px';
        m.style.visibility = 'visible';
      });

      let wantCombo = '';
      function persist() {
        const q = new URLSearchParams();
        q.set('session', sid);
        const mv = selM.value;
        const i = mv.indexOf('|');
        q.set('provider', i >= 0 ? mv.slice(0, i) : '');
        q.set('model', i >= 0 ? mv.slice(i + 1) : '');
        q.set('effort', selE.value);
        q.set('maxRounds', inR.value.trim());
        fetch(BASE + '/session-config/set?' + q.toString())
          .then(function (res) { return res.json(); })
          .then(function (body) {
            status.textContent = body && body.ok ? t.saved : t.fail;
            status.style.color = body && body.ok ? '' : 'var(--dsw-alias-state-error-primary,#e5484d)';
          })
          .catch(function () {
            status.textContent = t.fail + '（连接）';
            status.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)';
          });
      }
      selM.addEventListener('change', persist);
      selE.addEventListener('change', persist);
      inR.addEventListener('change', persist);

      fetch(BASE + '/config')
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || !body.ok || !body.config) return;
          const n = body.config.maxRounds;
          if (typeof n === 'number') {
            inR.placeholder = '继承全局（' + n + ' 轮）';
            hintR.textContent = '留空 = 继承全局上限（' + n + ' 轮）';
          }
        })
        .catch(function () { });

      fetch(BASE + '/session-config?session=' + encodeURIComponent(sid))
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || !body.ok || !body.override) return;
          const ov = body.override;
          if (ov.provider && ov.model) {
            wantCombo = ov.provider + '|' + ov.model;
            selM.value = wantCombo;
          }
          if (ov.effort) selE.value = ov.effort;
          if (ov.maxRounds !== undefined) inR.value = String(ov.maxRounds);
        })
        .catch(function () { });

      fetch(BASE + '/models')
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || !body.ok || !Array.isArray(body.providers)) return;
          for (const g of body.providers) {
            const og = el('optgroup');
            og.label = g.name || g.provider;
            for (const mm of g.models || []) {
              const opt = el('option', null, (mm.name && mm.name !== mm.id)
                ? mm.name + '（' + g.provider + '/' + mm.id + '）'
                : g.provider + '/' + mm.id);
              opt.value = g.provider + '|' + mm.id;
              og.appendChild(opt);
            }
            selM.appendChild(og);
          }
          if (wantCombo) selM.value = wantCombo;
        })
        .catch(function () { });

      const onDoc = function (e) {
        if (!m.contains(e.target) && e.target !== anchor && !(anchor && anchor.contains(e.target))) closeMenu();
      };
      const onKey = function (e) { if (e.key === 'Escape') closeMenu(); };
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onKey, true);
      menuEl = m;
      menuCleanup = function () {
        document.removeEventListener('mousedown', onDoc, true);
        document.removeEventListener('keydown', onKey, true);
        if (stl.parentNode) stl.parentNode.removeChild(stl);
      };
    }

    function buildPlugin() {
      function PmoControl(props) {
        try {
          const sid = sessionIdOf(props);
          const state = React.useState({ running: false, turns: 0, online: null, pending: false, err: null });
          const view = state[0];
          const setView = state[1];
          const wrapRef = React.useRef(null);

          React.useEffect(function () {
            let dead = false;
            const tick = function () {
              fetch(BASE + '/state?session=' + encodeURIComponent(sid))
                .then(function (r) { return r.json(); })
                .then(function (body) {
                  if (!dead && body && body.ok) {
                    setView(function (v) {
                      return v.pending ? v : { running: !!body.enabled, turns: body.turns || 0, online: true, pending: false, err: null };
                    });
                  }
                })
                .catch(function () { /* keep last known state between polls */ });
            };
            tick();
            const iv = setInterval(tick, 8000);
            return function () { dead = true; clearInterval(iv); };
          }, [sid]);

          function onClick() {
            const next = !view.running;
            setView(function (v) { return Object.assign({}, v, { pending: true }); });
            const q = new URLSearchParams();
            q.set('session', sid);
            q.set('enabled', next ? '1' : '0');
            fetch(BASE + '/toggle?' + q.toString())
              .then(function (r) { return r.json(); })
              .then(function (body) {
                if (body && body.ok) setView({ running: !!body.enabled, turns: next ? 0 : view.turns, online: true, pending: false, err: null });
                else setView(function (v) { return Object.assign({}, v, { pending: false, online: false, err: 'bad response' }); });
              })
              .catch(function (e) { setView(function (v) { return Object.assign({}, v, { pending: false, online: false, err: String(e && e.message || e) }); }); });
          }

          const tip = VER + ' · ' + (view.online === false
            ? t.offline
            : view.pending ? t.busy
            : view.running ? t.stop + '（已记录 ' + view.turns + ' 轮）' : t.start)
            + ' · session:' + (sid === 'no-session' ? '—' : sid.slice(0, 8))
            + ' 路由:' + (view.online === null ? '?' : view.online ? 'ok' : '✗ ' + (view.err || ''));

          return h('div', { className: 'pmo-ctl', ref: wrapRef },
            h('style', null, CSS),
            h('button', {
              type: 'button',
              className: 'pmo-btn' + (view.running ? ' pmo-on' : ''),
              title: tip,
              'aria-label': view.running ? t.stop : t.start,
              'aria-pressed': view.running,
              disabled: view.pending,
              onClick: onClick,
            },
              h('svg', {
                viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
                'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true,
              },
                h('path', { d: 'M12 19V5' }),
                h('path', { d: 'M5 12l7-7 7 7' }),
              ),
            ),
            h('button', {
              type: 'button',
              className: 'pmo-caret-btn',
              title: VER + ' · ' + t.menuTitle + '（模型 / 思考等级 / 轮数）',
              'aria-label': t.menuAria,
              'aria-haspopup': 'dialog',
              onClick: function (ev) {
                ev.stopPropagation();
                openMenu(wrapRef.current, sid);
              },
            }, '▾'),
          );
        } catch (err) {
          return h('span', { className: 'pmo-strip', title: String(err) }, h('span', { className: 'pmo-bad' }), 'PMO按钮渲染异常:' + err);
        }
      }

      function PmoStrip() {
        if (loadError) {
          return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO ' + VER + ' client 异常: ' + loadError);
        }
        const now = new Date().toTimeString().slice(0, 8);
        return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-ok' }), 'PMO ' + VER + ' client 已加载 ' + now);
      }

      function ConfigPanel() {
        const st = React.useState({ loaded: false, cfg: {}, catalog: [], providers: [], msg: '' });
        const view = st[0];
        const set = st[1];

        React.useEffect(function () {
          let dead = false;
          const merge = function (patch) { set(function (s) { return Object.assign({}, s, patch); }); };
          fetch(BASE + '/config')
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (!dead && body && body.ok) merge({ loaded: true, cfg: body.config || {}, msg: '' });
              else if (!dead) merge({ loaded: true, msg: '配置读取失败' });
            })
            .catch(function () { if (!dead) merge({ loaded: true, msg: '配置读取失败（连接）' }); });
          fetch(BASE + '/models')
            .then(function (r) { return r.json(); })
            .then(function (body) { if (!dead && body && body.ok) merge({ catalog: body.providers || [] }); })
            .catch(function () { });
          fetch(BASE + '/providers')
            .then(function (r) { return r.json(); })
            .then(function (body) { if (!dead && body && body.ok) merge({ providers: body.providers || [] }); })
            .catch(function () { });
          return function () { dead = true; };
        }, []);

        function saveFields(patch) {
          set(function (s) { return Object.assign({}, s, { cfg: Object.assign({}, s.cfg, patch), msg: '保存中…' }); });
          const q = new URLSearchParams();
          for (const k of Object.keys(patch)) q.set(k, String(patch[k]));
          fetch(BASE + '/config/save?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (body && body.ok) set(function (s) { return Object.assign({}, s, { cfg: body.config || s.cfg, msg: '已保存 ✓（热生效）' }); });
              else set(function (s) { return Object.assign({}, s, { msg: '保存失败：' + ((body && body.error) || '未知') }); });
            })
            .catch(function () { set(function (s) { return Object.assign({}, s, { msg: '保存失败（连接）' }); }); });
        }

        function textField(key, label, placeholder, wide) {
          const value = view.cfg && view.cfg[key] !== undefined && view.cfg[key] !== null ? String(view.cfg[key]) : '';
          const input = h('input', {
            className: 'pmo-cfg-input', type: 'text', defaultValue: value, placeholder: placeholder || '',
            onBlur: function (e) { saveFields({ [key]: e.target.value }); },
          });
          return h('label', { className: 'pmo-cfg-row' + (wide ? ' pmo-wide' : ''), key: key },
            h('span', { className: 'pmo-cfg-label' }, label), input);
        }
        function numberField(key, label) {
          const value = view.cfg && view.cfg[key] !== undefined && view.cfg[key] !== null ? String(view.cfg[key]) : '';
          return h('label', { className: 'pmo-cfg-row', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('input', {
              className: 'pmo-cfg-input', type: 'number', min: '0', step: '1', defaultValue: value,
              onChange: function (e) { saveFields({ [key]: e.target.value }); },
            }));
        }
        function textareaField(key, label, placeholder) {
          const value = view.cfg && view.cfg[key] !== undefined && view.cfg[key] !== null ? String(view.cfg[key]) : '';
          return h('label', { className: 'pmo-cfg-row pmo-wide', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('textarea', {
              className: 'pmo-cfg-input', defaultValue: value, placeholder: placeholder || '',
              onBlur: function (e) { saveFields({ [key]: e.target.value }); },
            }));
        }
        function modelField() {
          const curProvider = view.cfg && view.cfg.childModelProvider ? String(view.cfg.childModelProvider) : '';
          const curModel = view.cfg && view.cfg.childModel ? String(view.cfg.childModel) : '';
          const combo = curProvider && curModel ? curProvider + '|' + curModel : '';
          const groups = [];
          for (const g of view.catalog || []) {
            const kids = (g.models || []).map(function (m) {
              return h('option', { value: g.provider + '|' + m.id, key: g.provider + '|' + m.id },
                (m.name && m.name !== m.id) ? m.name + '（' + g.provider + '/' + m.id + '）' : g.provider + '/' + m.id);
            });
            groups.push(h('optgroup', { label: g.name || g.provider, key: g.provider }, ...kids));
          }
          const hasCombo = combo && !(view.catalog || []).some(function (g) {
            return (g.models || []).some(function (m) { return g.provider + '|' + m.id === combo; });
          });
          const opts = [h('option', { value: '', key: 'inherit' }, '继承主会话模型')];
          if (hasCombo) opts.push(h('option', { value: combo, key: 'current' }, combo));
          opts.push(...groups);
          return h('label', { className: 'pmo-cfg-row', key: 'childModel' },
            h('span', { className: 'pmo-cfg-label' }, '审查模型'),
            h('select', {
              className: 'pmo-cfg-input', value: combo,
              onChange: function (e) {
                const v = e.target.value;
                const i = v.indexOf('|');
                if (i === -1) saveFields({ childModelProvider: '', childModel: '' });
                else saveFields({ childModelProvider: v.slice(0, i), childModel: v.slice(i + 1) });
              },
            }, ...opts));
        }
        function effortField() {
          const value = view.cfg && view.cfg.childReasoningEffort ? String(view.cfg.childReasoningEffort) : '';
          return h('label', { className: 'pmo-cfg-row', key: 'childReasoningEffort' },
            h('span', { className: 'pmo-cfg-label' }, '思考等级'),
            h('select', {
              className: 'pmo-cfg-input', value: value,
              onChange: function (e) { saveFields({ childReasoningEffort: e.target.value }); },
            }, ...EFFORTS.map(function (o) { return h('option', { value: o[0], key: o[0] || 'inherit' }, o[1]); })));
        }
        function providerField() {
          const value = view.cfg && view.cfg.provider ? String(view.cfg.provider) : 'spawn';
          const list = (view.providers && view.providers.length) ? view.providers.slice() : ['spawn', 'fork'];
          if (list.indexOf(value) === -1) list.push(value);
          return h('label', { className: 'pmo-cfg-row', key: 'provider' },
            h('span', { className: 'pmo-cfg-label' }, '子代理提供方'),
            h('select', {
              className: 'pmo-cfg-input', value: value,
              onChange: function (e) { saveFields({ provider: e.target.value }); },
            }, ...list.map(function (p) { return h('option', { value: p, key: p }, p); })));
        }

        if (!view.loaded) return h('div', { className: 'pmo-cfg' }, h('span', { className: 'pmo-cfg-note' }, 'PMO 配置加载中…'));
        return h('div', { className: 'pmo-cfg' },
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, '审查模型（异构审查：审查方 ≠ 执行方）'),
            modelField(),
            effortField(),
            h('div', { className: 'pmo-cfg-note' }, '留空 = 继承主会话；修改模型/思考等级后，下次启动会重置审查官（记忆清零）。'),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, '运行'),
            numberField('maxRounds', '审查轮数上限（0 = 不限）'),
            numberField('maxChars', '日志单块截断阈值'),
            providerField(),
            textField('childLabel', '子代理标签'),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, '身份与问候'),
            textareaField('greet', '启动问候文本（签到，非审查请求）'),
            textareaField('rolePrompt', '身份提示词（缺席时使用内置审查规程）'),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, '日志'),
            textField('logFile', '日志文件路径', '~/.dsh/logs/pmo-button.log'),
          ),
          h('div', { className: 'pmo-cfg-status', key: 'status' }, view.msg || '各字段修改后自动保存并热生效（文本失焦保存）'),
        );
      }

      return {
        inject: ['slots'],
        apply(c) {
          t = pickDict(c.get ? c.get('locale') : null);
          c.slots.inject('plugins.bundle.config', function () {
            return c.slots.register(
              { name: 'plugins.bundle.config', key: '@suifei/dsh-pmo-button' },
              ConfigPanel,
            );
          });
          c.slots.inject('conversation.composer.dock', function () {
            return c.slots.register(
              { name: 'conversation.composer.dock', id: 'pmo-button-strip', order: 90 },
              PmoStrip,
            );
          });
          c.slots.inject('conversation.input.right', function () {
            return c.slots.register(
              { name: 'conversation.input.right', id: 'pmo-button', order: 10 },
              PmoControl,
            );
          });
        },
      };
    }

    try {
      return buildPlugin();
    } catch (err) {
      loadError = String(err);
      return {
        inject: ['slots'],
        apply(c) {
          c.slots.inject('conversation.composer.dock', function () {
            return c.slots.register(
              { name: 'conversation.composer.dock', id: 'pmo-button-strip', order: 90 },
              function () { return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO v0.12.0 加载失败: ' + loadError); },
            );
          });
        },
      };
    }
  },
});
