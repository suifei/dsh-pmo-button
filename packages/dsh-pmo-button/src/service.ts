import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  PmoConfigView,
  PmoModelsView,
  PmoProvidersView,
  PmoSessionConfigView,
  PmoSessionPatch,
  PmoStateView,
  PmoToggleResult,
} from './types.js'

/** Operations the host wires behind the Remote surface. Kept as an interface so
 *  the service owns no review logic and the legacy HTTP routes stay the single
 *  implementation until they are retired. */
export interface PmoBackend {
  state(sessionId: string): PmoStateView
  toggle(sessionId: string, enabled: boolean): Promise<PmoToggleResult>
  config(): Promise<PmoConfigView>
  sessionConfig(sessionId: string): Promise<PmoSessionConfigView>
  setSessionConfig(sessionId: string, patch: PmoSessionPatch): Promise<PmoSessionConfigView>
  models(): Promise<PmoModelsView>
  providers(): PmoProvidersView
}

/**
 * Remote control surface for the PMO button.
 * @typert service pmo
 */
export class PmoService extends TypertRemoteService {
  private readonly backend: PmoBackend

  constructor(ctx: Context, backend: PmoBackend) {
    super(ctx, 'pmo')
    this.backend = backend
  }

  /**
   * Read one session's review state.
   * @param sessionId - exact session id.
   * @returns the session's armed state and captured turn count.
   */
  @Remote('state')
  state(sessionId: string): PmoStateView {
    return this.backend.state(sessionId)
  }

  /**
   * Arm or disarm the review loop for one session.
   * @param sessionId - exact session id.
   * @param enabled - true to arm, false to pause.
   * @returns the resulting state.
   */
  @Remote('toggle')
  toggle(sessionId: string, enabled: boolean): Promise<PmoToggleResult> {
    return this.backend.toggle(sessionId, enabled)
  }

  /**
   * Read the global plugin configuration.
   * @returns current config, editor availability, and reasoning catalog.
   */
  @Remote('config')
  config(): Promise<PmoConfigView> {
    return this.backend.config()
  }

  /**
   * Read one session's effective review settings.
   * @param sessionId - exact session id.
   * @returns overrides, effective settings, and reasoning catalog.
   */
  @Remote('sessionConfig')
  sessionConfig(sessionId: string): Promise<PmoSessionConfigView> {
    return this.backend.sessionConfig(sessionId)
  }

  /**
   * Apply a session-level override patch.
   * @param sessionId - exact session id.
   * @param patch - fields to override; empty string clears a field.
   * @returns the resulting session config.
   */
  @Remote('setSessionConfig')
  setSessionConfig(sessionId: string, patch: PmoSessionPatch): Promise<PmoSessionConfigView> {
    return this.backend.setSessionConfig(sessionId, patch)
  }

  /**
   * Read the model catalog used by both selectors.
   * @returns providers with their advertised models.
   */
  @Remote('models')
  models(): Promise<PmoModelsView> {
    return this.backend.models()
  }

  /**
   * List registered subagent providers.
   * @returns provider names.
   */
  @Remote('providers')
  providers(): PmoProvidersView {
    return this.backend.providers()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** PMO Remote control surface. */
    pmo: PmoService
  }
}
