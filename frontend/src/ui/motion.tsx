import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

type RevealState = 'in' | 'out-up' | 'out-down'

function useScrollVisibility(ref: React.RefObject<HTMLElement | null>, immediate: boolean, threshold: number): RevealState {
  const [state, setState] = useState<RevealState>(immediate ? 'out-down' : 'out-down')

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId = 0
    if (immediate) {
      rafId = window.requestAnimationFrame(() => setState('in'))
    }

    if (typeof IntersectionObserver === 'undefined') {
      const id = window.requestAnimationFrame(() => setState('in'))
      return () => {
        window.cancelAnimationFrame(rafId)
        window.cancelAnimationFrame(id)
      }
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setState('in')
          } else {
            setState(entry.boundingClientRect.top < 0 ? 'out-up' : 'out-down')
          }
        }
      },
      { threshold, rootMargin: '-4% 0px -4% 0px' },
    )
    observer.observe(el)

    return () => {
      window.cancelAnimationFrame(rafId)
      observer.disconnect()
    }
  }, [ref, immediate, threshold])

  return state
}

function stateClass(state: RevealState): string {
  if (state === 'in') return 'is-in'
  if (state === 'out-up') return 'is-out-up'
  return 'is-out-down'
}

/**
 * Bidirectional scroll-triggered compositor-only fade-in and fade-out
 * matching a 420ms ease-out vertical shift (transform + opacity only).
 */
export function RevealBlock({
  children,
  delayMs = 0,
  immediate = false,
  className = '',
  style,
  as = 'div',
}: {
  children: ReactNode
  delayMs?: number
  immediate?: boolean
  className?: string
  style?: CSSProperties
  as?: 'div' | 'section' | 'header' | 'li' | 'p'
}) {
  const ref = useRef<HTMLElement | null>(null)
  const state = useScrollVisibility(ref, immediate, 0.12)

  const mergedStyle = {
    ...style,
    '--reveal-delay': `${delayMs}ms`,
  } as CSSProperties

  const classes = `reveal ${stateClass(state)} ${className}`.trim()

  if (as === 'section') {
    return (
      <section ref={ref as React.RefObject<HTMLElement>} className={classes} style={mergedStyle}>
        {children}
      </section>
    )
  }
  if (as === 'header') {
    return (
      <header ref={ref as React.RefObject<HTMLElement>} className={classes} style={mergedStyle}>
        {children}
      </header>
    )
  }
  if (as === 'li') {
    return (
      <li ref={ref as React.RefObject<HTMLLIElement>} className={classes} style={mergedStyle}>
        {children}
      </li>
    )
  }
  if (as === 'p') {
    return (
      <p ref={ref as React.RefObject<HTMLParagraphElement>} className={classes} style={mergedStyle}>
        {children}
      </p>
    )
  }
  return (
    <div ref={ref as React.RefObject<HTMLDivElement>} className={classes} style={mergedStyle}>
      {children}
    </div>
  )
}

/**
 * Staggered word-level fade-in and fade-out on scroll for display headlines.
 */
export function KineticWords({
  text,
  stepMs = 45,
  baseDelayMs = 0,
  immediate = true,
  className = '',
}: {
  text: string
  stepMs?: number
  baseDelayMs?: number
  immediate?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const state = useScrollVisibility(ref, immediate, 0.16)
  const words = text.split(' ')

  return (
    <span ref={ref} className={`kw-line ${stateClass(state)} ${className}`.trim()}>
      {words.map((word, idx) => (
        <span key={`${word}-${idx}`} className="kw-mask">
          <span
            className="kw-word"
            style={{ '--kw-delay': `${baseDelayMs + idx * stepMs}ms` } as CSSProperties}
          >
            {word}
          </span>
          {idx < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  )
}
