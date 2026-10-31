import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
 testDir:'.',
 testMatch:/editor\.pw\.ts$/,
 fullyParallel:false,
 reporter:[['list'],['html',{open:'never',outputFolder:'qa/automation-editor/report'}]],
 use:{baseURL:'http://127.0.0.1:4175',trace:'retain-on-failure',screenshot:'only-on-failure'},
 projects:[{name:'chromium-desktop',use:{...devices['Desktop Chrome']}}],
 webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4175',
   url:'http://127.0.0.1:4175/qa/automation-editor/index.html',
   timeout:90_000,reuseExistingServer:false},
 timeout:35_000,
});
