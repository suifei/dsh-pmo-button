/** Views returned by the PMO Remote surface. Exported from a non-root subpath
 *  because Typert requires Remote boundary types to live on a public type
 *  subpath rather than the package root. */

/** Per-session review state. */
export interface PmoStateView {
  /** Session the state belongs to. */
  readonly sessionId: string
  /** Whether the review loop is currently armed for this session. */
  readonly enabled: boolean
  /** Turns captured since the plugin started tracking this session. */
  readonly turns: number
}

/** One reasoning-effort option advertised by the model catalog. */
export interface PmoReasoningEffort {
  readonly id: string
  readonly name: string
  readonly description: string
}

/** Reasoning capabilities for one exact model. */
export interface PmoReasoningView {
  readonly defaultEffort: string | null
  readonly efforts: readonly PmoReasoningEffort[]
}

/** Global plugin configuration as seen by the settings panel. */
export interface PmoConfigView {
  readonly config: Record<string, string | number>
  readonly editorAvailable: boolean
  readonly reasoning: PmoReasoningView | null
}

/** Effective review settings for one session. */
export interface PmoSessionConfigView {
  readonly sessionId: string
  readonly override: Record<string, string | number> | null
  readonly effective: PmoEffectiveConfig
  readonly reasoning: PmoReasoningView | null
  readonly enabled: boolean
}

/** Effective provider/model/effort/round cap for one session. */
export interface PmoEffectiveConfig {
  readonly provider: string
  readonly model: string
  readonly effort: string
  readonly maxRounds: number
}

/** One model advertised by a provider. */
export interface PmoModelEntry {
  readonly id: string
  readonly name: string
}

/** One provider with its advertised models. */
export interface PmoProviderModels {
  readonly provider: string
  readonly name: string
  readonly models: readonly PmoModelEntry[]
}

/** Model catalog used by both selectors. */
export interface PmoModelsView {
  readonly providers: readonly PmoProviderModels[]
}

/** Subagent providers registered on the host. */
export interface PmoProvidersView {
  readonly providers: readonly string[]
}

/** Result of arming or disarming the loop. */
export interface PmoToggleResult {
  readonly sessionId: string
  readonly enabled: boolean
  readonly turns: number
  readonly child: string | null
}

/** Session-level override patch. */
export interface PmoSessionPatch {
  readonly provider?: string
  readonly model?: string
  readonly effort?: string
  readonly maxRounds?: number
}
