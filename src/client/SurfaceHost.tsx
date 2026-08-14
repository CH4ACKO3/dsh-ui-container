import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from 'react'
import type { UiSurfaceConnection } from './documents.js'

export type UiSurfaceContextValue = {
  surface: UiSurfaceConnection
  sessionId: string
  path: readonly string[]
}

export type SurfaceHostProps = {
  id?: string
  surface?: UiSurfaceConnection
  sessionId?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}

const UiSurfaceContext = createContext<UiSurfaceContextValue | null>(null)

/** A visible surface boundary. Nested hosts inherit the current connection and session. */
export function SurfaceHost({
  id,
  surface,
  sessionId,
  className,
  style,
  children,
}: SurfaceHostProps) {
  const parent = useContext(UiSurfaceContext)
  const resolvedSurface = surface ?? parent?.surface
  const resolvedSessionId = sessionId ?? parent?.sessionId
  const segment = id ?? surface?.id

  if (!resolvedSurface) throw new Error('Root SurfaceHost requires a surface connection')
  if (!resolvedSessionId) throw new Error('Root SurfaceHost requires a session id')
  if (!segment) throw new Error('Nested SurfaceHost requires an id or a surface connection')

  const value = useMemo<UiSurfaceContextValue>(() => ({
    surface: resolvedSurface,
    sessionId: resolvedSessionId,
    path: [...(parent?.path ?? []), segment],
  }), [parent?.path, resolvedSessionId, resolvedSurface, segment])

  return (
    <UiSurfaceContext.Provider value={value}>
      <div
        className={className}
        data-ui-surface-id={segment}
        data-ui-surface-path={value.path.join('/')}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minWidth: 0,
          minHeight: 0,
          boxSizing: 'border-box',
          ...style,
        }}
      >
        {children}
      </div>
    </UiSurfaceContext.Provider>
  )
}

export function useUiSurface(): UiSurfaceContextValue {
  const value = useContext(UiSurfaceContext)
  if (!value) throw new Error('useUiSurface must be called inside SurfaceHost')
  return value
}
