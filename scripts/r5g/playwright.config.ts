import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'../../tests/qa',testMatch:'r5g.spec.ts',workers:1,timeout:30000,outputDir:'../../.cache/r5g-browser-results',use:{baseURL:process.env.R5G_QA_ORIGIN,viewport:{width:1440,height:1050},headless:true}});
