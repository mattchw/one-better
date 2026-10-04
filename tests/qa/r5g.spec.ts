import {test,expect} from '@playwright/test';
import {mkdir,readdir} from 'node:fs/promises';
test('six comparisons keep identical Evidence and withheld outputs; recording preferences is an explicit isolated QA action',async({page})=>{
 await mkdir('docs/r5g-evidence/fixtures',{recursive:true});await page.goto('/');await expect(page.getByRole('heading',{name:'Execution gap + approved reflection',exact:true})).toBeVisible();
 const a=page.getByRole('region',{name:'Version A'}),b=page.getByRole('region',{name:'Version B'}),c=page.getByRole('region',{name:'Version C'});
 expect(await a.locator('li').allTextContents()).toEqual(await b.locator('li').allTextContents());expect(await a.locator('li').allTextContents()).toEqual(await c.locator('li').allTextContents());
 await expect(a.getByRole('heading',{name:'Question',exact:true})).toHaveCount(0);await expect(b).toContainText('reflection point to displaced');await expect(c.getByRole('heading',{name:'Coach',exact:true})).toBeVisible();
 await page.screenshot({path:'docs/r5g-evidence/fixtures/gap-three-variants.png',fullPage:true});
 const scenarios=['gap_reflection','already_addressed','repeated_carry','clean','completed','no_reflection'];
 for(let i=0;i<6;i++){if(i)await page.getByRole('button',{name:'Next scenario',exact:true}).click();
  expect(await a.locator('li').allTextContents()).toEqual(await b.locator('li').allTextContents());expect(await a.locator('li').allTextContents()).toEqual(await c.locator('li').allTextContents());
  if([1,3,4].includes(i)){await expect(b.getByRole('heading',{name:'Question',exact:true})).toHaveCount(0);await expect(c).toContainText('No useful AI insight');}
  if(i===2){await expect(c).toContainText('withheld');await expect(b).toContainText('worth another Carry decision');await page.screenshot({path:'docs/r5g-evidence/fixtures/carry-three-variants.png',fullPage:true});}
  for(const [key,value] of Object.entries({betterDecision:'B',aiAddedValue:'No',aiNuance:'No',aiVerbosity:'Yes',coachDisappeared:'No',weeklyReading:'Yes'}))await page.locator(`#${scenarios[i]}-${key}`).selectOption(value);
 }
 expect(await readdir(process.env.R5G_TEST_OUTPUT!)).toEqual([]);await page.getByLabel('Which product direction do you prefer?').selectOption('Replace Review AI with deterministic coaching questions');await page.getByLabel('Reason for your product preference').fill('Synthetic browser test only; not human evaluation.');await page.getByRole('button',{name:'Save my evaluation',exact:true}).click();await expect(page.getByRole('status')).toContainText('Evaluation saved.');expect(await readdir(process.env.R5G_TEST_OUTPUT!)).toHaveLength(1);
});
