/**
 * PMO button — Client half v0.12.0.
 * Visual contributions, all session-aware:
 *  - conversation.input.right: ONE control (red start/stop button + a visible
 *    caret that opens the session-level quick menu). The control is a single
 *    slot occupant; the menu is session-scoped.
 *  - conversation.composer.dock: liveness strip.
 *  - plugins.bundle.config: global config panel on the bundle page with
 *    aligned rows and semantic widgets (model/effort/provider dropdowns,
 *    number inputs, textareas) and per-field auto-save through the hosting
 *    plugin form (form.mutate).
 * Session-level overrides live in the Host's pmo-state.json and only affect
 * the current session; global fields persist for every session.
 * Everything talks to the package-private /pmo-button/* same-origin routes.
 */
import contribution from '../lib/typert.remote-client.js'
import { effortPatch, modelPatch, roundsPatch } from './session-patch.js'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-session/types'

/** Chat payload of one delivered PMO verdict node. */
export interface PmoReviewNodeData {
  readonly title: string
  readonly status: string
  readonly summary: string
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'pmo-review': PmoReviewNodeData
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    'pmo-review': PmoReviewNodeData
  }
}

declare global {
  interface Window {
    __ModuleLoader__: any
    __PMO_LAST_MUTATE__?: any
    __PMO_FORM_STATE__?: any
    __PMO_REMOTE_MOUNTED__?: any
    __PMO_REMOTE_DISPOSE__?: any
    __PMO_REMOTE_MOUNT_ERROR__?: any
    __PMO_SET_LOCALE__?: any
  }
}

window.__ModuleLoader__.load({
  id: '@suifei/dsh-pmo-button',
  factory(require: any) {
    const React = require('react');
    const h = React.createElement;
    /** Source kind the Host stamps on delivered verdict messages. */
    const REVIEW_SOURCE = 'pmo-review';
    /** Whole-line STATUS in the verdict report. */
    const STATUS_IN_TEXT = /STATUS\s*[:：=]\s*(CONTINUE|DONE|NEED_HUMAN)/;

    /** Extract the verdict text from one user/message event (flat or message-wrapped). */
    function reviewReportOf(event: any): string {
      const d = event?.data ?? {};
      const msg = d.message ?? d;
      const content = Array.isArray(msg?.content) ? msg.content : [];
      return content
        .filter((c: any) => c && c.type === 'text')
        .map((c: any) => String(c.text ?? ''))
        .join('\n');
    }

    /** One line per delivered verdict; the message is claimed exclusively so the
     *  generic user bubble does not render the same review twice. */
    function pmoReviewDefinition(): ConversationNodeDefinition<any> {
      return {
        kind: 'pmo-review',
        target: 'chat',
        match(event: any) {
          if (event?.type !== 'user/message') return null;
          const d = event.data ?? {};
          const source = (d.message && d.message.source) || d.source;
          if (!source || source.kind !== REVIEW_SOURCE) return null;
          // Claim the message exclusively: this Definition owns the verdict's
          // rendering, and the generic user bubble must not duplicate it.
          return { id: 'pmo-review:' + event.seq, role: 'start', exclusive: true };
        },
        start(_context: ConversationNodeContext, match: any) {
          const text = reviewReportOf(match.event);
          const found = STATUS_IN_TEXT.exec(text);
          const status = found ? found[1] : 'UNKNOWN';
          const summary = text.split('\n').map((s: string) => s.trim()).find((s: string) => s.length > 0) || '';
          return { title: 'PMO 审查 · STATUS=' + status, status: status, summary: summary };
        },
        update(context: any) { return context.state; },
        buildViewNode(context: any) {
          // Once a target node is published it must keep returning one; a
          // temporary absence uses visibility, never null (contract).
          if (!context) return null;
          const state = context.state ?? { title: 'PMO 审查 · STATUS=UNKNOWN', status: 'UNKNOWN', summary: '' };
          const anchor = context.start && context.start.event && typeof context.start.event.seq === 'number'
            ? context.start.event.seq
            : 0;
          const resolved = context.start && context.start.location;
          const location = resolved && resolved.kind !== 'unresolved' ? resolved : { kind: 'session' };
          return {
            key: context.key,
            kind: 'pmo-review',
            id: context.id,
            target: 'chat',
            anchorSeq: anchor,
            location: location,
            visibility: 'visible',
            data: {
              title: state.title,
              status: state.status,
              summary: state.summary,
            },
          };
        },
      };
    }

    /** Compact node body: title + status line, no expand control. */
    function PmoReviewNodeView(props: ChatNodeViewProps<'pmo-review'>) {
      const data = props.node.data;
      return h('div', { className: 'pmo-review-node' },
        h('div', { className: 'pmo-review-title' }, data.title),
        h('div', { className: 'pmo-review-summary' }, data.summary));
    }

    const BASE = '/pmo-button';
    const VER = 'v0.13.2';
    /** Effort choices from the model's DSH reasoning catalog. No hardcoded
     *  minimal/low/... fallback: without a concrete model the only honest
     *  choice is inherit. Both the session menu and the config panel use this
     *  single builder (qwen: off/low/medium/high; deepseek-flash: off/low/high/max). */
    function effortChoices(reasoning: any, current: any, tr: any) {
      const translate = typeof tr === 'function' ? tr : function (source: any) { return source; };
      const out = [{ value: '', label: translate('继承主会话思考等级') }];
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
          label: current + (rows.length ? translate('（当前模型不支持）') : translate('（模型能力未知，先选模型）')),
        });
      }
      return out;
    }
    let loadError: any = null;
    /** English copy keyed by the Chinese source text; a missing key falls back to the source. */
    const EN_LOCALE = {
      'PMO：启动自动化': 'Start PMO automation',
      'PMO：运行中，点击停止': 'PMO running: click to stop',
      'PMO：处理中…': 'PMO: pending…',
      'PMO：宿主未响应': 'PMO: host unreachable',
      '会话级审查设置': 'Session review settings',
      '只影响当前会话；全局默认在 插件 → PMO 按钮 页面配置；思考等级按所选模型能力列出，模型留空时只能继承。':
        'Affects this session only. Global defaults live on the plugin page; effort options follow the selected model, and an empty model can only inherit.',
      '审查模型': 'Review model',
      '思考等级': 'Reasoning effort',
      '轮数上限': 'Round cap',
      '继承主会话模型': 'Inherit the session model',
      '继承主会话思考等级': 'Inherit the session effort',
      '留空 = 继承全局': 'Empty = inherit the global cap',
      '已保存 ✓': 'Saved ✓',
      '已保存 ✓（审查官已重置，下次审查使用新模型）': 'Saved ✓ (reviewer reset; the next review uses the new model)',
      '保存失败': 'Save failed',
      '关闭': 'Close',
      'PMO 客户端已加载': 'PMO client loaded',
      'PMO 客户端加载失败': 'PMO client failed to load',
      '（已记录 ': ' (recorded ',
      ' 轮）': ' rounds)',
      ' 路由:': ' route:',
      '（模型 / 思考等级 / 轮数）': ' (model / effort / rounds)',
      '会话级覆盖优先于全局；模型/思考等级变更会重置审查官（记忆清零）':
        'Session overrides win over global settings; changing model/effort resets the reviewer (memory cleared)',
      '已保存 ✓（该思考等级不适用于此模型，已改为继承）': 'Saved ✓ (effort unsupported by this model; fell back to inherit)',
      '留空 = 继承全局上限（': 'Empty = inherit the global cap (',
      '已保存 ✓（热生效）': 'Saved ✓ (hot-applied)',
      '保存失败：宿主拒绝': 'Save failed: host rejected',
      '保存失败（连接）': 'Save failed (connection)',
      '（连接）': ' (connection)',
      '继承全局（': 'Inherit global (',
      '（当前模型不支持）': ' (unsupported by this model)',
      '（模型能力未知，先选模型）': ' (model capability unknown; pick a model first)',
      '审查模型（异构审查：审查方 ≠ 执行方）': 'Review model (reviewer ≠ executor)',
      '运行': 'Runtime',
      '身份与问候': 'Identity and greeting',
      '日志': 'Logging',
      '审查轮数上限（0 = 不限）': 'Review round cap (0 = unlimited)',
      '日志单块截断阈值': 'Log block truncation limit',
      '保存中…': 'Saving…',
      'PMO 按钮渲染异常: ': 'PMO button render failed: ',
      '子代理标签': 'Subagent label',
      '子代理提供方': 'Subagent provider',
      '启动问候文本（签到，非审查请求）': 'Startup greeting (check-in, not a review request)',
      '身份提示词（缺席时使用内置审查规程）': 'Identity prompt (built-in rules when empty)',
      '日志文件路径': 'Log file path',
      '配置加载中…': 'Loading configuration…',
      '此部署未提供该插件的配置表单': 'This deployment provides no configuration form for the plugin',
      '各字段修改后自动保存并热生效（文本失焦保存）': 'Fields save automatically and apply live (text saves on blur)',
      '留空 = 继承主会话；思考等级按所选模型能力列出，模型留空时只能继承；修改模型/思考等级后，下次启动会重置审查官（记忆清零）。':
        'Empty inherits the session. Effort options follow the selected model; an empty model can only inherit. Changing model/effort resets the reviewer on the next start (memory cleared).',
      'PMO 审查循环 · 在插件详情页配置': 'PMO review loop · configure on the plugin page',
      '在下方“包含的组件”中点开 PMO 按钮行，即可编辑审查模型与身份提示词。':
        'Open the PMO button row under “Included components” to edit the review model and identity prompt.',
    };
    /** Chinese dictionary: the source text is already Chinese. */
    const ZH_LOCALE = Object.fromEntries(Object.keys(EN_LOCALE).map(function (key) { return [key, key]; }));
    /** Slot-injected translator with an identity fallback. */
    function translator(props: any) {
      return props && typeof props.t === 'function' ? props.t : function (source: any) { return source; };
    }
    /** Control/menu copy built from the active translator. */
    function controlText(tr: any) {
      return {
        start: tr('PMO：启动自动化'),
        stop: tr('PMO：运行中，点击停止'),
        busy: tr('PMO：处理中…'),
        offline: tr('PMO：宿主未响应'),
        menuTitle: tr('会话级审查设置'),
        menuSub: tr('只影响当前会话；全局默认在 插件 → PMO 按钮 页面配置；思考等级按所选模型能力列出，模型留空时只能继承。'),
        model: tr('审查模型'),
        effort: tr('思考等级'),
        rounds: tr('轮数上限'),
        inheritModel: tr('继承主会话模型'),
        inheritEffort: tr('继承主会话思考等级'),
        roundsHint: tr('留空 = 继承全局'),
        saved: tr('已保存 ✓'),
        savedReset: tr('已保存 ✓（审查官已重置，下次审查使用新模型）'),
        fail: tr('保存失败'),
        close: tr('关闭'),
        menuAria: tr('会话级审查设置'),
      };
    }

    let menuEl: any = null;
    let menuCleanup: any = null;
    let menuOnClose: any = null;
    /** Remote API facade set by apply(); components call this instead of fetch. */
    /** Package name: the bundle slot key and the row-config key prefix. */
    const BUNDLE_NAME = '@suifei/dsh-pmo-button';
    /** Patch row id declared in cordis.patch.yml. */
    const ROW_ID = 'pmo-button';
    let api: any = null;

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
      '.pmo-review-node{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-left:3px solid var(--dsw-alias-brand-primary,#4a7dd8);',
      'background:var(--dsw-alias-bg-layer-1,#fff);border-radius:6px;font:inherit;font-size:12.5px}',
      '.pmo-review-title{font-weight:600;color:var(--dsw-alias-label-primary,#222)}',
      '.pmo-review-summary{color:var(--dsw-alias-label-secondary,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.pmo-menu-foot{font-size:11px;color:var(--dsw-alias-label-secondary,#999);line-height:1.5;',      'border-top:1px solid var(--dsw-alias-border-l1,#eee);padding-top:8px}',
    ].join('');

    /** DeepSeek whale glyph from the supplied pill artwork (one source of truth). */
    const WHALE_D = 'M26.5542 4.34393C26.2719 4.20592 26.1506 4.46928 25.9856 4.60268C25.9292 4.64581 25.8815 4.70216 25.8338 4.75391C25.4215 5.19438 24.9396 5.48361 24.3105 5.44911C23.3905 5.39736 22.605 5.68659 21.9104 6.39041C21.7626 5.52271 21.2721 5.00462 20.5258 4.67226C20.1353 4.49976 19.7403 4.32668 19.4666 3.95119C19.2757 3.68381 19.2234 3.38595 19.1279 3.09211C19.0669 2.91501 19.0066 2.73388 18.8024 2.7034C18.5811 2.6689 18.4942 2.85463 18.4074 3.00989C18.0601 3.6447 17.9255 4.34393 17.9388 5.05235C17.9692 6.64572 18.642 7.91478 19.9789 8.81756C20.1307 8.92106 20.1698 9.02457 20.1221 9.1758C20.0307 9.48688 19.9226 9.78876 19.8271 10.0998C19.7662 10.2982 19.6753 10.3419 19.4626 10.2551C18.7288 9.94862 18.0952 9.49493 17.5351 8.94694C16.5846 8.02749 15.7249 7.01258 14.6531 6.21791C14.4013 6.03218 14.1494 5.85967 13.8889 5.69522C12.7952 4.63316 14.0321 3.76086 14.3185 3.65736C14.618 3.54925 14.4225 3.17779 13.4548 3.18239C12.487 3.18642 11.6015 3.51073 10.4727 3.94256C10.3077 4.00754 10.1341 4.05469 9.95637 4.09379C8.93227 3.89944 7.86849 3.85631 6.75755 3.98167C4.66564 4.21455 2.99464 5.20358 1.7664 6.89183C0.290908 8.92106 -0.0564026 11.2269 0.368535 13.6316C0.815324 16.1663 2.10911 18.2645 4.09695 19.905C6.15838 21.6059 8.53263 22.4397 11.2415 22.2799C12.8867 22.185 14.7181 21.9648 16.7841 20.2161C17.3051 20.4755 17.8519 20.579 18.7587 20.6566C19.4574 20.7216 20.1302 20.6221 20.6511 20.514C21.4671 20.3415 21.4107 19.5859 21.1157 19.4473C18.7242 18.3335 19.2492 18.7866 18.772 18.4198C19.987 16.9822 21.8431 14.4269 22.4158 10.9474C22.4722 10.5633 22.5441 10.0222 22.5355 9.71114C22.5309 9.52138 22.5746 9.44778 22.7913 9.42593C23.3905 9.35693 23.9718 9.19305 24.506 8.89921C26.0557 8.05279 26.6808 6.6624 26.828 4.996C26.8498 4.74126 26.8234 4.47791 26.5542 4.34393ZM13.0511 19.3438C10.7332 17.5216 9.60906 16.9219 9.14502 16.9477C8.71089 16.9736 8.78909 17.4704 8.88454 17.7942C8.98459 18.1139 9.11455 18.3341 9.29683 18.6147C9.42276 18.8004 9.50959 19.0764 9.1709 19.284C8.42453 19.7458 7.12671 19.1288 7.06576 19.0983C5.55519 18.2087 4.29245 17.0346 3.40233 15.4285C2.54268 13.8829 2.04356 12.2245 1.96133 10.4546C1.93948 10.0274 2.06541 9.87617 2.49092 9.79854C3.05099 9.69504 3.62831 9.67319 4.1878 9.75541C6.55342 10.101 8.56713 11.1585 10.2554 12.8341C11.2191 13.788 11.9482 14.9283 12.6992 16.0421C13.4979 17.2249 14.357 18.3519 15.4512 19.276C15.8377 19.5997 16.1459 19.8458 16.4408 20.0275C15.5513 20.127 14.0666 20.1483 13.0511 19.345V19.3438ZM14.162 12.1981C14.162 12.0083 14.3139 11.8571 14.5048 11.8571C14.5479 11.8571 14.587 11.8657 14.6221 11.8784C14.6698 11.8956 14.7135 11.9215 14.748 11.9606C14.8089 12.021 14.8434 12.1072 14.8434 12.1981C14.8434 12.3878 14.6916 12.5391 14.5007 12.5391C14.3098 12.5391 14.162 12.3878 14.162 12.1981ZM17.6127 13.968C17.3913 14.0588 17.17 14.1365 16.9572 14.1451C16.6271 14.1623 16.2672 14.0284 16.0717 13.8645C15.7681 13.6098 15.5507 13.4671 15.4599 13.0227C15.4208 12.8329 15.4426 12.5391 15.4771 12.3706C15.5553 12.0078 15.4685 11.7749 15.2126 11.5633C15.0045 11.3908 14.7394 11.343 14.4484 11.343C14.3397 11.343 14.2403 11.2953 14.1661 11.2568C14.0447 11.1964 13.9447 11.0452 14.0401 10.8594C14.0706 10.7991 14.2184 10.6524 14.2529 10.6266C14.6479 10.4017 15.1034 10.4753 15.5248 10.6438C15.9153 10.8037 16.2108 11.0969 16.6358 11.5115C17.0699 12.0124 17.1481 12.1504 17.3954 12.5264C17.5909 12.8203 17.7686 13.1221 17.8905 13.4677C17.9641 13.6834 17.8686 13.8599 17.6127 13.968Z'

    /** 56×32 pill in four states: idle/active × menu closed/open. The surface
     *  stays light; only the whale and the arrow turn red while armed. All
     *  motion is inline SVG (nested animateTransform swim + glow + arrow pulse). */
    function pillSvg(running: any, open: any) {
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

    function sessionIdOf(props: any) {
      const cands = [
        props ? props.sessionId : void 0,
        props && props.session ? props.session.id : void 0,
        props && props.sessionSnapshot ? props.sessionSnapshot.id : void 0,
        props && props.binding ? props.binding.id : void 0,
      ];
      for (let i = 0; i < cands.length; i++) if (typeof cands[i] === 'string' && cands[i]) return cands[i];
      return 'no-session';
    }

    function el(tag: any, cls?: any, text?: any) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text !== void 0 && text !== null) n.textContent = text;
      return n;
    }

    function closeMenu() {
      if (menuCleanup) { try { menuCleanup(); } catch (e) { /* ignore */ } menuCleanup = null; }
      if (menuEl) { if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl); menuEl = null; }
      const cb: any = menuOnClose;
      menuOnClose = null;
      if (cb) { try { cb(); } catch (e) { /* ignore */ } }
    }

    function menuRow(label: any, control: any, hint?: any) {
      const row = el('div', 'pmo-menu-row');
      row.appendChild(el('span', 'pmo-menu-label', label));
      row.appendChild(control);
      if (hint) row.appendChild(hint);
      return row;
    }

    function openMenu(anchor: any, sid: any, onClose: any, t: any, tr: any) {
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
      function renderEfforts(reasoning: any, current: any) {
        const keep = current === undefined ? selE.value : String(current || '');
        while (selE.firstChild) selE.removeChild(selE.firstChild);
        for (const row of effortChoices(reasoning, keep, tr)) {
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
      m.appendChild(el('div', 'pmo-menu-foot', VER + ' · ' + tr('会话级覆盖优先于全局；模型/思考等级变更会重置审查官（记忆清零）')));
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
      /** Send only the fields this control owns: a rounds edit must never carry an
       *  empty provider/model pair (the catalog may still be loading) and so wipe a
       *  model override (issue #5); an empty rounds box means "inherit", not "keep
       *  the old value" (issue #4). */
      function persist(patch: any) {
        status.textContent = tr('保存中…');
        status.style.color = '';
        api.setSessionConfig(sid, patch)
          .then(function (body: any) {
            if (body && body.ok) {
              renderEfforts(body.reasoning, body.effective && body.effective.effort);
              status.textContent = body.reset
                ? t.savedReset
                : body.effortAdjusted
                  ? tr('已保存 ✓（该思考等级不适用于此模型，已改为继承）')
                  : t.saved;
              status.style.color = '';
            } else {
              status.textContent = (body && body.error) || t.fail;
              status.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)';
            }
          })
          .catch(function () {
            status.textContent = t.fail + tr('（连接）');
            status.style.color = 'var(--dsw-alias-state-error-primary,#e5484d)';
          });
      }
      selM.addEventListener('change', function () { persist(modelPatch(selM.value)); });
      selE.addEventListener('change', function () { persist(effortPatch(selE.value)); });
      inR.addEventListener('change', function () { persist(roundsPatch(inR.value)); });

      api.config()
        .then(function (body: any) {
          if (!body || !body.ok || !body.config) return;
          const n = body.config.maxRounds;
          if (typeof n === 'number') {
            inR.placeholder = tr('继承全局（') + n + tr(' 轮）');
            hintR.textContent = tr('留空 = 继承全局上限（') + n + tr(' 轮）');
          }
        })
        .catch(function () { });

      api.sessionConfig(sid)
        .then(function (body: any) {
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

      api.models()
        .then(function (body: any) {
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

      const onDoc = function (e: any) {
        if (!m.contains(e.target) && e.target !== anchor && !(anchor && anchor.contains(e.target))) closeMenu();
      };
      const onKey = function (e: any) { if (e.key === 'Escape') closeMenu(); };
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
      function PmoControl(props: any) {
        const t = controlText(translator(props));
        const tr = translator(props);
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
              api.state(sid)
                .then(function (body: any) {
                  if (!dead && body && body.ok) {
                    setView(function (v: any) {
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
            setView(function (v: any) { return Object.assign({}, v, { pending: true }); });
            api.toggle(sid, next)
              .then(function (body: any) {
                if (body && body.ok) setView({ running: !!body.enabled, turns: next ? 0 : view.turns, online: true, pending: false, err: null });
                else setView(function (v: any) { return Object.assign({}, v, { pending: false, online: false, err: 'bad response' }); });
              })
              .catch(function (e: any) { setView(function (v: any) { return Object.assign({}, v, { pending: false, online: false, err: String(e && e.message || e) }); }); });
          }

          function toggleMenu(ev: any) {
            ev.stopPropagation();
            if (menuOpen) { closeMenu(); return; }
            openMenu(wrapRef.current, sid, function () {
              if (aliveRef.current) setMenuOpen(false);
            }, t, tr);
            setMenuOpen(true);
          }

          const tip = VER + ' · ' + (view.online === false
            ? t.offline
            : view.pending ? t.busy
            : view.running ? t.stop + tr('（已记录 ') + view.turns + tr(' 轮）') : t.start)
            + ' · session:' + (sid === 'no-session' ? '—' : sid.slice(0, 8))
            + tr(' 路由:') + (view.online === null ? '?' : view.online ? 'ok' : '✗ ' + (view.err || ''));

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
              title: VER + ' · ' + t.menuTitle + tr('（模型 / 思考等级 / 轮数）'),
              'aria-label': t.menuAria,
              'aria-haspopup': 'dialog',
              'aria-expanded': menuOpen,
              onClick: toggleMenu,
            }),
          );
        } catch (err) {
          return h('span', { className: 'pmo-strip', title: String(err) }, h('span', { className: 'pmo-bad' }), tr('PMO 按钮渲染异常: ') + err);
        }
      }

      function PmoStrip(props: any) {
        const tr = translator(props);
        if (loadError) {
          return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-bad' }), 'PMO ' + VER + ' ' + tr('PMO 客户端加载失败') + ': ' + loadError);
        }
        const now = new Date().toTimeString().slice(0, 8);
        return h('div', { className: 'pmo-strip' }, h('span', { className: 'pmo-ok' }), 'PMO ' + VER + ' ' + tr('PMO 客户端已加载') + ' ' + now);
      }

      function BundleNote(props: any) {
        const tr = translator(props);
        if (props && props.view === 'summary') {
          return h('span', { className: 'pmo-cfg-note' }, tr('PMO 审查循环 · 在插件详情页配置'));
        }
        return h('div', { className: 'pmo-cfg' },
          h('span', { className: 'pmo-cfg-note' }, tr('在下方“包含的组件”中点开 PMO 按钮行，即可编辑审查模型与身份提示词。')));
      }

      function ConfigPanel(props: any) {
        const tr = translator(props);
        const form = props && props.form;
        const snapshot = form && form.state;
        const values = (snapshot && snapshot.value) || {};
        const rev = snapshot && snapshot.revision;
        const st = React.useState({ catalog: [], providers: [], reasoning: null, msg: '' });
        const view = st[0];
        const set = st[1];

        React.useEffect(function () {
          let dead = false;
          const merge = function (patch: any) { set(function (s: any) { return Object.assign({}, s, patch); }); };
          api.config()
            .then(function (body: any) {
              if (!dead && body && body.ok) merge({ reasoning: body.reasoning || null });
            })
            .catch(function () { });
          api.models()
            .then(function (body: any) { if (!dead && body && body.ok) merge({ catalog: body.providers || [] }); })
            .catch(function () { });
          api.providers()
            .then(function (body: any) { if (!dead && body && body.ok) merge({ providers: body.providers || [] }); })
            .catch(function () { });
          return function () { dead = true; };
        }, []);

        function saveFields(patch: any) {
          if (!form) return;
          set(function (s: any) { return Object.assign({}, s, { msg: tr('保存中…') }); });
          const ops = Object.keys(patch).map(function (key) {
            const value = patch[key];
            if (value === '' || value === undefined || value === null) return { op: 'unset', path: [key] };
            return { op: 'set', path: [key], value: value };
          });
          // No explicit revision fence: the form queues writes with the latest
          // known revision, so rapid edits (12 then 6) cannot conflict.
          form.mutate(ops)
            .then(function (accepted: any) {
              window.__PMO_LAST_MUTATE__ = { ops: ops, accepted: accepted, revision: snapshot && snapshot.revision };
              set(function (s: any) { return Object.assign({}, s, { msg: accepted ? tr('已保存 ✓（热生效）') : tr('保存失败：宿主拒绝') }); });
            })
            .catch(function () { set(function (s: any) { return Object.assign({}, s, { msg: tr('保存失败（连接）') }); }); });
        }

        React.useEffect(function () {
          window.__PMO_FORM_STATE__ = {
            view: props && props.view,
            propKeys: props ? Object.keys(props) : [],
            hasForm: Boolean(props && props.form),
            status: snapshot && snapshot.status,
            revision: snapshot && snapshot.revision,
            values: values,
          };
        });

        if (props && props.view === 'summary') {
          return h('span', { className: 'pmo-cfg-note' }, tr('PMO 审查循环 · 在插件详情页配置'));
        }
        if (!form || !snapshot || snapshot.status !== 'ready') {
          return h('div', { className: 'pmo-cfg' },
            h('span', { className: 'pmo-cfg-note' },
              snapshot && snapshot.status === 'unavailable' ? tr('此部署未提供该插件的配置表单') : tr('配置加载中…')));
        }

        function textField(key: any, label: any, placeholder?: any, wide?: any) {
          const value = values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
          const input = h('input', {
            className: 'pmo-cfg-input', type: 'text', key: 'tf:' + key + ':' + rev, defaultValue: value, placeholder: placeholder || '',
            onBlur: function (e: any) { saveFields({ [key]: e.target.value }); },
          });
          return h('label', { className: 'pmo-cfg-row' + (wide ? ' pmo-wide' : ''), key: key },
            h('span', { className: 'pmo-cfg-label' }, label), input);
        }
        function numberField(key: any, label: any) {
          const value = values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
          return h('label', { className: 'pmo-cfg-row', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('input', {
              className: 'pmo-cfg-input', type: 'number', key: 'nf:' + key + ':' + rev, min: '0', step: '1', defaultValue: value,
              onBlur: function (e: any) {
                const raw = e.target.value;
                saveFields({ [key]: raw === '' ? '' : Number(raw) });
              },
            }));
        }
        function textareaField(key: any, label: any, placeholder?: any) {
          const value = values[key] !== undefined && values[key] !== null ? String(values[key]) : '';
          return h('label', { className: 'pmo-cfg-row pmo-wide', key: key },
            h('span', { className: 'pmo-cfg-label' }, label),
            h('textarea', {
              className: 'pmo-cfg-input', key: 'ta:' + key + ':' + rev, defaultValue: value, placeholder: placeholder || '',
              onBlur: function (e: any) { saveFields({ [key]: e.target.value }); },
            }));
        }
        function modelField() {
          const curProvider = values.childModelProvider ? String(values.childModelProvider) : '';
          const curModel = values.childModel ? String(values.childModel) : '';
          const combo = curProvider && curModel ? curProvider + '|' + curModel : '';
          const groups = [];
          for (const g of view.catalog || []) {
            const kids = (g.models || []).map(function (m: any) {
              return h('option', { value: g.provider + '|' + m.id, key: g.provider + '|' + m.id },
                (m.name && m.name !== m.id) ? m.name + '（' + g.provider + '/' + m.id + '）' : g.provider + '/' + m.id);
            });
            groups.push(h('optgroup', { label: g.name || g.provider, key: g.provider }, ...kids));
          }
          const hasCombo = combo && !(view.catalog || []).some(function (g: any) {
            return (g.models || []).some(function (m: any) { return g.provider + '|' + m.id === combo; });
          });
          const opts = [h('option', { value: '', key: 'inherit' }, tr('继承主会话模型'))];
          if (hasCombo) opts.push(h('option', { value: combo, key: 'current' }, combo));
          opts.push(...groups);
          return h('label', { className: 'pmo-cfg-row', key: 'childModel' },
            h('span', { className: 'pmo-cfg-label' }, tr('审查模型')),
            h('select', {
              className: 'pmo-cfg-input', value: combo,
              onChange: function (e: any) {
                const v = e.target.value;
                const i = v.indexOf('|');
                if (i === -1) saveFields({ childModelProvider: '', childModel: '' });
                else saveFields({ childModelProvider: v.slice(0, i), childModel: v.slice(i + 1) });
              },
            }, ...opts));
        }
        function effortField() {
          const value = values.childReasoningEffort ? String(values.childReasoningEffort) : '';
          const opts = effortChoices(view.reasoning, value, tr).map(function (row) {
            return h('option', { value: row.value, key: row.value || 'inherit' }, row.label);
          });
          return h('label', { className: 'pmo-cfg-row', key: 'childReasoningEffort' },
            h('span', { className: 'pmo-cfg-label' }, tr('思考等级')),
            h('select', {
              className: 'pmo-cfg-input', value: value,
              onChange: function (e: any) { saveFields({ childReasoningEffort: e.target.value }); },
            }, ...opts));
        }
        function providerField() {
          const value = values.provider ? String(values.provider) : 'spawn';
          // No phantom options: when the host could not enumerate providers, offer only
          // the documented default plus whatever value is already configured (issue #8).
          const list = (view.providers && view.providers.length) ? view.providers.slice() : ['spawn'];
          if (list.indexOf(value) === -1) list.push(value);
          return h('label', { className: 'pmo-cfg-row', key: 'provider' },
            h('span', { className: 'pmo-cfg-label' }, tr('子代理提供方')),
            h('select', {
              className: 'pmo-cfg-input', value: value,
              onChange: function (e: any) { saveFields({ provider: e.target.value }); },
            }, ...list.map(function (p: any) { return h('option', { value: p, key: p }, p); })));
        }

        return h('div', { className: 'pmo-cfg' },
          h('style', null, CSS),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, tr('审查模型（异构审查：审查方 ≠ 执行方）')),
            modelField(),
            effortField(),
            h('div', { className: 'pmo-cfg-note' }, tr('留空 = 继承主会话；思考等级按所选模型能力列出，模型留空时只能继承；修改模型/思考等级后，下次启动会重置审查官（记忆清零）。')),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, tr('运行')),
            numberField('maxRounds', tr('审查轮数上限（0 = 不限）')),
            numberField('maxChars', tr('日志单块截断阈值')),
            providerField(),
            textField('childLabel', tr('子代理标签')),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, tr('身份与问候')),
            textareaField('greet', tr('启动问候文本（签到，非审查请求）')),
            textareaField('rolePrompt', tr('身份提示词（缺席时使用内置审查规程）')),
          ),
          h('div', { className: 'pmo-cfg-section' },
            h('div', { className: 'pmo-cfg-sectitle' }, tr('日志')),
            textField('logFile', tr('日志文件路径'), '~/.dsh/logs/pmo-button.log'),
          ),
          h('div', { className: 'pmo-cfg-status', key: 'status' }, view.msg || tr('各字段修改后自动保存并热生效（文本失焦保存）')),
        );
      }

      return {
        inject: ['remote'],
        apply(c: any) {
          // Mount the generated Typert contribution first. The namespace
          // (`remote.pmo`) only exists after the mount, so the UI half runs in a
          // child plugin that injects it; Cordis starts the child once ready.
          c.remote.$mount(contribution).then(function (dispose: any) {
            window.__PMO_REMOTE_MOUNTED__ = true;
            window.__PMO_REMOTE_DISPOSE__ = dispose;
            c.plugin({
              inject: ['slots', 'remote.pmo', 'locale', 'uiConversation'],
              apply: applyChild,
            });
          }).catch(function (err: any) {
            window.__PMO_REMOTE_MOUNT_ERROR__ = String(err && err.message || err);
          });
        },
      };

      function applyChild(c: any) {
          function call(fn: any) {
            return Promise.resolve()
              .then(function () { return fn(c.remote.pmo); })
              .then(function (result) {
                if (result && result.ok) return Object.assign({ ok: true }, result.value);
                const error = result && result.error;
                return { ok: false, error: String((error && (error.message || error.code)) || 'remote call failed') };
              })
              .catch(function (err) { return { ok: false, error: String(err && err.message || err) }; });
          }
          api = {
            state: function (sid: any) { return call(function (pmo: any) { return pmo.state(sid); }); },
            toggle: function (sid: any, on: any) { return call(function (pmo: any) { return pmo.toggle(sid, on); }); },
            config: function () { return call(function (pmo: any) { return pmo.config(); }); },
            sessionConfig: function (sid: any) { return call(function (pmo: any) { return pmo.sessionConfig(sid); }); },
            setSessionConfig: function (sid: any, patch: any) { return call(function (pmo: any) { return pmo.setSessionConfig(sid, patch); }); },
            models: function () { return call(function (pmo: any) { return pmo.models(); }); },
            providers: function () { return call(function (pmo: any) { return pmo.providers(); }); },
          };
          // Locale namespace: English copy keyed by the Chinese source; zh falls
          // back to the source text, so the dictionary stays single-sourced.
          const localeSvc = c.locale;
          if (localeSvc && typeof localeSvc.register === 'function') {
            c.effect(function () {
              return localeSvc.register('pmoButton', { zh: ZH_LOCALE, en: EN_LOCALE });
            });
            // Test hook: lets the E2E switch the UI locale and assert re-render.
            window.__PMO_SET_LOCALE__ = function (id: any) { localeSvc.setLocale(id); };
          }
          if (c.uiConversation && c.uiConversation.events && typeof c.uiConversation.events.register === 'function') {
            c.uiConversation.events.register(pmoReviewDefinition());
          }
          c.slots.inject('plugins.bundle.config', function () {            return c.slots.register(
              { name: 'plugins.bundle.config', key: BUNDLE_NAME, locale: 'pmoButton' },
              BundleNote,
            );
          });
          c.slots.inject('plugins.row.config', function () {
            return c.slots.register(
              { name: 'plugins.row.config', key: BUNDLE_NAME + '#' + ROW_ID, locale: 'pmoButton' },
              ConfigPanel,
            );
          });
          c.slots.inject('conversation.composer.dock', function () {
            return c.slots.register(
              { name: 'conversation.composer.dock', id: 'pmo-button-strip', order: 90, locale: 'pmoButton' },
              PmoStrip,
            );
          });
          c.slots.inject('conversation.input.right', function () {
            return c.slots.register(
              { name: 'conversation.input.right', id: 'pmo-button', order: 10, locale: 'pmoButton' },
              PmoControl,
            );
          });
          c.slots.inject('conversation.chat.node', function () {
            return c.slots.register(
              { name: 'conversation.chat.node', key: 'pmo-review', locale: 'pmoButton' },
              PmoReviewNodeView,
            );
          });
      }
    }

    try {
      return buildPlugin();
    } catch (err) {
      loadError = String(err);
      return {
        inject: ['slots'],
        apply(c: any) {
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

