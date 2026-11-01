import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

test('AO respects back-facing alpha-cut foliage and retains AO through holes', async ({ page }) => {
  await page.setViewportSize({width:320,height:240});
  const errors:string[]=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/tests/smoke/fixtures/ao-surface.html');
  await page.waitForFunction(()=> 'runAo' in window);
  mkdirSync('docs/reports/images/ao-surface-occlusion',{recursive:true});
  const run=async(fixed:boolean,output:number)=>page.evaluate(({fixed,output})=>(window as unknown as {runAo:(f:boolean,o:number)=>{left:number[];right:number[]}}).runAo(fixed,output),{fixed,output});
  for (const front of [false,true]) {
    const probe=async(options:Record<string,boolean>)=>page.evaluate(({front,options})=>(window as unknown as {runAo:(f:boolean,o:number,p:Record<string,boolean>)=>{left:number[];right:number[]}}).runAo(true,3,{front,...options}),{front,options});
    const both=await probe({});const leafOnly=await probe({hideRear:true});const rearOnly=await probe({hideLeaf:true});
    const closed = front ? 'left' : 'right'; const hole = front ? 'right' : 'left';
    expect(both[closed]).toEqual(leafOnly[closed]);
    expect(both[hole]).toEqual(rearOnly[hole]);
    expect(both[hole]).not.toEqual(leafOnly[hole]);
    const opaque=await probe({opaque:true});
    expect(opaque.left).toEqual(opaque.right);
  }
  const before=await run(false,3);
  await page.screenshot({path:'docs/reports/images/ao-surface-occlusion/before-normal.png'});
  const after=await run(true,3);
  await page.screenshot({path:'docs/reports/images/ao-surface-occlusion/after-normal.png'});
  expect(after).not.toEqual(before);
  // One half is the leaf, the other still exposes the rotated box normal.
  expect(after.left).not.toEqual(after.right);
  for(const [name,output] of [['depth',2],['ao',4],['beauty',1],['composite',0]] as const){
    await run(false,output);await page.screenshot({path:`docs/reports/images/ao-surface-occlusion/before-${name}.png`});
    await run(true,output);await page.screenshot({path:`docs/reports/images/ao-surface-occlusion/after-${name}.png`});
  }
  const performance = await page.evaluate(() => (window as unknown as {benchAo:()=>unknown}).benchAo());
  writeFileSync('docs/reports/images/ao-surface-occlusion/cpu-submit.json',JSON.stringify(performance,null,2)+'\n');
  expect(errors).toEqual([]);
});
