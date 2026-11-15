/**
 * Session-config patch composition for the PMO quick menu.
 *
 * Each control owns exactly one dimension. Composing one shared patch for all of
 * them (the pre-0.13.1 shape) had two defects:
 *  - a rounds edit also submitted `provider:''/model:''`, and because the model
 *    dropdown is filled asynchronously, editing rounds before the catalog arrived
 *    wiped the session's model override (issue #5);
 *  - an empty rounds box was dropped to `undefined` on the wire, which the server
 *    reads as "no change", so a session-level cap could never be cleared (issue #4).
 *
 * Kept pure and separate so the contract is unit-tested instead of living inside
 * the browser bundle.
 */

/** Fields the session menu can override. */
export interface SessionConfigPatch {
  provider?: string
  model?: string
  effort?: string
  maxRounds?: number
}

/** `provider|model` combo → provider/model patch. Empty combo clears both. */
export function modelPatch(combo: string): SessionConfigPatch {
  const value = String(combo ?? '')
  const at = value.indexOf('|')
  if (at < 0) return { provider: '', model: '' }
  return { provider: value.slice(0, at), model: value.slice(at + 1) }
}

/** Reasoning-effort patch; an empty value means "inherit". */
export function effortPatch(value: string): SessionConfigPatch {
  return { effort: String(value ?? '') }
}

/**
 * Round-cap patch. Empty input clears the override (0 = inherit the global cap,
 * the server deletes the field); anything else is a non-negative integer.
 */
export function roundsPatch(raw: string): SessionConfigPatch {
  const text = String(raw ?? '').trim()
  if (text === '') return { maxRounds: 0 }
  return { maxRounds: Math.max(0, Math.floor(Number(text)) || 0) }
}
