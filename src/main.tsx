import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Yomy runtime error:", error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <main className="min-h-screen flex items-center justify-center bg-background p-6">
          <section className="w-full max-w-lg rounded-2xl border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-semibold">Yomy could not start</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The app hit a runtime error. Your files and keys were not removed.
            </p>
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              className="mt-4 rounded-lg bg-primary px-4 py-2 text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Reload Yomy
            </button>
          </section>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </StrictMode>
)
