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
    const VER = 'v0.12.3';
    /** Effort choices from the model's DSH reasoning catalog. No hardcoded
     *  minimal/low/... fallback: without a concrete model the only honest
     *  choice is inherit. Both the session menu and the config panel use this
     *  single builder (qwen: off/low/medium/high; deepseek-flash: off/low/high/max). */
    function effortChoices(reasoning, current) {
      const out = [{ value: '', label: t.inheritEffort }];
      const rows = reasoning && Array.isArray(reasoning.efforts) ? reasoning.efforts : [];
      for (const e of rows) {
        const id = String(e.id || '');
        if (!id) continue;
        const name = String(e.name || id);
        out.push({ value: id, label: (name && name !== id) ? name + '（' + id + '）' : (name || id) });
      }
      const has = out.some(function (o) { return o.value === current; });
      if (current && !has) {
        out.push({
          value: current,
          label: current + (rows.length ? '（当前模型不支持）' : '（模型能力未知，先选模型）'),
        });
      }
      return out;
    }
    let loadError = null;
    let t = {
      start: 'PMO：启动自动化', stop: 'PMO：运行中，点击停止', busy: 'PMO：处理中…', offline: 'PMO：宿主未响应',
      menuTitle: '会话级审查设置', menuSub: '只影响当前会话；全局默认在 插件 → PMO 按钮 页面配置；思考等级按所选模型能力列出，模型留空时只能继承。',
      model: '审查模型', effort: '思考等级', rounds: '轮数上限',
      inheritModel: '继承主会话模型', inheritEffort: '继承主会话思考等级',
      roundsHint: '留空 = 继承全局', saved: '已保存 ✓', savedReset: '已保存 ✓（审查官已重置，下次审查使用新模型）', fail: '保存失败',
      close: '关闭', menuAria: '会话级审查设置',
    };

    let menuEl = null;
    let menuCleanup = null;
    let menuOnClose = null;

    const CSS = [
      '.pmo-ctl{position:relative;display:inline-block;flex:0 0 auto;width:56px;height:32px;border-radius:9999px}',
      '.pmo-ctl .pmo-svg{position:absolute;inset:0;width:56px;height:32px;display:block;pointer-events:none}',
      '.pmo-zone{position:absolute;top:0;bottom:0;margin:0;padding:0;border:0;background:transparent;cursor:pointer;z-index:2}',
      '.pmo-zone.left{left:0;width:38px;border-radius:16px 0 0 16px}',
      '.pmo-zone.right{right:0;width:18px;border-radius:0 16px 16px 0}',
      '.pmo-zone.left:hover{background:rgba(0,0,0,.02)}',
      '.pmo-zone.right:hover{background:rgba(0,0,0,.03)}',
      '.pmo-zone:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7dd8);outline-offset:-2px}',
      '.pmo-zone:disabled{cursor:default}',
      '@media (prefers-reduced-motion:reduce){.pmo-svg animate,.pmo-svg animateTransform{display:none}}',
      '.pmo-strip{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:2px 10px;',
      'font-size:11px;color:var(--dsw-alias-label-secondary,#888);user-select:none}',
      '.pmo-strip .pmo-ok{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-strip .pmo-bad{width:7px;height:7px;border-radius:9999px;background:var(--dsw-alias-state-error-primary,#e5484d)}',
      '.pmo-cfg{width:100%;max-width:760px;box-sizing:border-box;display:flex;flex-direction:column;gap:18px;padding:18px;',
      'border:1px solid var(--dsw-alias-border-l1,#e2e2e6);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px;line-height:1.5}',
      '.pmo-cfg-section{display:flex;flex-direction:column;gap:10px}',
      '.pmo-cfg-sectitle{font-weight:600;font-size:13px;color:var(--dsw-alias-label-primary,#222);padding-bottom:2px}',
      '.pmo-cfg-row{display:grid;grid-template-columns:minmax(140px,180px) minmax(0,1fr);gap:12px;align-items:center}',
      '.pmo-cfg-row.pmo-wide{display:flex;flex-direction:column;align-items:stretch;gap:6px}',
      '.pmo-cfg-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666);line-height:1.45}',
      '.pmo-cfg-input{width:100%;min-width:0;box-sizing:border-box;height:32px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l1,#ccc);',
      'border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#222);',
      'font:inherit;font-size:13px}',
      'select.pmo-cfg-input{appearance:auto;cursor:pointer}',
      'textarea.pmo-cfg-input{height:auto;min-height:96px;padding:8px 10px;resize:vertical;line-height:1.5}',
      '.pmo-cfg-input:focus{outline:2px solid var(--dsw-alias-brand-primary,#4a7dd8);outline-offset:0}',
      '.pmo-cfg-note{font-size:11.5px;color:var(--dsw-alias-label-secondary,#888);line-height:1.5}',
      '.pmo-cfg-status{min-height:16px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#888)}',
      '.pmo-menu{position:fixed;z-index:99999;width:388px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;',
      'padding:14px;display:flex;flex-direction:column;gap:12px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);',
      'border:1px solid var(--dsw-alias-border-l1,#e2e2e6);box-shadow:0 10px 28px rgba(0,0,0,.14);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px;line-height:1.5}',
      '.pmo-menu-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
      '.pmo-menu-title{font-weight:600;font-size:13px}',
      '.pmo-menu-close{width:24px;height:24px;margin:0;padding:0;border:0;border-radius:6px;background:transparent;',
      'color:var(--dsw-alias-label-secondary,#888);font-size:16px;line-height:1;cursor:pointer}',
      '.pmo-menu-close:hover{background:var(--dsw-alias-bg-layer-2,#eee);color:var(--dsw-alias-label-primary,#222)}',
      '.pmo-menu-sub{font-size:11.5px;color:var(--dsw-alias-label-secondary,#888);line-height:1.5}',
      '.pmo-menu-row{display:grid;grid-template-columns:84px minmax(0,1fr);gap:10px;align-items:center}',
      '.pmo-menu-label{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}',
      '.pmo-menu-select,.pmo-menu-input{width:100%;min-width:0;box-sizing:border-box;height:30px;padding:3px 8px;',
      'border:1px solid var(--dsw-alias-border-l1,#ccc);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);',
      'color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px}',
      '.pmo-menu-select{cursor:pointer}',
      '.pmo-menu-hint{grid-column:2;font-size:11px;color:var(--dsw-alias-label-secondary,#888);line-height:1.45;margin-top:-4px}',
      '.pmo-menu-status{min-height:16px;font-size:11.5px;color:var(--dsw-alias-state-success-primary,#2ea043)}',
      '.pmo-menu-foot{font-size:11px;color:var(--dsw-alias-label-secondary,#999);line-height:1.5;',
      'border-top:1px solid var(--dsw-alias-border-l1,#eee);padding-top:8px}',
    ].join('');

    /** DeepSeek whale glyph from the supplied pill artwork (one source of truth). */
    const WHALE_D = 'M26.5542 4.34393C26.2719 4.20592 26.1506 4.46928 25.9856 4.60268C25.9292 4.64581 25.8815 4.70216 25.8338 4.75391C25.4215 5.19438 24.9396 5.48361 24.3105 5.44911C23.3905 5.39736 22.605 5.68659 21.9104 6.39041C21.7626 5.52271 21.2721 5.00462 20.5258 4.67226C20.1353 4.49976 19.7403 4.32668 19.4666 3.95119C19.2757 3.68381 19.2234 3.38595 19.1279 3.09211C19.0669 2.91501 19.0066 2.73388 18.8024 2.7034C18.5811 2.6689 18.4942 2.85463 18.4074 3.00989C18.0601 3.6447 17.9255 4.34393 17.9388 5.05235C17.9692 6.64572 18.642 7.91478 19.9789 8.81756C20.1307 8.92106 20.1698 9.02457 20.1221 9.1758C20.0307 9.48688 19.9226 9.78876 19.8271 10.0998C19.7662 10.2982 19.6753 10.3419 19.4626 10.2551C18.7288 9.94862 18.0952 9.49493 17.5351 8.94694C16.5846 8.02749 15.7249 7.01258 14.6531 6.21791C14.4013 6.03218 14.1494 5.85967 13.8889 5.69522C12.7952 4.63316 14.0321 3.76086 14.3185 3.65736C14.618 3.54925 14.4225 3.17779 13.4548 3.18239C12.487 3.18642 11.6015 3.51073 10.4727 3.94256C10.3077 4.00754 10.1341 4.05469 9.95637 4.09379C8.93227 3.89944 7.86849 3.85631 6.75755 3.98167C4.66564 4.21455 2.99464 5.20358 1.7664 6.89183C0.290908 8.92106 -0.0564026 11.2269 0.368535 13.6316C0.815324 16.1663 2.10911 18.2645 4.09695 19.905C6.15838 21.6059 8.53263 22.4397 11.2415 22.2799C12.8867 22.185 14.7181 21.9648 16.7841 20.2161C17.3051 20.4755 17.8519 20.579 18.7587 20.6566C19.4574 20.7216 20.1302 20.6221 20.6511 20.514C21.4671 20.3415 21.4107 19.5859 21.1157 19.4473C18.7242 18.3335 19.2492 18.7866 18.772 18.4198C19.987 16.9822 21.8431 14.4269 22.4158 10.9474C22.4722 10.5633 22.5441 10.0222 22.5355 9.71114C22.5309 9.52138 22.5746 9.44778 22.7913 9.42593C23.3905 9.35693 23.9718 9.19305 24.506 8.89921C26.0557 8.05279 26.6808 6.6624 26.828 4.996C26.8498 4.74126 26.8234 4.47791 26.5542 4.34393ZM13.0511 19.3438C10.7332 17.5216 9.60906 16.9219 9.14502 16.9477C8.71089 16.9736 8.78909 17.4704 8.88454 17.7942C8.98459 18.1139 9.11455 18.3341 9.29683 18.6147C9.42276 18.8004 9.50959 19.0764 9.1709 19.284C8.42453 19.7458 7.12671 19.1288 7.06576 19.0983C5.55519 18.2087 4.29245 17.0346 3.40233 15.4285C2.54268 13.8829 2.04356 12.2245 1.96133 10.4546C1.93948 10.0274 2.06541 9.87617 2.49092 9.79854C3.05099 9.69504 3.62831 9.67319 4.1878 9.75541C6.55342 10.101 8.56713 11.1585 10.2554 12.8341C11.2191 13.788 11.9482 14.9283 12.6992 16.0421C13.4979 17.2249 14.357 18.3519 15.4512 19.276C15.8377 19.5997 16.1459 19.8458 16.4408 20.0275C15.5513 20.127 14.0666 20.1483 13.0511 19.345V19.3438ZM14.162 12.1981C14.162 12.0083 14.3139 11.8571 14.5048 11.8571C14.5479 11.8571 14.587 11.8657 14.6221 11.8784C14.6698 11.8956 14.7135 11.9215 14.748 11.9606C14.8089 12.021 14.8434 12.1072 14.8434 12.1981C14.8434 12.3878 14.6916 12.5391 14.5007 12.5391C14.3098 12.5391 14.162 12.3878 14.162 12.1981ZM17.6127 13.968C17.3913 14.0588 17.17 14.1365 16.9572 14.1451C16.6271 14.1623 16.2672 14.0284 16.0717 13.8645C15.7681 13.6098 15.5507 13.4671 15.4599 13.0227C15.4208 12.8329 15.4426 12.5391 15.4771 12.3706C15.5553 12.0078 15.4685 11.7749 15.2126 11.5633C15.0045 11.3908 14.7394 11.343 14.4484 11.343C14.3397 11.343 14.2403 11.2953 14.1661 11.2568C14.0447 11.1964 13.9447 11.0452 14.0401 10.8594C14.0706 10.7991 14.2184 10.6524 14.2529 10.6266C14.6479 10.4017 15.1034 10.4753 15.5248 10.6438C15.9153 10.8037 16.2108 11.0969 16.6358 11.5115C17.0699 12.0124 17.1481 12.1504 17.3954 12.5264C17.5909 12.8203 17.7686 13.1221 17.8905 13.4677C17.9641 13.6834 17.8686 13.8599 17.6127 13.968Z'

    /** 56×32 pill in four states: idle/active × menu closed/open. The surface
     *  stays light; only the whale and the arrow turn red while armed. All
     *  motion is inline SVG (nested animateTransform swim + glow + arrow pulse). */
    function pillSvg(running, open) {
      const color = running ? '#EF4444' : '#9CA3AF';
      const stroke = running ? '#FECACA' : '#E5E7EB';
      const bg = running ? '#FFFFFF' : '#F9FAFB';
      const rightZone = open
        ? '<path d="M 38 1 H 41 C 49.8 1 56 8.2 56 16 C 56 23.8 49.8 31 41 31 H 38 Z" fill="' + (running ? '#FEE2E2' : '#F3F4F6') + '"/>'
        : '';
      const glow = running
        ? '<circle cx="16" cy="16" r="13" fill="none" stroke="#FCA5A5" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="25 75" pathLength="100"><animate attributeName="stroke-dashoffset" from="100" to="0" dur="2s" repeatCount="indefinite"/></circle>'
        : '';
      const whale = running
        ? '<g><animateTransform attributeName="transform" type="translate" values="0,0; 3,0; 0,0; -3,0; 0,0" dur="3s" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="translate" values="0,0; 0,-1.5; 0,0; 0,1.5; 0,0" dur="2s" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="rotate" values="0 16 16; 6 16 16; 0 16 16; -6 16 16; 0 16 16" dur="2.5s" repeatCount="indefinite"/><g transform="translate(6.5, 8) scale(0.7)"><path d="' + WHALE_D + '" fill="' + color + '"/></g></g></g></g>'
        : '<g transform="translate(6.5, 8) scale(0.7)"><path d="' + WHALE_D + '" fill="' + color + '"/></g>';
      const arrowD = open ? 'M 44 14 L 47 17 L 50 14' : 'M 44 17 L 47 14 L 50 17';
      const breathe = running
        ? '<animate attributeName="opacity" values="1; 0.3; 1" dur="1.5s" repeatCount="indefinite"/>'
        : '';
      return '<svg width="56" height="32" viewBox="0 0 56 32" fill="none" xmlns="http://www.w3.org/2000/svg">'
        + '<rect x="0.5" y="0.5" width="55" height="31" rx="15.5" fill="' + bg + '" stroke="' + stroke + '"/>'
        + rightZone
        + '<line x1="38" y1="8" x2="38" y2="24" stroke="' + stroke + '" stroke-width="1.5" stroke-linecap="round"/>'
        + glow
        + whale
        + '<path d="' + arrowD + '" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + breathe + '</path>'
        + '</svg>';
    }

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
      const cb = menuOnClose;
      menuOnClose = null;
      if (cb) { try { cb(); } catch (e) { /* ignore */ } }
    }

    function menuRow(label, control, hint) {
      const row = el('div', 'pmo-menu-row');
      row.appendChild(el('span', 'pmo-menu-label', label));
      row.appendChild(control);
      if (hint) row.appendChild(hint);
      return row;
    }

    function openMenu(anchor, sid, onClose) {
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
      const inhE = el('option', null, t.inheritEffort);
      inhE.value = '';
      selE.appendChild(inhE);
      const inR = el('input', 'pmo-menu-input');
      inR.type = 'number';
      inR.min = '0';
      inR.step = '1';
      inR.placeholder = t.roundsHint;
      const hintR = el('div', 'pmo-menu-hint', t.roundsHint);

      /** Rebuild the effort select from the model's DSH reasoning catalog. */
      function renderEfforts(reasoning, current) {
        const keep = current === undefined ? selE.value : String(current || '');
        while (selE.firstChild) selE.removeChild(selE.firstChild);
        for (const row of effortChoices(reasoning, keep)) {
          const op = el('option', null, row.label);
          op.value = row.value;
          selE.appendChild(op);
        }
        selE.value = keep;
      }

      m.appendChild(menuRow(t.model, selM));
      m.appendChild(menuRow(t.effort, selE));
      m.appendChild(menuRow(t.rounds, inR, hintR));
      const status = el('div', 'pmo-menu-status');
      m.appendChild(status);
      m.appendChild(el('div', 'pmo-menu-foot', VER + ' · 会话级覆盖优先于全局；模型/思考等级变更会重置审查官（记忆清零）'));
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
        status.textContent = '保存中…';
        status.style.color = '';
        fetch(BASE + '/session-config/set?' + q.toString())
          .then(function (res) { return res.json(); })
          .then(function (body) {
            if (body && body.ok) {
              renderEfforts(body.reasoning, body.effective && body.effective.effort);
              status.textContent = body.reset
                ? t.savedReset
                : body.effortAdjusted
                  ? '已保存 ✓（该思考等级不适用于此模型，已改为继承）'
                  : t.saved;
              status.style.color = '';
            } else {
              status.textContent = (body && body.error) || t.fail;
              status.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)';
            }
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
          if (!body || !body.ok) return;
          const ov = body.override || {};
          if (ov.provider && ov.model) {
            wantCombo = ov.provider + '|' + ov.model;
            selM.value = wantCombo;
          }
          if (ov.maxRounds !== undefined) inR.value = String(ov.maxRounds);
          renderEfforts(body.reasoning, ov.effort || '');
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
          if (wantCombo) {
            const foundCombo = Array.prototype.some.call(selM.options, function (o) { return o.value === wantCombo; });
            if (!foundCombo) {
              const op = el('option', null, wantCombo);
              op.value = wantCombo;
              selM.appendChild(op);
            }
            selM.value = wantCombo;
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
      menuOnClose = typeof onClose === 'function' ? onClose : null;
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
          const menuState = React.useState(false);
          const menuOpen = menuState[0];
          const setMenuOpen = menuState[1];
          const aliveRef = React.useRef(true);

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

          React.useEffect(function () {
            aliveRef.current = true;
            return function () {
              aliveRef.current = false;
              closeMenu();
            };
          }, []);

          React.useEffect(function () {
            closeMenu();
            setMenuOpen(false);
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

          function toggleMenu(ev) {
            ev.stopPropagation();
            if (menuOpen) { closeMenu(); return; }
            openMenu(wrapRef.current, sid, function () {
              if (aliveRef.current) setMenuOpen(false);
            });
            setMenuOpen(true);
          }

          const tip = VER + ' · ' + (view.online === false
            ? t.offline
            : view.pending ? t.busy
            : view.running ? t.stop + '（已记录 ' + view.turns + ' 轮）' : t.start)
            + ' · session:' + (sid === 'no-session' ? '—' : sid.slice(0, 8))
            + ' 路由:' + (view.online === null ? '?' : view.online ? 'ok' : '✗ ' + (view.err || ''));

          return h('div', { className: 'pmo-ctl', ref: wrapRef },
            h('style', null, CSS),
            h('div', {
              className: 'pmo-svg',
              'aria-hidden': true,
              dangerouslySetInnerHTML: { __html: pillSvg(view.running, menuOpen) },
            }),
            h('button', {
              type: 'button',
              className: 'pmo-zone left',
              title: tip,
              'aria-label': view.running ? t.stop : t.start,
              'aria-pressed': view.running,
              disabled: view.pending,
              onClick: onClick,
            }),
            h('button', {
              type: 'button',
              className: 'pmo-zone right',
              title: VER + ' · ' + t.menuTitle + '（模型 / 思考等级 / 轮数）',
              'aria-label': t.menuAria,
              'aria-haspopup': 'dialog',
              'aria-expanded': menuOpen,
              onClick: toggleMenu,
            }),
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
        const st = React.useState({ loaded: false, cfg: {}, catalog: [], providers: [], reasoning: null, msg: '' });
        const view = st[0];
        const set = st[1];

        React.useEffect(function () {
          let dead = false;
          const merge = function (patch) { set(function (s) { return Object.assign({}, s, patch); }); };
          fetch(BASE + '/config')
            .then(function (r) { return r.json(); })
            .then(function (body) {
              if (!dead && body && body.ok) merge({ loaded: true, cfg: body.config || {}, reasoning: body.reasoning || null, msg: '' });
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
              if (body && body.ok) set(function (s) {
                return Object.assign({}, s, {
                  cfg: body.config || s.cfg,
                  reasoning: body.reasoning || null,
                  msg: body.effortAdjusted ? '已保存 ✓（思考等级不适用于新模型，已改为继承）' : '已保存 ✓（热生效）',
                });
              });
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
          const opts = effortChoices(view.reasoning, value).map(function (row) {
            return h('option', { value: row.value, key: row.value || 'inherit' }, row.label);
          });
          return h('label', { className: 'pmo-cfg-row', key: 'childReasoningEffort' },
            h('span', { className: 'pmo-cfg-label' }, '思考等级'),
            h('select', {
              className: 'pmo-cfg-input', value: value,
              onChange: function (e) { saveFields({ childReasoningEffort: e.target.value }); },
            }, ...opts));
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

        if (!view.loaded) {
          return h('div', { className: 'pmo-cfg' },
            h('style', null, CSS),
            h('span', { className: 'pmo-cfg-note' }, 'PMO 配置加载中…'));
        }
        return h('div', { className: 'pmo-cfg' },
          h('style', null, CSS),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, '审查模型（异构审查：审查方 ≠ 执行方）'),
            modelField(),
            effortField(),
            h('div', { className: 'pmo-cfg-note' }, '留空 = 继承主会话；思考等级按所选模型能力列出，模型留空时只能继承；修改模型/思考等级后，下次启动会重置审查官（记忆清零）。'),
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
          // Merge, never replace: pickDict only carries the four runtime
          // strings, and replacing `t` blanked the menu title/labels.
          t = Object.assign({}, t, pickDict(c.get ? c.get('locale') : null));
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
