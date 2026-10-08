import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { Outlet } from 'react-router-dom'
function ProtectedRoute({ children }: { children: React.ReactNode }) { const { user, loading } = useAuth(); if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>; if (!user) return <Navigate to="/login" replace />; return <>{children}</> }
function PublicRoute({ children }: { children: React.ReactNode }) { const { user, loading } = useAuth(); if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>; if (user) return <Navigate to="/auth/redirect" replace />; return <>{children}</> }
function AppRoutes() { return <Routes><Route path="/login" element={<PublicRoute><Outlet /></PublicRoute>} /><Route path="/signup" element={<PublicRoute><Outlet /></PublicRoute>} /></Routes> }
export default function App(){ return <AuthProvider><BrowserRouter><AppRoutes /></BrowserRouter><Toaster /></AuthProvider> }
