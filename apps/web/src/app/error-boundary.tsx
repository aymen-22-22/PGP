import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * A failed dynamic import almost always means one thing: the app was rebuilt
 * and this tab is still holding the previous index.html, whose hashed chunk
 * filenames no longer exist on the server. Reloading fetches the new shell.
 */
function isStaleBundleError(error: Error): boolean {
  const message = `${error?.name ?? ''} ${error?.message ?? ''}`;
  return (
    /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch dynamically/i.test(
      message,
    ) || /\.(js|mjs)$/i.test(message)
  );
}

const RELOAD_FLAG = 'perp:reloaded-for-stale-bundle';

/**
 * Last line of defence: without this, any render-time throw leaves a blank
 * white page with no way back — the worst possible outcome in a warehouse.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);

    // Recover from a stale bundle automatically, but only once: if the reload
    // does not fix it, looping forever would be worse than showing the error.
    if (isStaleBundleError(error) && sessionStorage.getItem(RELOAD_FLAG) !== '1') {
      try {
        sessionStorage.setItem(RELOAD_FLAG, '1');
      } catch {
        /* private mode — fall through to the manual prompt */
      }
      window.location.reload();
    }
  }

  private reload = (): void => {
    try {
      sessionStorage.removeItem(RELOAD_FLAG);
    } catch {
      /* ignore */
    }
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isStaleBundleError(error);

    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <AlertTriangle className="h-12 w-12 text-warning" aria-hidden />
        <h1 className="text-xl font-bold">
          {stale ? 'A new version is available' : 'Something went wrong'}
        </h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          {stale
            ? 'This page was loaded from an older version of the app. Reload to continue — nothing you have saved is affected.'
            : 'The screen could not be displayed. Reloading usually clears it.'}
        </p>
        <Button size="lg" className="gap-2" onClick={this.reload}>
          <RefreshCw className="h-5 w-5" />
          Reload
        </Button>
        {!stale && import.meta.env.DEV && (
          <pre className="max-w-full overflow-x-auto rounded bg-muted p-3 text-start text-xs">
            {error.message}
          </pre>
        )}
      </div>
    );
  }
}
