/**
 * PMO button — Client half v0.9.0 (button + liveness strip + config panel).
 * Red start/stop control in `conversation.input.right` (idle: neutral circle
 * with red arrow; armed: red circle with pulse animation) plus a liveness
 * strip in `conversation.composer.dock`. State is owned by the Host half via
 * the package-private /pmo-button/* same-origin routes; errors surface in the
 * tooltip and the strip instead of vanishing.
 */
window.__ModuleLoader__.load({
  id: '@suifei/dsh-pmo-button',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const BASE = '/pmo-button';
    const VER = 'v0.9.0';
    let loadError = null;
    let t = { start: 'Start PMO automation', stop: 'PMO running: click to stop', busy: 'PMO: pending…', offline: 'PMO: host unreachable' };

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
      '.pmo-strip{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 10px;',
      'font-size:11px;color:var(--dsw-alias-label-secondary,#888);user-select:none}',
      '.pmo-strip .pmo-ok{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-strip .pmo-bad{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.pmo-cfg{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1,#ddd);',
      'border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font-size:12px;max-width:720px}',
      '.pmo-cfg-title{font-weight:600;font-size:12px}',
      '.pmo-cfg-note{color:var(--dsw-alias-label-secondary,#888)}',
      '.pmo-cfg-row{display:grid;grid-template-columns:150px 1fr;gap:8px;align-items:center}',
      '.pmo-cfg-row textarea{grid-column:1 / -1;min-height:72px;resize:vertical}',
      '.pmo-cfg-label{color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-cfg-input{width:100%;box-sizing:border-box;padding:4px 8px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:6px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font:inherit;font-size:12px}',
      '.pmo-cfg-input:focus{outline:1px solid var(--dsw-alias-brand-primary,#4a7dd8)}',
      '.pmo-cfg-save{align-self:flex-start;padding:4px 14px;border:0;border-radius:6px;cursor:pointer;',
      'background:var(--dsw-alias-brand-primary,#4a7dd8);color:#fff;font:inherit;font-size:12px}',
      '.pmo-cfg-save:disabled{opacity:.5;cursor:default}',
      '.pmo-cfg-status{color:var(--dsw-alias-label-secondary,#888)}',
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

    function buildPlugin() {
      function PmoButton(props) {
        try {
          const sid = sessionIdOf(props);
          const state = React.useState({ running: false, turns: 0, online: null, pending: false });
          const view = state[0];
          const setView = state[1];

          React.useEffect(function () {
            let dead = false;
            // Poll the host state so a Host-side auto-extinguish (STATUS !==
            // CONTINUE or the review-round cap) dims the button too.
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
            // GET with query params: same-origin POST was observed blocked by the
            // desktop shell's connection admission, so toggle rides on GET too.
            fetch(BASE + '/toggle?session=' + encodeURIComponent(sid) + '&enabled=' + (next ? '1' : '0'))
              .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
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

      // Dumb marker strip below the composer card — proves the module is alive.
      function PmoStrip() {
        if (loadError) {
          return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO ' + VER + ' client 异常: ' + loadError);
        }
        const now = new Date().toTimeString().slice(0, 8);
        return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-ok' }), 'PMO ' + VER + ' client 已加载 ' + now);
      }

      const CFG_FIELDS = [
        ['maxRounds', '审查轮数上限（0 = 不限）', 'number'],
        ['greet', '启动问候文本'],
        ['childLabel', '子代理标签'],
        ['provider', '子代理提供方（spawn）'],
        ['childModelProvider', '审查模型提供方（空 = 继承主会话）'],
        ['childModel', '审查模型（空 = 继承主会话）'],
        ['childReasoningEffort', '审查思考等级（空 = 继承主会话）'],
        ['maxChars', '日志单块截断阈值', 'number'],
        ['logFile', '日志文件路径'],
        ['rolePrompt', '身份提示词（每会话仅发一次；置空禁用）', 'textarea'],
      ];

      function ConfigPanel() {
        const st = React.useState({ loaded: false, cfg: {}, editor: true, saving: false, msg: '' });
        const view = st[0]; const set = st[1];
        const refs = React.useRef({});
        React.useEffect(function () {
          let dead = false;
          fetch(BASE + '/config')
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (!dead && body && body.ok) set(function (s) { return Object.assign({}, s, { loaded: true, cfg: body.config || {}, editor: body.editorAvailable !== false }); });
            })
            .catch(function () { if (!dead) set(function (s) { return Object.assign({}, s, { loaded: true, cfg: {}, editor: false }); }); });
          return function () { dead = true; };
        }, []);
        function row(f) {
          const val = view.cfg && view.cfg[f[0]] !== undefined && view.cfg[f[0]] !== null ? String(view.cfg[f[0]]) : '';
          const attrs = { className: 'pmo-cfg-input', type: f[2] === 'number' ? 'number' : 'text', defaultValue: val, ref: function (el) { refs.current[f[0]] = el; } };
          return h('label', { className: 'pmo-cfg-row', key: f[0] },
            h('span', { className: 'pmo-cfg-label' }, f[1]),
            f[2] === 'textarea'
              ? h('textarea', { className: 'pmo-cfg-input', defaultValue: val, ref: function (el) { refs.current[f[0]] = el; } })
              : h('input', attrs),
          );
        }
        function save() {
          set(function (s) { return Object.assign({}, s, { saving: true, msg: '' }); });
          const q = new URLSearchParams();
          CFG_FIELDS.forEach(function (f) { q.set(f[0], (refs.current[f[0]] && refs.current[f[0]].value) || ''); });
          fetch(BASE + '/config/save?' + q.toString())
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (body && body.ok) set(function (s) { return Object.assign({}, s, { saving: false, msg: '已保存 ✓（配置热生效）' }); });
              else set(function (s) { return Object.assign({}, s, { saving: false, msg: '保存失败：' + ((body && body.error) || '未知') }); });
            })
            .catch(function () { set(function (s) { return Object.assign({}, s, { saving: false, msg: '连接中断——配置可能已保存，请刷新本页验证' }); }); });
        }
        if (!view.loaded) return h('div', { className: 'pmo-cfg' }, h('span', { className: 'pmo-cfg-note' }, 'PMO 配置加载中…'));
        return h('div', { className: 'pmo-cfg' },
          h('div', { className: 'pmo-cfg-title' }, 'PMO 按钮配置' + (view.editor ? '' : '（当前部署不支持持久保存，仅展示）')),
          CFG_FIELDS.map(row),
          h('button', { className: 'pmo-cfg-save', disabled: view.saving || !view.editor, onClick: save }, view.saving ? '保存中…' : '保存配置'),
          h('span', { className: 'pmo-cfg-status' }, view.msg || '保存后配置热生效；审查模型变更将在下次启动时重置子代理（审查记忆清零）'),
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
              PmoButton,
            );
          });
        },
      };
    }

    try {
      return buildPlugin();
    } catch (err) {
      // Factory-level failure: still return a plugin so the strip can show why.
      loadError = String(err);
      return {
        inject: ['slots'],
        apply(c) {
          c.slots.inject('conversation.composer.dock', function () {
            return c.slots.register(
              { name: 'conversation.composer.dock', id: 'pmo-button-strip', order: 90 },
              function () { return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO ' + VER + ' 加载失败: ' + loadError); },
            );
          });
        },
      };
    }
  },
});
