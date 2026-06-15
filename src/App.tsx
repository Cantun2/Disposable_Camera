import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Room from './pages/Room'

// Admin console is operator-only, so lazy-load it — its QR-code dependency
// stays out of the guest (camera/gallery) bundle.
const Admin = lazy(() => import('./pages/Admin'))

export default function App() {
  return (
    <Suspense fallback={null}>
      <Routes>
        {/* Scanning the QR lands the guest straight in their event room. */}
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="/room/:roomId/:tab" element={<Room />} />
        {/* Operator console: create events, get link + QR. */}
        <Route path="/admin" element={<Admin />} />
        {/* Root opens the console (the app's home base on your computer). */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Suspense>
  )
}
