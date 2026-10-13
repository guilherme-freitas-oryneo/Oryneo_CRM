import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
 plugins:[react()],
 build:{rollupOptions:{input:{crm:resolve(__dirname,'index.html'),payment:resolve(__dirname,'pagar/index.html')}}},
 test:{environment:'jsdom',setupFiles:['./src/test/setup.ts'],restoreMocks:true,exclude:['**/node_modules/**','**/.git/**','**/.worktrees/**']}
});
