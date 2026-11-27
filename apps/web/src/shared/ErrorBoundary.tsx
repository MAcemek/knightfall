import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState } from './ui.tsx';

/** Catches a render error or a failed lazy page chunk below it, so the nav around it stays usable. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Page failed to render', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <EmptyState
        title="Something went wrong on this page."
        action={
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Link to="/" className="font-semibold text-ember-400 hover:underline">
              Home
            </Link>
          </div>
        }
      />
    );
  }
}
