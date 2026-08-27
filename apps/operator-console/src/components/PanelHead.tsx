export function PanelHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-4">
      <h2 className="editorial-heading text-[28px] font-medium leading-[1.08] tracking-[-0.045em]">{title}</h2>
      <p className="editorial-subtitle text-[13px] leading-[1.5] text-muted mt-1.5">{sub}</p>
    </div>
  );
}
