import { Routes, Route } from 'react-router-dom'
import HostDashboard from './components/HostDashboard'
import PlayerScreen from './components/PlayerScreen'

export default function App() {
  return (
    <div className="app-container">
      <Routes>
        <Route path="/host" element={<HostDashboard />} />
        <Route path="/play" element={<PlayerScreen />} />
        <Route path="/*" element={<PlayerScreen />} />
      </Routes>
    </div>
  )
}
