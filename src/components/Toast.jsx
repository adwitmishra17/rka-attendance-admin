import React, { createContext, useContext, useState, useCallback } from 'react'

const ToastContext = createContext(null)
export const useToast = () => useContext(ToastContext)

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const show = useCallback((message, type = 'success') => {
    const id = nextId++
    setToasts(t => [...t, { id, message, type }])
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id))
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 360,
      }}>
        {toasts.map(t => {
          const isErr = t.type === 'error'
          return (
            <div key={t.id} className="fade-in" style={{
              padding: '11px 16px',
              borderRadius: 'var(--radius-md)',
              background: isErr ? '#fff' : 'var(--white)',
              border: `1px solid ${isErr ? 'rgba(139,26,26,0.3)' : 'var(--green-muted)'}`,
              borderLeft: `4px solid ${isErr ? 'var(--crimson)' : 'var(--green)'}`,
              boxShadow: 'var(--shadow-md)',
              fontSize: 13,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontWeight: 500,
            }}>
              <span style={{
                flexShrink: 0,
                width: 18, height: 18,
                borderRadius: '50%',
                background: isErr ? 'var(--crimson)' : 'var(--green)',
                color: 'white',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, marginTop: 1,
              }}>
                {isErr ? '!' : '✓'}
              </span>
              <span style={{ lineHeight: 1.5 }}>{t.message}</span>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
