"use client";

import { ReactNode } from "react";

type PageShellProps = {
  children: ReactNode;
  className?: string;
};

type PageHeroProps = {
  eyebrow?: string;
  title: string;
  description: string;
  aside?: ReactNode;
  actions?: ReactNode;
};

type PagePanelProps = {
  children: ReactNode;
  className?: string;
};

export function PageShell({ children, className = "" }: PageShellProps) {
  return (
    <section className={`page-shell ${className}`.trim()}>
      <div className="page-shell__inner">{children}</div>
    </section>
  );
}

export function PageHero({ eyebrow, title, description, aside, actions }: PageHeroProps) {
  return (
    <header className="page-hero">
      <div className="page-hero__body">
        {eyebrow ? <p className="page-hero__eyebrow">{eyebrow}</p> : null}
        <h1 className="page-hero__title">{title}</h1>
        <p className="page-hero__description">{description}</p>
        {actions ? <div className="page-hero__actions">{actions}</div> : null}
      </div>
      {aside ? <aside className="page-hero__aside">{aside}</aside> : null}
    </header>
  );
}

export function PagePanel({ children, className = "" }: PagePanelProps) {
  return <section className={`panel-surface ${className}`.trim()}>{children}</section>;
}
