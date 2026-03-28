import type { ReactNode } from "react";

type ArtifactDrawerProps = {
  title: string;
  summary: string;
  onClose: () => void;
  children: ReactNode;
};

export function ArtifactDrawer({ title, summary, onClose, children }: ArtifactDrawerProps) {
  return (
    <div className="drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="drawer-shell" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div>
            <div className="eyebrow">Open view</div>
            <h2>{title}</h2>
            <p className="section-copy">{summary}</p>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
