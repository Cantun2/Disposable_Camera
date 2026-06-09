import { useEffect } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import Camera from '../components/Camera'
import Gallery from '../components/Gallery'
import { getGuestId } from '../lib/session'

// The room page hosts the two views (camera / gallery) behind a bottom tab.
export default function Room() {
  const { roomId = '', tab } = useParams()

  // Touching the room URL provisions an anonymous guest token for this device.
  useEffect(() => {
    getGuestId()
  }, [])

  const showGallery = tab === 'gallery'

  return (
    <div className="relative h-dvh w-full bg-navy">
      {showGallery ? <Gallery roomId={roomId} /> : <Camera roomId={roomId} />}

      {/* Bottom tab bar */}
      <nav className="absolute bottom-0 left-0 right-0 z-30 flex justify-around border-t border-gold/15 bg-navy/80 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur">
        <Tab to={`/room/${roomId}`} active={!showGallery} label="Camera" />
        <Tab to={`/room/${roomId}/gallery`} active={showGallery} label="Gallery" />
      </nav>
    </div>
  )
}

function Tab({ to, active, label }: { to: string; active: boolean; label: string }) {
  return (
    <NavLink
      to={to}
      className={`px-6 py-1 font-serif text-lg tracking-wide ${
        active ? 'text-gold' : 'text-gold-300/50'
      }`}
    >
      {label}
    </NavLink>
  )
}
