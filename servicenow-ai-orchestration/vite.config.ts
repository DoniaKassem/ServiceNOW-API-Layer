import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // Use environment variable for ServiceNow instance URL, with fallback
  const serviceNowInstance = env.VITE_SERVICENOW_INSTANCE || 'https://illumindev.service-now.com'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api/servicenow': {
          target: serviceNowInstance,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/servicenow/, '/api/now'),
          secure: true,
        },
      },
    },
  }
})
