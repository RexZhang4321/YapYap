import { platformNotice } from "#platform";

export function PlatformNotice() {
  const notice = platformNotice;
  if (!notice) return null;
  return (
    <section className="setup-callout" aria-label={notice.title}>
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.text}</p>
      </div>
    </section>
  );
}
