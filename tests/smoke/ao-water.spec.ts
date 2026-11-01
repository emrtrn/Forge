import {test,expect} from '@playwright/test';
for(const kind of ['flat','wave','river'])for(const below of [false,true])for(const snapshot of [false,true]) {
 test(`water suppresses hidden AO: ${kind}, below=${below}, snapshot=${snapshot}`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/tests/smoke/fixtures/ao-water.html');await page.waitForFunction(()=>'waterAo' in window);
  const result=await page.evaluate(({kind,below,snapshot})=>(window as unknown as {waterAo:(k:string,b:boolean,s:boolean)=>{normalLength:number;aoCentre:number;protrusionDifference:number;normalDifference:number;depthDifference:number;aoDifference:number;fallbackChanged:number;depthWrite:boolean;visible:boolean}}).waterAo(kind,below,snapshot),{kind,below,snapshot});
  if(!below&&!snapshot)await page.screenshot({path:info.outputPath(`water-${kind}-normal.png`)});
  expect(result.normalLength).toBeGreaterThan(.95);expect(result.normalLength).toBeLessThan(1.05);
  expect(result.aoCentre).toBeGreaterThan(64);
  expect(result.protrusionDifference).toBeGreaterThan(0);
  expect(result.normalDifference).toBe(0);expect(result.depthDifference).toBe(0);expect(result.aoDifference).toBe(0);
  if(!snapshot)expect(result.fallbackChanged).toBeGreaterThan(0);
  expect(result.depthWrite).toBe(false);expect(result.visible).toBe(true);expect(errors).toEqual([]);
 });
}

for(const waves of [false,true])for(const floatDepth of [false,true]) {
 test(`river stays visible with AO: waves=${waves}, MSAA fallback=${floatDepth}`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('/tests/smoke/fixtures/ao-water.html');await page.waitForFunction(()=>'riverAoBeauty' in window);
  const result=await page.evaluate(({waves,floatDepth})=>(window as unknown as {riverAoBeauty:(w:boolean,f:boolean)=>{withoutAo:number[][];withAo:number[][];snapshot:boolean}}).riverAoBeauty(waves,floatDepth),{waves,floatDepth});
  expect(result.snapshot).toBe(!floatDepth);
  for(let i=0;i<result.withAo.length;i++) {
   const brightness=(values:number[])=>values.reduce((sum,v)=>sum+v,0)/3;
   expect(brightness(result.withoutAo[i]!)).toBeGreaterThan(15);
   expect(brightness(result.withAo[i]!)).toBeGreaterThan(brightness(result.withoutAo[i]!)*.6);
  }
  await page.screenshot({path:info.outputPath('river-ao-beauty.png')});
  expect(errors).toEqual([]);
 });
}
