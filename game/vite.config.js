import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { renameSync, existsSync } from 'fs'
import { resolve } from 'path'

// After build: make invite.html the root index.html, move React app to game.html
function inviteAsRoot() {
  return {
    name: 'invite-as-root',
    closeBundle() {
      const dist = resolve('dist')
      const indexPath = resolve(dist, 'index.html')
      const gamePath = resolve(dist, 'game.html')
      const invitePath = resolve(dist, 'invite.html')

      if (existsSync(indexPath) && existsSync(invitePath)) {
        // React app entry → game.html
        renameSync(indexPath, gamePath)
        // Invite page → index.html (root)
        renameSync(invitePath, indexPath)
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), inviteAsRoot()],
  base: '/jazzys25th/',
})
