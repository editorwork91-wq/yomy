import { StrictMode, Component, type ErrorInfo, type ReactNode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { applyYomyPlatformAttributes, detectYomyPlatform } from "@/lib/platform"

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Yomy service worker unavailable:", error))
  })
}
const SUPPORTED_LANGUAGES = new Set(['en', 'ar', 'de', 'fr', 'es'])

function prepareInitialLanguage() {
  try {
    const stored = localStorage.getItem('yomy-language') || ''
    const browser = (navigator.language || '').slice(0, 2).toLowerCase()
    const language = SUPPORTED_LANGUAGES.has(stored) ? stored : SUPPORTED_LANGUAGES.has(browser) ? browser : 'en'
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
  } catch {
    document.documentElement.lang = 'en'
    document.documentElement.dir = 'ltr'
  }
}

prepareInitialLanguage()
applyYomyPlatformAttributes(detectYomyPlatform())

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
