// Generate Typert artifacts for the plugin package (host face).
// Run after `prepare:typert`; tsc build is independent and can run before/after.
import { WorkspaceTypertGenerator, writeWorkspaceArtifacts } from '@deepseek-ai/dsh-typert-generator'

const root = process.cwd()
const generator = new WorkspaceTypertGenerator(root, { checkDiagnostics: false })
const discovered = generator.discover(['host'], () => true).map((entry) => entry.package)
if (discovered.length === 0) {
  console.error('[build-typert] no contributing package discovered')
  process.exit(1)
}
const artifacts = generator.generate(discovered, ['host'])
writeWorkspaceArtifacts(root, artifacts)
console.log('[build-typert] wrote:', artifacts.map((a) => `${a.package}#${a.face}`).join(', '))
