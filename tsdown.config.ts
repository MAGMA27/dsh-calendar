/**
 * dsh-calendar build config — uses the official client-bundle preset
 * (build/tsdown.client.ts) to emit the node-half `lib/index.js` plus the
 * browser bundle `lib/client.js` (closure-factory artifact for the GUI's
 * __ModuleLoader__, CSS Modules inlined with auto-injected <style data-plugin>).
 *
 * Node-half entries point at src (tsdown compiles TS directly), so the build
 * needs no separate tsc emit for runtime artifacts; the `tsc -p
 * tsconfig.build.json` step only emits `lib/types` declarations.
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@magma27/dsh-calendar', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    // Host-half services resolve at runtime from the dsh profile tree (never
    // from this repo's install), so they must stay external like @deepseek-ai/cordis.
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-agent',
    '@deepseek-ai/dsh-agent-presets',
    '@deepseek-ai/dsh-commands',
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-workspace',
  ],
})
