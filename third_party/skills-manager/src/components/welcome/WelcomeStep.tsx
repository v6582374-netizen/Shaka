import { useTranslation } from "@/i18n";

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const { t } = useTranslation();

  return (
    <div>
      {/* Description */}
      <p
        style={{
          fontSize: '14px',
          color: 'var(--muted-foreground)',
          margin: '0 0 32px 0',
          lineHeight: 1.6,
          textAlign: 'center',
        }}
      >
        {t("welcome.description")}
      </p>

      {/* Steps */}
      <div style={{ marginBottom: '32px' }}>
        <StepItem number={1} title={t("welcome.step1Title")} desc={t("welcome.step1Desc")} />
        <StepItem number={2} title={t("welcome.step2Title")} desc={t("welcome.step2Desc")} />
        <StepItem number={3} title={t("welcome.step3Title")} desc={t("welcome.step3Desc")} />
      </div>

      {/* Button */}
      <button
        onClick={onNext}
        style={{
          width: '100%',
          height: '44px',
          fontSize: '14px',
          fontWeight: 500,
          color: 'var(--primary-foreground)',
          backgroundColor: 'var(--primary)',
          border: 'none',
          borderRadius: '10px',
          cursor: 'pointer',
          transition: 'opacity 0.15s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
        onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
      >
        {t("welcome.startSetup")}
      </button>
    </div>
  );
}

function StepItem({ number, title, desc }: { number: number; title: string; desc: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 16px',
        marginBottom: '8px',
        borderRadius: '10px',
        backgroundColor: 'var(--secondary)',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          backgroundColor: 'var(--primary-tint)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--primary)',
          }}
        >
          {number}
        </span>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--foreground)' }}>
          {title}
        </div>
        <div style={{ fontSize: '12px', color: 'var(--muted-foreground)' }}>
          {desc}
        </div>
      </div>
    </div>
  );
}
