import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import YomyEventEngine from '@/components/notifications/YomyEventEngine'
import YomyReminderEngine from '@/components/notifications/YomyReminderEngine'
import PushManager from '@/components/notifications/PushManager'
import CallProvider from '@/components/calls/CallProvider'
import CallHistoryPanel from '@/components/calls/CallHistoryPanel'
import Login from '@/pages/auth/Login'
import SignUp from '@/pages/auth/SignUp'
import Feed from '@/pages/Feed'
import Fedo from '@/pages/Fedo'
import CreatorAnalytics from '@/pages/CreatorAnalytics'
import Explore from '@/pages/Explore'
import Create from '@/pages/Create'
import CreateStory from '@/pages/CreateStory'
import Notifications from '@/pages/Notifications'
import Profile from '@/pages/Profile'
import EditProfile from '@/pages/EditProfile'
import Settings from '@/pages/Settings'
import ChatPro from '@/pages/ChatPro'
import MessagesPro from '@/pages/MessagesPro'
import NetworkStatus from '@/components/system/NetworkStatus'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen flex items-center justify-center"><Spinner className="size-8" /></div>
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}
function AppRoutes() {
  return <Routes>
    <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
    <Route path="/signup" element={<PublicRoute><SignUp /></PublicRoute>} />
    <Route path="/" element={<ProtectedRoute><Feed /></ProtectedRoute>} />
    <Route path="/fedo" element={<ProtectedRoute><Fedo /></ProtectedRoute>} />
    <Route path="/creator-analytics" element={<ProtectedRoute><CreatorAnalytics /></ProtectedRoute>} />
    <Route path="/explore" element={<ProtectedRoute><Explore /></ProtectedRoute>} />
    <Route path="/create" element={<ProtectedRoute><Create /></ProtectedRoute>} />
    <Route path="/create-story" element={<ProtectedRoute><CreateStory /></ProtectedRoute>} />
    <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
    <Route path="/profile/:username" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
    <Route path="/edit-profile" element={<ProtectedRoute><EditProfile /></ProtectedRoute>} />
    <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
    <Route path="/messages" element={<ProtectedRoute><MessagesPro /></ProtectedRoute>} />
    <Route path="/messages/new" element={<ProtectedRoute><ChatPro /></ProtectedRoute>} />
    <Route path="/messages/:username" element={<ProtectedRoute><ChatPro /></ProtectedRoute>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
}
export function App() {
  return <AuthProvider><BrowserRouter><CallProvider><AppRoutes /><NetworkStatus /><YomyEventEngine /><YomyReminderEngine /><PushManager /><CallHistoryPanel /></CallProvider></BrowserRouter><Toaster position="bottom-center" duration={1400} visibleToasts={1} closeButton={false} expand={false} toastOptions={{ classNames: { toast: 'text-xs px-3 py-2 min-h-0 rounded-xl max-w-[min(320px,calc(100vw-24px))] shadow-lg', title: 'text-xs font-medium', description: 'text-[11px]' } }} /></AuthProvider>
}
export default App
