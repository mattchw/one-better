import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { requireTestDatabaseURL } from "./test-database";
import { startCalendarFixture, fixtureEnvironment } from "../tests/calendar-fixture-server";
import {startGoogleAuthFixture} from "../tests/google-auth-fixture";
import {pathToFileURL} from "node:url";
import {resolve as resolvePath} from "node:path";
import {startChatGPTFixture} from '../tests/chatgpt-provider-fixture';
import {startCoachingFixture,coachingFixtureEnvironment} from '../tests/coaching-provider-fixture';
const { url } = requireTestDatabaseURL();
const isolated = new URL(url); const name = `execution_test_${randomBytes(6).toString("hex")}`;
isolated.pathname = `/${name}`;
const adminURL = new URL(url); adminURL.pathname = "/postgres";
const admin = new Pool({ connectionString: adminURL.toString() });
let created = false;
const clockDirectory=await mkdtemp(join(tmpdir(),"execution-focus-clock-")),clockFile=join(clockDirectory,"now");await writeFile(clockFile,new Date().toISOString());
const calendarFixture = await startCalendarFixture("http://127.0.0.1:3101");
const coachFixture=await startCoachingFixture();
const chatGPTFixture=await startChatGPTFixture();
const googleAuthFixture=await startGoogleAuthFixture("http://127.0.0.1:3101");
try {
  await admin.query(`CREATE DATABASE "${name}"`); created = true;
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, ...googleAuthFixture.environment, NODE_OPTIONS:`${process.env.NODE_OPTIONS??""} --import=${pathToFileURL(resolvePath("tests/google-auth-test-transport.mjs"))}`, DATABASE_URL: isolated.toString(), EXECUTION_TEST_CLOCK_FILE:clockFile, ...fixtureEnvironment(calendarFixture.origin, "http://127.0.0.1:3101"),...coachingFixtureEnvironment(coachFixture.origin),CHATGPT_TEST_ORIGIN:chatGPTFixture.origin,CHATGPT_TEST_MODE:'isolated-fixture',CHATGPT_HOST_FILE:join(clockDirectory,'chatgpt-host.json'),CHATGPT_ENCRYPTION_KEYS:JSON.stringify({qa:randomBytes(32).toString('base64')}),CHATGPT_ENCRYPTION_KEY_ID:'qa' } });
    child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  await googleAuthFixture.close();
  await calendarFixture.close();
  await coachFixture.close();
  await chatGPTFixture.close();
  if (created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
  await rm(clockDirectory,{recursive:true,force:true});
}
