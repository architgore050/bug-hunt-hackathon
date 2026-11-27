import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

type RevealState = 'in' | 'out-up' | 'out-down'

function useScrollReveal(immediate: boolean): [React.RefObject<HTMLDivElement | null>, RevealState] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<RevealState>(() => (immediate ? 'in' : 'out-down'))

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (
      typeof window === 'undefined' ||
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState('in')
          } else {
            const top = entry.boundingClientRect.top
            setState(top < 0 ? 'out-up' : 'out-down')
          }
        }
      },
      {
        threshold: 0.08,
        rootMargin: '-24px 0px -36px 0px',
      },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return [ref, state]
}

export function RevealBlock({
  children,
  className = '',
  delayMs = 0,
  immediate = false,
  style,
}: {
  children: ReactNode
  className?: string
  delayMs?: number
  immediate?: boolean
  style?: CSSProperties
}) {
  const [ref, state] = useScrollReveal(immediate)
  const stateClass = state === 'in' ? 'is-in' : state === 'out-up' ? 'is-out-up' : 'is-out-down'

  return (
    <div
      ref={ref}
      className={`reveal ${stateClass} ${className}`.trim()}
      style={{
        transitionDelay: state === 'in' ? `${delayMs}ms` : '0ms',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function KineticWords({
  text,
  as = 'span',
  className = '',
  id,
  staggerMs = 42,
  immediate = false,
  style,
}: {
  text: string
  as?: 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'div'
  className?: string
  id?: string
  staggerMs?: number
  immediate?: boolean
  style?: CSSProperties
}) {
  const [ref, state] = useScrollReveal(immediate)
  const Tag = as
  const words = text.trim().split(/\s+/)
  const stateClass = state === 'in' ? 'is-in' : state === 'out-up' ? 'is-out-up' : 'is-out-down'

  return (
    <div ref={ref} className={`kw-wrap ${stateClass}`}>
      <Tag id={id} className={className} style={style}>
        {words.map((word, idx) => (
          <span key={`${word}-${idx}`} className="kw-mask">
            <span
              className="kw-word"
              style={{
                transitionDelay: state === 'in' ? `${idx * staggerMs}ms` : '0ms',
              }}
            >
              {word}
            </span>
            {idx < words.length - 1 ? '\u00A0' : ''}
          </span>
        ))}
      </Tag>
    </div>
  )
}
