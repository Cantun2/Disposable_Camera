import { Navigate, Route, Routes } from 'react-router-dom'
import Room from './pages/Room'

export default function App() {
  return (
    <Routes>
      {/* Scanning the QR lands the guest straight in their event room. */}
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="/room/:roomId/:tab" element={<Room />} />
      {/* Demo fallback so `npm run dev` shows something at the root. */}
      <Route path="*" element={<Navigate to="/room/aurelie-thomas" replace />} />
    </Routes>
  )
}
