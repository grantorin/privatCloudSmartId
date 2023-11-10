import { defineConfig } from 'vite'

export default defineConfig({
	server: {
		port: 5050,
		proxy: {
			'/proxy/ProxyHandler.php': {
				target: 'https://webmachine.pp.ua/proxy/ProxyHandler.php',
				changeOrigin: true,
			},
		},
	},
})