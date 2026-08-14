import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { UiContainer } from './documents.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    uiContainer: UiContainer
  }
}

export const name = '@ch4acko3/dsh-ui-container'
export const inject = [] as const

export function apply(ctx: ClientContext): void {
  ctx.provide('uiContainer', new UiContainer())
}

export * from './documents.js'
export * from './remote-channel.js'
export * from './remote-protocol.js'
export * from './remote.js'
export * from './SurfaceHost.js'
