import {mkdirSync} from 'node:fs';
import {test,expect} from '@playwright/test';
for(const kind of ['flat','wave','river'])for(const below of [false,true])for(const snapshot of [false,true]) {
 test(`water suppresses hidden AO: ${kind}, below=${below}, snapshot=${snapshot}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/tests/smoke/fixtures/ao-water.html');await page.waitForFunction(()=>'waterAo' in window);
  const result=await page.evaluate(({kind,below,snapshot})=>(window as unknown as {waterAo:(k:string,b:boolean,s:boolean)=>{protrusionDifference:number;normalDifference:number;depthDifference:number;aoDifference:number;fallbackChanged:number;depthWrite:boolean;visible:boolean}}).waterAo(kind,below,snapshot),{kind,below,snapshot});
  if(!below&&!snapshot){mkdirSync('docs/reports/images/ao-surface-occlusion',{recursive:true});await page.screenshot({path:`docs/reports/images/ao-surface-occlusion/water-${kind}-normal.png`});}
  expect(result.protrusionDifference).toBeGreaterThan(0);
  expect(result.normalDifference).toBe(0);expect(result.depthDifference).toBe(0);expect(result.aoDifference).toBe(0);
  if(!snapshot)expect(result.fallbackChanged).toBeGreaterThan(0);
  expect(result.depthWrite).toBe(false);expect(result.visible).toBe(true);expect(errors).toEqual([]);
 });
}
