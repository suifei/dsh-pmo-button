/**
 * PMO button — Client half v0.11.0.
 * Visual contributions, all session-aware:
 *  - conversation.input.right: red start/stop control (idle neutral circle +
 *    red arrow; armed red circle with pulse) plus a chevron opening the
 *    session-level quick menu (review model / effort / round-cap overrides).
 *  - conversation.composer.dock: liveness strip.
 *  - plugins.bundle.config: global config panel on the bundle page with
 *    semantic widgets (model/effort dropdowns, number inputs, textarea) and
 *    per-field auto-save through /config/save (configEditor user layer).
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
    const VER = 'v0.11.0';
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
      menuTitle: '会话级审查设置', model: '审查模型', effort: '思考等级', rounds: '轮数上限（空 = 全局）',
      inheritModel: '继承主会话模型', inheritEffort: '继承主会话思考等级',
      loading: '加载中…', saved: '已保存 ✓（对本会话立即生效）', fail: '保存失败',
      foot: '会话级覆盖仅影响当前会话；全局默认在 插件 → PMO 按钮 页面配置',
    };

    let menuEl = null;
    let menuCleanup = null;

    const CSS = [
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
      '.pmo-menu-btn{position:relative;flex:0 0 auto;width:16px;height:28px;margin:0 -2px 0 0;padding:0;border:0;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#888);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;',
      'font-size:10px;line-height:1}',
      '.pmo-menu-btn:hover{color:var(--dsw-alias-label-primary,#333)}',
      '.pmo-strip{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 10px;',
      'font-size:11px;color:var(--dsw-alias-label-secondary,#888);user-select:none}',
      '.pmo-strip .pmo-ok{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-strip .pmo-bad{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.pmo-cfg{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1,#ddd);',
      'border-radius:10px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font-size:12px;max-width:680px}',
      '.pmo-cfg-sectitle{font-weight:600;font-size:12px;color:var(--dsw-alias-label-primary,#333);',
      'border-bottom:1px solid var(--dsw-alias-border-l1,#eee);padding-bottom:4px}',
      '.pmo-cfg-row{display:grid;grid-template-columns:180px 1fr;gap:10px;align-items:center}',
      '.pmo-cfg-row.pmo-wide{display:block}',
      '.pmo-cfg-row.pmo-wide .pmo-cfg-label{display:block;margin-bottom:4px}',
      '.pmo-cfg-label{color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-cfg-input{width:100%;box-sizing:border-box;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font:inherit;font-size:12px}',
      'textarea.pmo-cfg-input{min-height:80px;resize:vertical}',
      '.pmo-cfg-input:focus{outline:1px solid var(--dsw-alias-brand-primary,#4a7dd8)}',
      '.pmo-cfg-status{color:var(--dsw-alias-label-secondary,#888);min-height:14px}',
      '.pmo-menu{position:fixed;z-index:99999;min-width:320px;max-width:380px;padding:12px;display:flex;flex-direction:column;gap:9px;',
      'border-radius:10px;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#c9c9cf);',
      'box-shadow:0 10px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#222);font-size:12px}',
      '.pmo-menu-title{font-weight:600}',
      '.pmo-menu-row{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:center}',
      '.pmo-menu-label{color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-menu-select,.pmo-menu-input{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:12px}',
      '.pmo-menu-status{color:var(--dsw-alias-state-success-primary,#2ea043);min-height:14px}',
      '.pmo-menu-foot{color:var(--dsw-alias-label-secondary,#999);font-size:11px}',
    ].join('');

    const MENU_CSS = [
      '.pmo-menu{position:fixed;z-index:99999;min-width:320px;max-width:380px;padding:12px;display:flex;flex-direction:column;gap:9px;',
      'border-radius:10px;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#c9c9cf);',
      'box-shadow:0 10px 28px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary,#222);font-size:12px}',
      '.pmo-menu-title{font-weight:600}',
      '.pmo-menu-row{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:center}',
      '.pmo-menu-label{color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-menu-select,.pmo-menu-input{width:100%;box-sizing:border-box;padding:4px 6px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:12px}',
      '.pmo-menu-status{color:var(--dsw-alias-state-success-primary,#2ea043);min-height:14px}',
      '.pmo-menu-foot{color:var(--dsw-alias-label-secondary,#999);font-size:11px}',
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

    function closeMenu() {
      if (menuCleanup) { try { menuCleanup(); } catch (e) { /* ignore */ } menuCleanup = null; }
      if (menuEl) { if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }
    }

    function openMenu(anchor, sid) {
      closeMenu();
      const stl = document.createElement('style');
      stl.textContent = MENU_CSS;
      document.head.appendChild(stl);
      const m = document.createElement('div');
      m.className = 'pmo-menu';
      const title = document.createElement('div');
      title.className = 'pmo-menu-title';
      title.textContent = '会话级审查设置';
      m.appendChild(title);
      const rowM = document.createElement('label');
      rowM.className = 'pmo-menu-row';
      const lblM = document.createElement('span');
      lblM.className = 'pmo-menu-label';
      lblM.textContent = t.model;
      const selM = document.createElement('select');
      selM.className = 'pmo-menu-select';
      const optInhM = document.createElement('option');
      optInhM.value = '';
      optInhM.textContent = t.inheritModel;
      selM.appendChild(optInhM);
      rowM.appendChild(lblM);
      rowM.appendChild(selM);
      m.appendChild(rowM);
      const rowE = document.createElement('label');
      rowE.className = 'pmo-menu-row';
      const lblE = document.createElement('span');
      lblE.className = 'pmo-menu-label';
      lblE.textContent = t.effort;
      const selE = document.createElement('select');
      selE.className = 'pmo-menu-select';
      for (const o of EFFORTS) {
        const opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        selE.appendChild(opt);
      }
      rowE.appendChild(lblE);
      rowE.appendChild(selE);
      m.appendChild(rowE);
      const rowR = document.createElement('label');
      rowR.className = 'pmo-menu-row';
      const lblR = document.createElement('span');
      lblR.className = 'pmo-menu-label';
      lblR.textContent = t.rounds;
      const inR = document.createElement('input');
      inR.type = 'number';
      inR.min = '0';
      inR.step = '1';
      inR.className = 'pmo-menu-input';
      inR.placeholder = '全局默认';
      rowR.appendChild(lblR);
      rowR.appendChild(inR);
      m.appendChild(rowR);
      const status = document.createElement('div');
      status.className = 'pmo-menu-status';
      m.appendChild(status);
      const foot = document.createElement('div');
      foot.className = 'pmo-menu-foot';
      foot.textContent = t.foot;
      m.appendChild(foot);
      document.body.appendChild(m);
      const r = anchor.getBoundingClientRect();
      m.style.visibility = 'hidden';
      m.style.position = 'fixed';
      requestAnimationFrame(function () {
        const mw = m.offsetWidth;
        const mh = m.offsetHeight;
        let left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
        let top = r.top - mh - 8;
        if (top < 8) top = Math.min(window.innerHeight - mh - 8, r.bottom + 8);
        m.style.left = left + 'px';
        m.style.top = top + 'px';
        m.style.visibility = 'visible';
      });
      function persist() {
        const q = new URLSearchParams();
        q.set('session', sid);
        q.set('provider', selM.value.split('|')[0] || '');
        q.set('model', selM.value.split('|')[1] || '');
        q.set('effort', selE.value);
        q.set('maxRounds', inR.value.trim());
        fetch(BASE + '/session-config/set?' + q.toString())
          .then(function (res) { return res.json(); })
          .then(function (body) { status.textContent = body && body.ok ? t.saved : t.fail; })
          .catch(function () { status.textContent = t.fail + '（连接）'; });
      }
      selM.addEventListener('change', persist);
      selE.addEventListener('change', persist);
      inR.addEventListener('change', persist);
      fetch(BASE + '/session-config?session=' + encodeURIComponent(sid))
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || !body.ok || !body.override) return;
          const ov = body.override;
          if (ov.provider && ov.model) selM.value = ov.provider + '|' + ov.model;
          if (ov.effort) selE.value = ov.effort;
          if (ov.maxRounds !== undefined) inR.value = String(ov.maxRounds);
        })
        .catch(function () { });
      fetch(BASE + '/models')
        .then(function (res) { return res.json(); })
        .then(function (body) {
          if (!body || !body.ok || !Array.isArray(body.providers)) return;
          for (const g of body.providers) {
            const og = document.createElement('optgroup');
            og.label = g.provider;
            for (const mm of g.models || []) {
              const opt = document.createElement('option');
              opt.value = g.provider + '|' + mm.id;
              opt.textContent = (mm.name && mm.name !== mm.id) ? mm.name + '（' + g.provider + '/' + mm.id + '）' : g.provider + '/' + mm.id;
              og.appendChild(opt);
            }
            selM.appendChild(og);
          }
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
      function PmoButton(props) {
        try {
          const sid = sessionIdOf(props);
          const state = React.useState({ running: false, turns: 0, online: null, pending: false, err: null });
          const view = state[0];
          const setView = state[1];

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

          return h('button', {
            type: 'button',
            className: 'pmo-btn' + (view.running ? ' pmo-on' : ''),
            title: tip,
            'aria-label': view.running ? t.stop : t.start,
            'aria-pressed': view.running,
            disabled: view.pending,
            onClick: onClick,
          },
            h('style', null, CSS),
            h('svg', {
              viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': true,
            },
              h('path', { d: 'M12 19V5' }),
              h('path', { d: 'M5 12l7-7 7 7' }),
            ),
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

      function MenuButton(props) {
        try {
          const sid = sessionIdOf(props);
          return h('button', {
            type: 'button',
            className: 'pmo-menu-btn',
            title: VER + ' · 会话级审查设置（模型 / 思考等级 / 轮数上限）',
            'aria-label': 'PMO 会话级审查设置',
            onClick: function (ev) {
              ev.stopPropagation();
              openMenu(ev.currentTarget, sid);
            },
          },
            h('style', null, CSS),
            h('span', { className: 'pmo-caret', 'aria-hidden': true }, '▾'),
          );
        } catch (err) {
          return null;
        }
      }

      const CFG_SECTIONS = [
        {
          title: '循环',
          fields: [
            ['maxRounds', '审查轮数上限（0 = 不限）', 'number'],
            ['maxChars', '日志单块截断阈值', 'number'],
          ],
        },
        {
          title: '身份与问候',
          fields: [
            ['childLabel', '子代理标签'],
            ['provider', '子代理提供方（spawn）'],
            ['greet', '启动问候文本（签到，非审查请求）'],
          ],
        },
        {
          title: '日志',
          fields: [
            ['logFile', '日志文件路径（默认 ~/.dsh/logs/pmo-button.log）'],
          ],
        },
      ];

      function ConfigPanel() {
        const st = React.useState({ loaded: false, cfg: {}, editor: true, msg: '', catalog: null });
        const view = st[0];
        const set = st[1];

        React.useEffect(function () {
          let dead = false;
          fetch(BASE + '/config')
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (!dead && body && body.ok) set(function (s) { return Object.assign({}, s, { loaded: true, cfg: body.config || {}, editor: body.editorAvailable !== false }); });
            })
            .catch(function () { if (!dead) set(function (s) { return Object.assign({}, s, { loaded: true }); }); });
          fetch(BASE + '/models')
            .then(function (r) { return r.json(); })
            .then(function (body) { if (!dead && body && body.ok) set(function (s) { return Object.assign({}, s, { catalog: body.providers || [] }); }); })
            .catch(function () { });
          return function () { dead = true; };
        }, []);

        function saveField(key, value) {
          const q = new URLSearchParams();
          q.set(key, String(value));
          fetch(BASE + '/config/save?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (body) { set(function (s) { return Object.assign({}, s, { msg: body && body.ok ? '已保存 ✓（热生效）' : '保存失败：' + ((body && body.error) || '未知') }); }); })
            .catch(function () { set(function (s) { return Object.assign({}, s, { msg: '保存失败（连接）' }); }); });
        }

        function textField(key, label, placeholder) {
          const value = view.cfg && view.cfg[key] !== undefined && view.cfg[key] !== null ? String(view.cfg[key]) : '';
          return h('label', { className: 'pmo-cfg-row', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('input', {
              className: 'pmo-cfg-input', type: 'text', defaultValue: value, placeholder: placeholder || '',
              onChange: function (e) { saveField(key, e.target.value); },
            }),
          );
        }
        function numberField(key, label) {
          const value = view.cfg && view.cfg[key] !== undefined && view.cfg[key] !== null ? String(view.cfg[key]) : '';
          return h('label', { className: 'pmo-cfg-row', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('input', {
              className: 'pmo-cfg-input', type: 'number', min: '0', step: '1', defaultValue: value,
              onChange: function (e) { saveField(key, e.target.value); },
            }),
          );
        }
        function modelSelect() {
          const curProvider = view.cfg && view.cfg.childModelProvider ? view.cfg.childModelProvider : '';
          const curModel = view.cfg && view.cfg.childModel ? view.cfg.childModel : '';
          const combo = curProvider && curModel ? curProvider + '|' + curModel : '';
          const pool = (view.catalog && view.catalog.length)
            ? view.catalog
            : (curProvider && curModel ? [{ provider: curProvider, models: [{ id: curModel, name: curModel }] }] : []);
          const groups = [];
          for (const g of pool) {
            const og = h('optgroup', { label: g.provider, key: g.provider });
            for (const m of g.models || []) og.appendChild(h('option', { value: g.provider + '|' + m.id, key: m.id }, (m.name && m.name !== m.id) ? m.name + '（' + g.provider + '/' + m.id + '）' : g.provider + '/' + m.id));
            groups.push(og);
          }
          return h('label', { className: 'pmo-cfg-row', key: 'childModel' },
            h('span', { className: 'pmo-cfg-label' }, '审查模型（空 = 继承主会话）'),
            h('select', {
              className: 'pmo-cfg-input', value: combo,
              onChange: function (e) {
                const v = e.target.value;
                const i = v.indexOf('|');
                if (i === -1) saveField('childModelProvider', '');
                else {
                  saveField('childModelProvider', v.slice(0, i));
                  saveField('childModel', v.slice(i + 1));
                }
              },
            },
              h('option', { value: '', key: 'inherit' }, '继承主会话模型'),
              groups,
            ),
          );
        }

        if (!view.loaded) return h('div', { className: 'pmo-cfg' }, h('span', { className: 'pmo-cfg-note' }, 'PMO 配置加载中…'));
        const sections = [
          { title: '循环', rows: [numberField('maxRounds', '审查轮数上限（0 = 不限）'), numberField('maxChars', '日志单块截断阈值')] },
          {
            title: '审查官（子代理）',
            rows: [textField('childLabel', '子代理标签'), textField('provider', '子代理提供方（spawn）'), modelSelect()],
          },
          { title: '身份与问候', rows: [textField('greet', '启动问候文本（签到，非审查请求）')] },
          { title: '日志', rows: [textField('logFile', '日志文件路径（默认 ~/.dsh/logs/pmo-button.log）')] },
        ];
        const out = [h('div', { className: 'pmo-cfg-sectitle', key: 'h-model' }, '审查模型（异构审查：审查方 ≠ 执行方）'), modelSelect()];
        for (const sec of sections) {
          out.push(h('div', { className: 'pmo-cfg-sectitle', key: sec.title }, sec.title));
          for (const row of sec.rows) out.push(row);
        }
        out.push(h('div', { className: 'pmo-cfg-status', key: 'status' }, view.msg || '各字段修改后自动保存并热生效'));
        return h('div', { className: 'pmo-cfg' }, out);
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
              PmoButton,
            );
          });
          c.slots.inject('conversation.input.right', function () {
            return c.slots.register(
              { name: 'conversation.input.right', id: 'pmo-button-menu', order: 11 },
              MenuButton,
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
              function () { return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO v0.11.0 加载失败: ' + loadError); },
            );
          });
        },
      };
    }
  },
});
