interface PageLayoutProps {
  children: React.ReactNode;
}

/**
 * Standard page layout wrapper with full-screen background and centered container.
 * Use this component to wrap page content in route components.
 */
export function PageLayout({ children }: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background w-screen">
      <div className="container mx-auto md:px-4 py-1 md:py-8">{children}</div>
    </div>
  );
}

