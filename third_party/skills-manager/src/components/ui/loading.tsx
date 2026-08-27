interface SpinnerProps {
  size?: number
  className?: string
}

export function Spinner({ size = 16 }: SpinnerProps) {
  return (
    <svg
      style={{
        animation: 'spin 1s linear infinite',
        width: size,
        height: size,
      }}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        style={{ opacity: 0.25 }}
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        style={{ opacity: 0.75 }}
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

interface PageLoaderProps {
  message?: string
}

export function PageLoader({ message = "Loading..." }: PageLoaderProps) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '256px',
      gap: '16px',
    }}>
      <Spinner size={32} />
      <p style={{
        fontSize: '14px',
        color: 'var(--muted-foreground)',
        margin: 0,
      }}>{message}</p>
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div style={{
      borderRadius: '14px',
      border: '1px solid var(--border)',
      backgroundColor: 'var(--secondary)',
      padding: '18px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
        <div style={{
          width: '44px',
          height: '44px',
          backgroundColor: 'var(--muted)',
          borderRadius: '12px',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{
            height: '16px',
            backgroundColor: 'var(--muted)',
            borderRadius: '4px',
            width: '75%',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }} />
          <div style={{
            height: '12px',
            backgroundColor: 'var(--muted)',
            borderRadius: '4px',
            width: '50%',
            animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }} />
        </div>
      </div>
      <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
        <div style={{
          height: '24px',
          backgroundColor: 'var(--muted)',
          borderRadius: '6px',
          width: '64px',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        }} />
        <div style={{
          height: '24px',
          backgroundColor: 'var(--muted)',
          borderRadius: '6px',
          width: '64px',
          animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        }} />
      </div>
    </div>
  )
}

interface SkeletonListProps {
  count?: number
}

export function SkeletonList({ count = 3 }: SkeletonListProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
      gap: '16px',
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  )
}
