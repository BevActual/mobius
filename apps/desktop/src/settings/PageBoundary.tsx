import { Component, type ReactNode } from 'react';

/**
 * One Settings page that fails to draw shows a quiet row instead of blanking the whole window. The rest of Settings,
 * and the app, keep working; choosing the page again tries again.
 */
export class PageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('[mobius] a settings page could not draw', error);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className="srow" role="alert" data-setting="page-failed">
          <div className="srow-head">
            <h3 className="srow-title">This page couldn’t load</h3>
            <p className="srow-desc">Something it needs did not answer as expected. Choose another page, then come back to try again.</p>
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}
